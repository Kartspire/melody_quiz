import { createStore } from 'effector';
import { createGame, createSession } from '../defaults';
import { canWriteState } from './writeAccess';
import type { AudioAsset, AudioProject, GameConfig, GameSession, MediaTrack, Song } from '../types';

const initialGame = createGame('Угадай мелодию');

export const $games = createStore<GameConfig[]>([initialGame], { updateFilter: canWriteState });
export const $songs = createStore<Song[]>([], { updateFilter: canWriteState });
export const $mediaTracks = createStore<MediaTrack[]>([], { updateFilter: canWriteState });
export const $audioAssets = createStore<AudioAsset[]>([], { updateFilter: canWriteState });
export const $audioProjects = createStore<AudioProject[]>([], { updateFilter: canWriteState });
export const $sessions = createStore<Record<string, GameSession>>({
  [initialGame.id]: createSession(initialGame),
}, { updateFilter: canWriteState });
export const $activeGameId = createStore<string | null>(initialGame.id, { updateFilter: canWriteState });
