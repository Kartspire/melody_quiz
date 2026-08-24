import { canonicalizeAudioAsset } from './audio';
import { createInitialState, createMediaTrack, createSession, migrateLegacyState } from '../model/defaults';
import { reconcileSession } from '../model/session';
import { normalizeGameConfig } from '../model/migrations';
import { assertValidPersistedState } from '../model/validation';
import type { AudioAsset, GameConfig, GameSession, LegacyPersistedState, MediaTrack, PersistedState, Song } from '../model/types';

const DB_NAME = 'melody-quiz-db';
const DB_VERSION = 5;
const LEGACY_STORE = 'state';
const LEGACY_STATE_KEY = 'app-state';
const GAMES_STORE = 'games';
const SONGS_STORE = 'songs';
const MEDIA_TRACKS_STORE = 'media-tracks';
const AUDIO_STORE = 'audio';
const SESSIONS_STORE = 'sessions';
const META_STORE = 'meta';
const ACTIVE_GAME_KEY = 'active-game-id';
const STATE_INITIALIZED_KEY = 'state-initialized';
const REVISION_KEY = 'state-revision';

let knownRevision = 0;
let lastSavedState: PersistedState | null = null;
let saveQueue: Promise<void> = Promise.resolve();


const TAB_ID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const externalChangeListeners = new Set<(revision: number) => void>();
const storageChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('melody-quiz-storage-v1')
  : null;

if (storageChannel) {
  storageChannel.onmessage = (event: MessageEvent<{ source?: string; revision?: number }>) => {
    const message = event.data;
    if (!message || message.source === TAB_ID || !Number.isSafeInteger(message.revision) || message.revision! <= knownRevision) return;
    for (const listener of externalChangeListeners) listener(message.revision!);
  };
}

export function subscribeToExternalStorageChanges(listener: (revision: number) => void) {
  externalChangeListeners.add(listener);
  return () => externalChangeListeners.delete(listener);
}

function announceRevision() {
  storageChannel?.postMessage({ source: TAB_ID, revision: knownRevision });
}

export class StorageConflictError extends Error {
  constructor() {
    super('Данные были изменены в другой вкладке. Эта вкладка не будет перезаписывать более новую версию. Обновите страницу.');
    this.name = 'StorageConflictError';
  }
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE);
      if (!db.objectStoreNames.contains(GAMES_STORE)) db.createObjectStore(GAMES_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SONGS_STORE)) db.createObjectStore(SONGS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MEDIA_TRACKS_STORE)) db.createObjectStore(MEDIA_TRACKS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) db.createObjectStore(SESSIONS_STORE, { keyPath: 'gameId' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };

    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error);
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Обновление локальной базы заблокировано другой открытой вкладкой. Закройте другие вкладки игры и повторите.'));
    };
  });

