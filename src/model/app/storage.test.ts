// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, createInitialState, createSession } from '../defaults';
import type { PersistedState } from '../types';

const storageBackend = vi.hoisted(() => ({
  loadState: vi.fn<() => Promise<PersistedState>>(),
  saveState: vi.fn<(state: PersistedState) => Promise<void>>(),
  restoreState: vi.fn<(state: PersistedState) => Promise<void>>(),
  subscribe: vi.fn(() => () => undefined),
}));

vi.mock('../../lib/storage', () => {
  class StorageConflictError extends Error {
    constructor() {
      super('conflict');
      this.name = 'StorageConflictError';
    }
  }

  return {
    loadState: storageBackend.loadState,
    saveState: storageBackend.saveState,
    restoreState: storageBackend.restoreState,
    subscribeToExternalStorageChanges: storageBackend.subscribe,
    StorageConflictError,
  };
});

beforeEach(() => {
  vi.resetModules();
  storageBackend.loadState.mockReset();
  storageBackend.saveState.mockReset();
  storageBackend.restoreState.mockReset();
  storageBackend.subscribe.mockClear();
});

describe('application storage orchestration', () => {
  it('locks commands and duplicate imports until the replacement commits', async () => {
    const initial = createInitialState();
    const storage = await loadStorageModule(initial);
    const editor = await import('../games/editor');
    const library = await import('../games/library');
    const core = await import('../core/state');
    const before = storage.$persistedState.getState();
    const imported = withExtraGame(before, 'Imported');
    let commit!: () => void;
    storageBackend.saveState.mockImplementationOnce(() => new Promise<void>((resolve) => { commit = resolve; }));
    const importing = storage.persistedStateImportFx(imported);
    editor.gameTitleChanged('Must be rejected');
    library.gameCreated('Must also be rejected');
    expect(core.$games.getState()).toBe(before.games);
    await expect(storage.persistedStateImportFx(imported)).rejects.toThrow('Дождитесь');
    expect(storageBackend.saveState).toHaveBeenCalledTimes(1);
    commit();
    await importing;
    expect(core.$games.getState()).toEqual(imported.games);
    expect(storage.$storageDirty.getState()).toBe(false);
    editor.gameTitleChanged('Allowed after commit');
    expect(core.$games.getState().at(-1)?.title).toBe('Allowed after commit');
    storageBackend.saveState.mockResolvedValue(undefined);
    await waitUntil(() => !storage.$storageDirty.getState());
  });

  it('builds the import from current state under the lock and releases it on failure', async () => {
    const storage = await loadStorageModule(createInitialState());
    const editor = await import('../games/editor');
    editor.gameTitleChanged('Unsaved local title');
    storageBackend.saveState.mockRejectedValueOnce(new Error('Import failure')).mockResolvedValue(undefined);
    await expect(storage.persistedStateImportFx((current) => {
      expect(current.games[0].title).toBe('Unsaved local title');
      return withExtraGame(current, 'Failed import');
    })).rejects.toThrow('Import failure');
    expect(storage.$persistedState.getState().games).toHaveLength(1);
    await waitUntil(() => !storage.$storageDirty.getState());
    expect(storageBackend.saveState.mock.calls.at(-1)?.[0].games[0].title).toBe('Unsaved local title');
  });

  it('can recover after a failed load without treating the empty model as the database', async () => {
    const restored = createInitialState();
    storageBackend.loadState.mockRejectedValue(new Error('Corrupt record'));
    storageBackend.restoreState.mockRejectedValueOnce(new Error('Recovery failure')).mockResolvedValue(undefined);
    const storage = await import('./storage');
    storage.appStarted();
    await waitUntil(() => Boolean(storage.$storageError.getState()));
    await expect(storage.storageRecoveryFx(restored)).rejects.toThrow('Recovery failure');
    expect(storage.$hydrated.getState()).toBe(false);
    await storage.storageRecoveryFx(restored);
    expect(storage.$hydrated.getState()).toBe(true);
    expect(storage.$storageError.getState()).toBeNull();
    expect(storage.$persistedState.getState().games).toEqual(restored.games);
    expect(storageBackend.saveState).not.toHaveBeenCalled();
  });

  it('keeps the latest snapshot dirty after a failure and retries it successfully', async () => {
    const initial = createInitialState();
    const storage = await loadStorageModule(initial);
    storageBackend.saveState
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValue(undefined);

    const next = withExtraGame(initial, 'Retry target');
    storage.persistedStateImported(next);
    await waitUntil(() => storage.$storageSaveStatus.getState() === 'error');

    expect(storage.$storageDirty.getState()).toBe(true);
    expect(storageBackend.saveState).toHaveBeenCalledTimes(1);

    storage.storageSaveRetryRequested();
    await waitUntil(() => storageBackend.saveState.mock.calls.length === 2 && storage.$storageDirty.getState() === false);

    const retried = storageBackend.saveState.mock.calls[1][0];
    expect(retried.games.some((game) => game.title === 'Retry target')).toBe(true);
    expect(storage.$storageSaveStatus.getState()).toBe('saved');
  });

  it('switches to read-only when the backend reports a revision conflict', async () => {
    const initial = createInitialState();
    const storage = await loadStorageModule(initial);
    const conflict = Object.assign(new Error('stale revision'), { name: 'StorageConflictError' });
    storageBackend.saveState.mockRejectedValueOnce(conflict);

    storage.persistedStateImported(withExtraGame(initial, 'Conflict target'));
    await waitUntil(() => storage.$storageReadOnly.getState());

    expect(storage.$storageDirty.getState()).toBe(true);
    expect(storage.$storageError.getState()).toContain('Не удалось сохранить изменения');
    expect(storageBackend.saveState).toHaveBeenCalledTimes(1);
  });
});

async function loadStorageModule(initial: PersistedState) {
  storageBackend.loadState.mockResolvedValue(initial);
  storageBackend.saveState.mockResolvedValue(undefined);
  const storage = await import('./storage');
  storage.appStarted();
  await waitUntil(() => storage.$hydrated.getState());
  // Drain any hydration-related combined-store updates before configuring the failure under test.
  await new Promise((resolve) => setTimeout(resolve, 320));
  storageBackend.saveState.mockReset();
  return storage;
}

function withExtraGame(state: PersistedState, title: string): PersistedState {
  const game = createGame(title);
  return {
    ...state,
    games: [...state.games, game],
    sessions: [...state.sessions, createSession(game)],
    activeGameId: game.id,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for storage state transition.');
}
