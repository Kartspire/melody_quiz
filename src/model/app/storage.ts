import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import {
  loadState,
  saveState,
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
import type { PersistedState } from '../types';

export const appStarted = createEvent();
export const storageRetryRequested = createEvent();
export const persistedStateImported = createEvent<PersistedState>();

const externalStorageChangeDetected = createEvent<number>();
const storageErrorCleared = createEvent();
const loadFx = createEffect(loadState);
const saveFx = createEffect(saveState);

export const $storageError = createStore<string | null>(null)
  .on(loadFx.failData, (_, error) => storageErrorMessage(error, 'Не удалось открыть локальное хранилище.'))
  .on(saveFx.failData, (_, error) => storageErrorMessage(error, 'Не удалось сохранить изменения в локальное хранилище.'))
  .on(externalStorageChangeDetected, () => 'Данные были изменены в другой вкладке. Эта вкладка переведена в режим только чтения, чтобы не затереть более новую версию. Перезагрузите страницу.')
  .on(loadFx.done, () => null)
  .on(storageErrorCleared, () => null);

export const $storageReadOnly = createStore(false)
  .on(externalStorageChangeDetected, () => true)
  .on(saveFx.failData, (readOnly, error) => error instanceof StorageConflictError ? true : readOnly)
  .on(loadFx.done, () => false);

export const $storageSaveStatus = createStore<'idle' | 'saving' | 'saved' | 'error'>('idle')
  .on(saveFx, () => 'saving')
  .on(saveFx.done, () => 'saved')
  .on(saveFx.fail, () => 'error');

export const $hydrated = createStore(false)
  .on(loadFx.done, () => true)
  .on(loadFx.fail, () => false);

sample({
  clock: saveFx.done,
  source: $storageReadOnly,
  filter: (readOnly) => !readOnly,
  target: storageErrorCleared,
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

sample({ clock: [appStarted, storageRetryRequested], target: loadFx });

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

let saveTimer: number | undefined;
let hasPendingSave = false;

export const persistedStateImportFx = createEffect(async (state: PersistedState) => {
  window.clearTimeout(saveTimer);
  hasPendingSave = false;
  await saveState(state);
  return state;
});

sample({ clock: persistedStateImportFx.doneData, target: persistedStateImported });

$storageError.on(
  persistedStateImportFx.failData,
  (_, error) => storageErrorMessage(error, 'Не удалось сохранить импортированные данные.'),
);
$storageReadOnly.on(
  persistedStateImportFx.failData,
  (readOnly, error) => error instanceof StorageConflictError ? true : readOnly,
);

sample({
  clock: persistedStateImportFx.done,
  source: $storageReadOnly,
  filter: (readOnly) => !readOnly,
  target: storageErrorCleared,
});

const scheduleSaveFx = createEffect((state: PersistedState) => {
  window.clearTimeout(saveTimer);
  hasPendingSave = true;
  saveTimer = window.setTimeout(() => {
    hasPendingSave = false;
    void saveFx(state);
  }, 250);
});

sample({
  clock: $persistedState.updates,
  source: combine({ state: $persistedState, hydrated: $hydrated, readOnly: $storageReadOnly }),
  filter: ({ hydrated, readOnly }) => hydrated && !readOnly,
  fn: ({ state }) => state,
  target: scheduleSaveFx,
});

if (typeof window !== 'undefined') {
  subscribeToExternalStorageChanges((revision) => externalStorageChangeDetected(revision));
}

function flushPendingSave() {
  if (typeof window === 'undefined' || !$hydrated.getState() || $storageReadOnly.getState() || !hasPendingSave) return;
  window.clearTimeout(saveTimer);
  hasPendingSave = false;
  void saveFx($persistedState.getState());
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingSave);
}

function hydrateSessions(state: PersistedState) {
  return Object.fromEntries(state.sessions.map((session) => {
    const game = state.games.find((item) => item.id === session.gameId);
    return [session.gameId, game ? reconcileSession(game, session) : normalizeSession(session)];
  }));
}

function storageErrorMessage(error: unknown, fallback: string) {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
  return `${fallback}${detail} Экспортируйте важные данные и проверьте свободное место/разрешения браузера.`;
}
