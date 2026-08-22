import { createStore } from 'effector';
import { createGame, createSession } from '../defaults';
import type { AudioAsset, GameConfig, GameSession, MediaTrack, Song } from '../types';

const initialGame = createGame('Угадай мелодию');

export const $games = createStore<GameConfig[]>([initialGame]);
export const $songs = createStore<Song[]>([]);
export const $mediaTracks = createStore<MediaTrack[]>([]);
export const $audioAssets = createStore<AudioAsset[]>([]);
export const $sessions = createStore<Record<string, GameSession>>({
  [initialGame.id]: createSession(initialGame),
});
export const $activeGameId = createStore<string | null>(initialGame.id);