const requestValue = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const loadState = async (): Promise<PersistedState> => {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(
      [GAMES_STORE, SONGS_STORE, MEDIA_TRACKS_STORE, AUDIO_STORE, SESSIONS_STORE, META_STORE, LEGACY_STORE],
      'readonly',
    );

    const [games, songs, mediaTracks, rawAudioAssets, sessions, activeGameId, initialized, revision, legacy] = await Promise.all([
      requestValue(transaction.objectStore(GAMES_STORE).getAll() as IDBRequest<GameConfig[]>),
      requestValue(transaction.objectStore(SONGS_STORE).getAll() as IDBRequest<StoredSong[]>),
      requestValue(transaction.objectStore(MEDIA_TRACKS_STORE).getAll() as IDBRequest<MediaTrack[]>),
      requestValue(transaction.objectStore(AUDIO_STORE).getAll() as IDBRequest<Array<Partial<AudioAsset> & { size?: number }>>),
      requestValue(transaction.objectStore(SESSIONS_STORE).getAll() as IDBRequest<GameSession[]>),
      requestValue(transaction.objectStore(META_STORE).get(ACTIVE_GAME_KEY) as IDBRequest<string | null | undefined>),
      requestValue(transaction.objectStore(META_STORE).get(STATE_INITIALIZED_KEY) as IDBRequest<boolean | undefined>),
      requestValue(transaction.objectStore(META_STORE).get(REVISION_KEY) as IDBRequest<number | undefined>),
      requestValue(transaction.objectStore(LEGACY_STORE).get(LEGACY_STATE_KEY) as IDBRequest<LegacyPersistedState | undefined>),
    ]);

    knownRevision = Number.isSafeInteger(revision) && (revision ?? 0) >= 0 ? revision! : 0;

    if (games.length > 0 || initialized) {
      const canonical = await canonicalizeLoadedState({
        games,
        songs,
        mediaTracks,
        audioAssets: rawAudioAssets,
        sessions,
        activeGameId: games.some((game) => game.id === activeGameId) ? activeGameId! : games[0]?.id ?? null,
      });
      assertValidPersistedState(canonical.state);
      lastSavedState = canonical.state;

      if (canonical.changed) {
        await rewriteCanonicalState(canonical.state, knownRevision);
        lastSavedState = canonical.state;
      }
      return canonical.state;
    }

    const state = legacy?.config && legacy?.session ? await migrateLegacyState(legacy) : createInitialState();
    assertValidPersistedState(state);
    lastSavedState = null;
    await rewriteCanonicalState(state, knownRevision);
    await deleteLegacyState();
    lastSavedState = state;
    return state;
  } finally {
    db.close();
  }
};

export const saveState = (state: PersistedState): Promise<void> => {
  const snapshot = state;
  const task = saveQueue.then(() => saveStateInternal(snapshot));
  saveQueue = task.catch(() => undefined);
  return task;
};

async function saveStateInternal(state: PersistedState): Promise<void> {
  assertValidPersistedState(state);
  const db = await openDatabase();
  try {
    const transaction = db.transaction([GAMES_STORE, SONGS_STORE, MEDIA_TRACKS_STORE, AUDIO_STORE, SESSIONS_STORE, META_STORE], 'readwrite');
    const metaStore = transaction.objectStore(META_STORE);
    const storedRevision = await requestValue(metaStore.get(REVISION_KEY) as IDBRequest<number | undefined>);
    const actualRevision = Number.isSafeInteger(storedRevision) && (storedRevision ?? 0) >= 0 ? storedRevision! : 0;
    if (actualRevision !== knownRevision) {
      transaction.abort();
      throw new StorageConflictError();
    }

    applyStateDiff(transaction, lastSavedState, state);
    metaStore.put(state.activeGameId, ACTIVE_GAME_KEY);
    metaStore.put(true, STATE_INITIALIZED_KEY);
    metaStore.put(actualRevision + 1, REVISION_KEY);

    await transactionDone(transaction);
    knownRevision = actualRevision + 1;
    lastSavedState = state;
    announceRevision();
  } finally {
    db.close();
  }
}

async function rewriteCanonicalState(state: PersistedState, expectedRevision: number): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([GAMES_STORE, SONGS_STORE, MEDIA_TRACKS_STORE, AUDIO_STORE, SESSIONS_STORE, META_STORE], 'readwrite');
    const gamesStore = transaction.objectStore(GAMES_STORE);
    const songsStore = transaction.objectStore(SONGS_STORE);
    const mediaTracksStore = transaction.objectStore(MEDIA_TRACKS_STORE);
    const audioStore = transaction.objectStore(AUDIO_STORE);
    const sessionsStore = transaction.objectStore(SESSIONS_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const storedRevision = await requestValue(metaStore.get(REVISION_KEY) as IDBRequest<number | undefined>);
    const actualRevision = Number.isSafeInteger(storedRevision) && (storedRevision ?? 0) >= 0 ? storedRevision! : 0;
    if (actualRevision !== expectedRevision) {
      transaction.abort();
      throw new StorageConflictError();
    }
    gamesStore.clear();
    songsStore.clear();
    mediaTracksStore.clear();
    audioStore.clear();
    sessionsStore.clear();
    state.games.forEach((game) => gamesStore.put(game));
    state.songs.forEach((song) => songsStore.put(song));
    state.mediaTracks.forEach((track) => mediaTracksStore.put(track));
    state.audioAssets.forEach((asset) => audioStore.put(asset));
    state.sessions.forEach((session) => sessionsStore.put(session));
    metaStore.put(state.activeGameId, ACTIVE_GAME_KEY);
    metaStore.put(true, STATE_INITIALIZED_KEY);
    metaStore.put(actualRevision + 1, REVISION_KEY);

    await transactionDone(transaction);
    knownRevision = actualRevision + 1;
    announceRevision();
  } finally {
    db.close();
  }
}

