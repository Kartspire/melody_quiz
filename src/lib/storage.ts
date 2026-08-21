import { createInitialState, migrateLegacyState } from '../model/defaults';
import type { AudioAsset, GameConfig, GameSession, LegacyPersistedState, PersistedState, Song } from '../model/types';

const DB_NAME = 'melody-quiz-db';
const DB_VERSION = 2;
const LEGACY_STORE = 'state';
const LEGACY_STATE_KEY = 'app-state';
const GAMES_STORE = 'games';
const SONGS_STORE = 'songs';
const AUDIO_STORE = 'audio';
const SESSIONS_STORE = 'sessions';
const META_STORE = 'meta';
const ACTIVE_GAME_KEY = 'active-game-id';
const STATE_INITIALIZED_KEY = 'state-initialized';

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE);
      if (!db.objectStoreNames.contains(GAMES_STORE)) db.createObjectStore(GAMES_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SONGS_STORE)) db.createObjectStore(SONGS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) db.createObjectStore(SESSIONS_STORE, { keyPath: 'gameId' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const requestValue = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const loadState = async (): Promise<PersistedState> => {
  const db = await openDatabase();
  const transaction = db.transaction(
    [GAMES_STORE, SONGS_STORE, AUDIO_STORE, SESSIONS_STORE, META_STORE, LEGACY_STORE],
    'readonly',
  );

  const [games, songs, audioAssets, sessions, activeGameId, initialized, legacy] = await Promise.all([
    requestValue(transaction.objectStore(GAMES_STORE).getAll() as IDBRequest<GameConfig[]>),
    requestValue(transaction.objectStore(SONGS_STORE).getAll() as IDBRequest<Song[]>),
    requestValue(transaction.objectStore(AUDIO_STORE).getAll() as IDBRequest<AudioAsset[]>),
    requestValue(transaction.objectStore(SESSIONS_STORE).getAll() as IDBRequest<GameSession[]>),
    requestValue(transaction.objectStore(META_STORE).get(ACTIVE_GAME_KEY) as IDBRequest<string | null | undefined>),
    requestValue(transaction.objectStore(META_STORE).get(STATE_INITIALIZED_KEY) as IDBRequest<boolean | undefined>),
    requestValue(transaction.objectStore(LEGACY_STORE).get(LEGACY_STATE_KEY) as IDBRequest<LegacyPersistedState | undefined>),
  ]);

  db.close();

  if (games.length > 0 || initialized) {
    return {
      version: 2,
      games,
      songs,
      audioAssets,
      sessions,
      activeGameId: games.some((game) => game.id === activeGameId) ? activeGameId! : games[0]?.id ?? null,
    };
  }

  const state = legacy?.config && legacy?.session ? migrateLegacyState(legacy) : createInitialState();
  await saveState(state);
  return state;
};

export const saveState = async (state: PersistedState): Promise<void> => {
  const db = await openDatabase();
  const transaction = db.transaction([GAMES_STORE, SONGS_STORE, AUDIO_STORE, SESSIONS_STORE, META_STORE], 'readwrite');

  const gamesStore = transaction.objectStore(GAMES_STORE);
  const songsStore = transaction.objectStore(SONGS_STORE);
  const audioStore = transaction.objectStore(AUDIO_STORE);
  const sessionsStore = transaction.objectStore(SESSIONS_STORE);
  const metaStore = transaction.objectStore(META_STORE);

  // Lightweight entities are cheap to rewrite and this keeps their persistence atomic/simple.
  gamesStore.clear();
  songsStore.clear();
  sessionsStore.clear();

  state.games.forEach((game) => gamesStore.put(game));
  state.songs.forEach((song) => songsStore.put(song));
  state.sessions.forEach((session) => sessionsStore.put(session));
  metaStore.put(state.activeGameId, ACTIVE_GAME_KEY);
  metaStore.put(true, STATE_INITIALIZED_KEY);

  // Audio blobs can be hundreds of megabytes. Keep existing immutable blobs and only
  // add new ids / remove ids that are no longer referenced instead of rewriting all audio
  // after every small editor change.
  const usedAudioIds = new Set(
    state.songs.flatMap((song) => [song.minusAudioId, song.plusAudioId].filter((id): id is string => Boolean(id))),
  );
  const wantedAssets = state.audioAssets.filter((asset) => usedAudioIds.has(asset.id));
  const audioKeysRequest = audioStore.getAllKeys();
  audioKeysRequest.onsuccess = () => {
    const existingIds = new Set<string>();
    for (const key of audioKeysRequest.result) {
      if (typeof key === 'string') {
        existingIds.add(key);
        if (!usedAudioIds.has(key)) audioStore.delete(key);
      } else {
        audioStore.delete(key);
      }
    }
    for (const asset of wantedAssets) {
      if (!existingIds.has(asset.id)) audioStore.put(asset);
    }
  };
  audioKeysRequest.onerror = () => transaction.abort();

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? audioKeysRequest.error);
    };
  });
};
