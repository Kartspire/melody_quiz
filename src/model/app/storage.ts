import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import {
  loadState,
  saveState,
  restoreState,
  StorageConflictError,
  subscribeToExternalStorageChanges,
} from '../../lib/storage';
import {
  $activeGameId,
  $audioAssets,
  $games,
  $mediaTracks,
  $sessions,
  $songs,
} from '../core/state';
import { normalizeSession, reconcileSession } from '../session';
import { beginStateReplacement } from '../core/writeAccess';
import type { GameSession, PersistedState } from '../types';
import {
  deriveStorageSaveStatus,
  hasSessionActivityChanged,
  pendingAfterSuccessfulSave,
  readOnlyAfterStorageFailure,
  sessionActivitySnapshot,
  type StorageSaveOutcome,
} from './storagePolicy';

export const appStarted = createEvent();
/** Retry initial IndexedDB hydration after a load/open failure. */
export const storageRetryRequested = createEvent();
/** Retry writing the latest in-memory snapshot after a save failure. */
export const storageSaveRetryRequested = createEvent();
export const persistedStateImported = createEvent<PersistedState>();

const externalStorageChangeDetected = createEvent<number>();
const storageErrorCleared = createEvent();
const persistedStateChanged = createEvent<PersistedState>();
const saveLatestRequested = createEvent();

const loadFx = createEffect(loadState);
const saveFx = createEffect(saveState);

let saveTimer: number | undefined;
let priorityFlushQueued = false;
let lastSessionActivity = sessionActivitySnapshot($sessions.getState());

type StateImport = PersistedState | ((current: PersistedState) => PersistedState | Promise<PersistedState>);

export const persistedStateImportFx = createEffect(async (input: StateImport) => {
  if (!$hydrated.getState() || $storageReadOnly.getState()) {
    throw new Error('Сначала загрузите актуальные локальные данные.');
  }
  return replaceState(input, false);
});

/** Only available after hydration has failed; rewrites all stores atomically. */
export const storageRecoveryFx = createEffect(async (state: PersistedState) => {
  if ($hydrated.getState() || loadFx.pending.getState() || !$storageError.getState()) {
    throw new Error('Восстановление доступно после ошибки загрузки локальных данных.');
  }
  return replaceState(state, true);
});

export const $stateReplacementPending = combine(
  persistedStateImportFx.pending, storageRecoveryFx.pending, (importing, recovering) => importing || recovering,
);

async function replaceState(input: StateImport, recovery: boolean) {
  const replacement = beginStateReplacement();
  cancelScheduledSave();
  try {
    const state = typeof input === 'function' ? await input($persistedState.getState()) : input;
    await (recovery ? restoreState(state) : saveState(state));
    replacement.apply(() => persistedStateImported(state));
    return state;
  } finally {
    replacement.release();
    // Failed imports must not strand an earlier unsaved editor snapshot.
    if ($pendingPersistedState.getState() && !$storageReadOnly.getState()) scheduleSaveFx();
  }
}

export const $storageError = createStore<string | null>(null)
  .on(loadFx.failData, (_, error) => `Не удалось открыть локальное хранилище. ${error instanceof Error ? error.message : ''} Повторите загрузку или выберите резервную копию для восстановления.`)
  .on(saveFx.failData, (_, error) => storageErrorMessage(error, 'Не удалось сохранить изменения в локальное хранилище.'))
  .on(persistedStateImportFx.failData, (current, error) => error instanceof StorageConflictError
    ? storageErrorMessage(error, 'Не удалось применить импортированные данные.')
    : current)
  .on(externalStorageChangeDetected, () => 'Данные были изменены в другой вкладке. Эта вкладка переведена в режим только чтения, чтобы не затереть более новую версию. Сохраните аварийную резервную копию при необходимости и перезагрузите страницу.')
  .on(loadFx.done, () => null)
  .on(storageRecoveryFx.done, () => null)
  .on(storageErrorCleared, () => null);

export const $storageReadOnly = createStore(false)
  .on(externalStorageChangeDetected, () => true)
  .on(saveFx.failData, readOnlyAfterStorageFailure)
  .on(persistedStateImportFx.failData, readOnlyAfterStorageFailure)
  .on(storageRecoveryFx.done, () => false)
  .on(loadFx.done, () => false);

export const $hydrated = createStore(false)
  .on(loadFx.done, () => true)
  .on(storageRecoveryFx.done, () => true)
  .on(loadFx.fail, () => false);

/**
 * Newest application snapshot that has not yet been confirmed by IndexedDB.
 * This stores references to the immutable model values; audio Blob data is not copied.
 */
export const $pendingPersistedState = createStore<PersistedState | null>(null)
  .on(persistedStateChanged, (_, state) => state)
  .on(saveFx.done, (pending, { params }) => pendingAfterSuccessfulSave(pending, params))
  .on(persistedStateImported, () => null);

export const $storageDirty = $pendingPersistedState.map((state) => state !== null);

const $saveOutcome = createStore<StorageSaveOutcome>('idle')
  .on(saveFx.done, () => 'saved')
  .on(saveFx.fail, () => 'error')
  .on(persistedStateImportFx.done, () => 'saved')
  .on(storageRecoveryFx.done, () => 'saved');

const $storageSaving = combine(saveFx.pending, persistedStateImportFx.pending, (saving, importing) => saving || importing);

export const $storageSaveStatus = combine(
  { outcome: $saveOutcome, dirty: $storageDirty, saving: $storageSaving },
  deriveStorageSaveStatus,
);

sample({
  clock: [appStarted, storageRetryRequested],
  source: combine(loadFx.pending, $stateReplacementPending, (loading, replacing) => loading || replacing),
  filter: (busy) => !busy,
  fn: () => undefined,
  target: loadFx,
});