function applyStateDiff(transaction: IDBTransaction, previous: PersistedState | null, next: PersistedState) {
  syncStore(
    transaction.objectStore(GAMES_STORE),
    previous?.games ?? [],
    next.games,
    (item) => item.id,
    (before, after) => before.updatedAt === after.updatedAt && before === after,
  );
  syncStore(
    transaction.objectStore(SONGS_STORE),
    previous?.songs ?? [],
    next.songs,
    (item) => item.id,
    (before, after) => before.updatedAt === after.updatedAt && before === after,
  );
  syncStore(
    transaction.objectStore(MEDIA_TRACKS_STORE),
    previous?.mediaTracks ?? [],
    next.mediaTracks,
    (item) => item.id,
    (before, after) => before.updatedAt === after.updatedAt && before === after,
  );
  syncStore(
    transaction.objectStore(SESSIONS_STORE),
    previous?.sessions ?? [],
    next.sessions,
    (item) => item.gameId,
    (before, after) => before === after || JSON.stringify(before) === JSON.stringify(after),
  );
  syncStore(
    transaction.objectStore(AUDIO_STORE),
    previous?.audioAssets ?? [],
    next.audioAssets,
    (item) => item.id,
    (before, after) => before.id === after.id,
  );
}

function syncStore<T>(
  store: IDBObjectStore,
  previous: T[],
  next: T[],
  keyOf: (item: T) => string,
  equal: (before: T, after: T) => boolean,
) {
  const previousById = new Map(previous.map((item) => [keyOf(item), item]));
  const nextIds = new Set(next.map(keyOf));
  for (const item of previous) {
    const key = keyOf(item);
    if (!nextIds.has(key)) store.delete(key);
  }
  for (const item of next) {
    const previousItem = previousById.get(keyOf(item));
    if (!previousItem || !equal(previousItem, item)) store.put(item);
  }
}

type StoredSong = Song & { minusAudioId?: string; plusAudioId?: string; minusTrackId?: string; plusTrackId?: string };

async function canonicalizeLoadedState(raw: {
  games: GameConfig[];
  songs: StoredSong[];
  mediaTracks: MediaTrack[];
  audioAssets: Array<Partial<AudioAsset> & { size?: number }>;
  sessions: GameSession[];
  activeGameId: string | null;
}): Promise<{ state: PersistedState; changed: boolean }> {
  const audioAssets: AudioAsset[] = [];
  const canonicalByHash = new Map<string, AudioAsset>();
  const oldToNewAudioId = new Map<string, string>();
  let changed = false;

  for (const rawAsset of raw.audioAssets) {
    const oldId = typeof rawAsset.id === 'string' ? rawAsset.id : '';
    const canonical = await canonicalizeAudioAsset(rawAsset);
    if (oldId) oldToNewAudioId.set(oldId, canonical.id);
    if (oldId !== canonical.id || rawAsset.sha256 !== canonical.sha256 || rawAsset.verified !== true || 'size' in rawAsset) changed = true;
    if (!canonicalByHash.has(canonical.id)) {
      canonicalByHash.set(canonical.id, canonical);
      audioAssets.push(canonical);
    } else {
      changed = true;
    }
  }

  const mediaTracks: MediaTrack[] = [];
  const trackById = new Map<string, MediaTrack>();
  const firstTrackByAudioId = new Map<string, MediaTrack>();
  for (const rawTrack of raw.mediaTracks ?? []) {
    const audioId = oldToNewAudioId.get(rawTrack.audioId) ?? rawTrack.audioId;
    const track = audioId === rawTrack.audioId ? rawTrack : { ...rawTrack, audioId, updatedAt: Date.now() };
    if (audioId !== rawTrack.audioId) changed = true;
    if (trackById.has(track.id)) {
      changed = true;
      continue;
    }
    trackById.set(track.id, track);
    if (!firstTrackByAudioId.has(track.audioId)) firstTrackByAudioId.set(track.audioId, track);
    mediaTracks.push(track);
  }

  const ensureTrackForLegacyAudio = (legacyAudioId: string | undefined, roleName: string) => {
    if (!legacyAudioId) return undefined;
    const audioId = oldToNewAudioId.get(legacyAudioId) ?? legacyAudioId;
    const existing = firstTrackByAudioId.get(audioId);
    if (existing) return existing.id;
    const asset = canonicalByHash.get(audioId);
    if (!asset) return undefined;
    const track = createMediaTrack(asset, roleName || asset.name);
    mediaTracks.push(track);
    trackById.set(track.id, track);
    firstTrackByAudioId.set(audioId, track);
    changed = true;
    return track.id;
  };

  const songs: Song[] = raw.songs.map((rawSong) => {
    const legacyMinusAudioId = rawSong.minusAudioId;
    const legacyPlusAudioId = rawSong.plusAudioId;
    const minusTrackId = rawSong.minusTrackId ?? ensureTrackForLegacyAudio(
      legacyMinusAudioId,
      `${rawSong.artist || 'Без исполнителя'} — ${rawSong.title || 'Без названия'} (минус)`,
    );
    const plusTrackId = rawSong.plusTrackId ?? ensureTrackForLegacyAudio(
      legacyPlusAudioId,
      `${rawSong.artist || 'Без исполнителя'} — ${rawSong.title || 'Без названия'} (плюс)`,
    );
    if (legacyMinusAudioId !== undefined || legacyPlusAudioId !== undefined || !('minusTrackId' in rawSong) || !('plusTrackId' in rawSong)) changed = true;
    return {
      id: rawSong.id,
      artist: rawSong.artist,
      title: rawSong.title,
      minusTrackId,
      plusTrackId,
      createdAt: rawSong.createdAt,
      updatedAt: rawSong.updatedAt,
    };
  });

  const normalizedGames = raw.games.map((rawGame) => {
    const normalized = normalizeGameConfig(rawGame);
    if (normalized.changed) changed = true;
    return normalized.game;
  });

  const gameById = new Map(normalizedGames.map((game) => [game.id, game]));
  const sessionsByGameId = new Map<string, GameSession>();
  for (const rawSession of raw.sessions) {
    const game = gameById.get(rawSession?.gameId);
    if (!game || sessionsByGameId.has(game.id)) {
      changed = true;
      continue;
    }
    const reconciled = reconcileSession(game, rawSession);
    if (JSON.stringify(reconciled) !== JSON.stringify(rawSession)) changed = true;
    sessionsByGameId.set(game.id, reconciled);
  }
  for (const game of normalizedGames) {
    if (!sessionsByGameId.has(game.id)) {
      sessionsByGameId.set(game.id, createSession(game));
      changed = true;
    }
  }

  return {
    changed,
    state: {
      version: 4,
      games: normalizedGames,
      songs,
      mediaTracks,
      audioAssets,
      sessions: [...sessionsByGameId.values()],
      activeGameId: raw.activeGameId,
    },
  };
}

async function deleteLegacyState() {
  const db = await openDatabase();
  try {
    if (!db.objectStoreNames.contains(LEGACY_STORE)) return;
    const transaction = db.transaction(LEGACY_STORE, 'readwrite');
    transaction.objectStore(LEGACY_STORE).delete(LEGACY_STATE_KEY);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка транзакции IndexedDB.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Транзакция IndexedDB отменена.'));
  });
}

export async function getStorageEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}

export async function requestPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function isPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return false;
  return navigator.storage.persisted();
}