$games
  .on(loadFx.doneData, (_, state) => state.games)
  .on(persistedStateImported, (_, state) => state.games);

$songs
  .on(loadFx.doneData, (_, state) => state.songs)
  .on(persistedStateImported, (_, state) => state.songs);

$mediaTracks
  .on(loadFx.doneData, (_, state) => state.mediaTracks)
  .on(persistedStateImported, (_, state) => state.mediaTracks);

$audioAssets
  .on(loadFx.doneData, (_, state) => state.audioAssets)
  .on(persistedStateImported, (_, state) => state.audioAssets);

$sessions
  .on(loadFx.doneData, (_, state) => hydrateSessions(state))
  .on(persistedStateImported, (_, state) => hydrateSessions(state));

$activeGameId
  .on(loadFx.doneData, (_, state) => state.activeGameId ?? state.games[0]?.id ?? null)
  .on(persistedStateImported, (_, state) => state.activeGameId ?? state.games[0]?.id ?? null);

export const $persistedState = combine(
  {
    games: $games,
    songs: $songs,
    mediaTracks: $mediaTracks,
    audioAssets: $audioAssets,
    sessions: $sessions,
    activeGameId: $activeGameId,
  },
  ({ games, songs, mediaTracks, audioAssets, sessions, activeGameId }): PersistedState => {
    const usedAudioIds = new Set(mediaTracks.map((track) => track.audioId));
    return {
      version: 4,
      games,
      songs,
      mediaTracks,
      audioAssets: audioAssets.filter((asset) => usedAudioIds.has(asset.id)),
      sessions: Object.values(sessions),
      activeGameId,
    };
  },
);

sample({
  clock: [saveFx.done, persistedStateImportFx.done],
  source: $storageReadOnly,
  filter: (readOnly) => !readOnly,
  target: storageErrorCleared,
});

sample({
  clock: $persistedState.updates,
  source: combine({ state: $persistedState, hydrated: $hydrated, readOnly: $storageReadOnly, replacing: $stateReplacementPending }),
  filter: ({ hydrated, readOnly, replacing }) => hydrated && !readOnly && !replacing,
  fn: ({ state }) => state,
  target: persistedStateChanged,
});

const scheduleSaveFx = createEffect(() => {
  cancelScheduledSave();
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    saveLatestRequested();
  }, 250);
});

sample({ clock: persistedStateChanged, target: scheduleSaveFx });

sample({
  clock: saveLatestRequested,
  source: combine({ pending: $pendingPersistedState, readOnly: $storageReadOnly, replacing: $stateReplacementPending }),
  filter: ({ pending, readOnly, replacing }) => Boolean(pending && !readOnly && !replacing),
  fn: ({ pending }) => pending!,
  target: saveFx,
});

const requestSaveRetryFx = createEffect(() => {
  cancelScheduledSave();
  saveLatestRequested();
});
sample({ clock: storageSaveRetryRequested, target: requestSaveRetryFx });

// Session changes get priority over ordinary editor/media updates. Queueing a microtask
// guarantees that the combined persisted state already contains the new session value.
const schedulePrioritySessionFlushFx = createEffect(() => {
  if (priorityFlushQueued) return;
  priorityFlushQueued = true;
  queueMicrotask(() => {
    priorityFlushQueued = false;
    cancelScheduledSave();
    saveLatestRequested();
  });
});

const observeSessionActivityFx = createEffect((sessions: Record<string, GameSession>) => {
  const nextActivity = sessionActivitySnapshot(sessions);
  const changed = hasSessionActivityChanged(lastSessionActivity, nextActivity);
  lastSessionActivity = nextActivity;
  if (changed && $hydrated.getState() && !$storageReadOnly.getState()) schedulePrioritySessionFlushFx();
});

sample({ clock: $sessions.updates, target: observeSessionActivityFx });

const unsubscribeExternalStorage = typeof window !== 'undefined'
  ? subscribeToExternalStorageChanges((revision) => externalStorageChangeDetected(revision))
  : null;


function cancelScheduledSave() {
  if (typeof window === 'undefined') return;
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
}

function flushPendingSave() {
  if (typeof window === 'undefined' || !$hydrated.getState() || $storageReadOnly.getState() || $stateReplacementPending.getState()) return;
  cancelScheduledSave();
  const pending = $pendingPersistedState.getState();
  if (pending) void saveFx(pending);
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') flushPendingSave();
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if ((!$storageDirty.getState() && !$stateReplacementPending.getState()) || $storageReadOnly.getState()) return;
  event.preventDefault();
  event.returnValue = '';
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibilityChange);
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingSave);
  window.addEventListener('beforeunload', handleBeforeUnload);
}

type HotModule = { dispose(callback: () => void): void };
const hotModule = (import.meta as ImportMeta & { hot?: HotModule }).hot;
hotModule?.dispose(() => {
  cancelScheduledSave();
  unsubscribeExternalStorage?.();
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', flushPendingSave);
    window.removeEventListener('beforeunload', handleBeforeUnload);
  }
});

function hydrateSessions(state: PersistedState) {
  return Object.fromEntries(state.sessions.map((session) => {
    const game = state.games.find((item) => item.id === session.gameId);
    return [session.gameId, game ? reconcileSession(game, session) : normalizeSession(session)];
  }));
}

function storageErrorMessage(error: unknown, fallback: string) {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
  return `${fallback}${detail} Несохранённые изменения остаются в памяти этой вкладки. Повторите сохранение или создайте полную резервную копию перед перезагрузкой.`;
}
