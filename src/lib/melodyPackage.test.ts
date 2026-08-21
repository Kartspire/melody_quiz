import { describe, expect, it } from 'vitest';
import { createGame } from '../model/defaults';
import type { AudioAsset, PersistedState, Song } from '../model/types';
import {
  exportGamePackage,
  exportLibraryPackage,
  finalizeGameImport,
  parseMelodyPackage,
  prepareGameImport,
  prepareMediaMerge,
} from './melodyPackage';

const makeFixture = () => {
  const game = createGame('Тестовая игра');
  const minus: AudioAsset = {
    id: 'audio-minus',
    name: 'minus.mp3',
    type: 'audio/mpeg',
    size: 5,
    blob: new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'audio/mpeg' }),
  };
  const plus: AudioAsset = {
    id: 'audio-plus',
    name: 'plus.mp3',
    type: 'audio/mpeg',
    size: 4,
    blob: new Blob([new Uint8Array([6, 7, 8, 9])], { type: 'audio/mpeg' }),
  };
  const song: Song = {
    id: 'song-1',
    artist: 'Кино',
    title: 'Группа крови',
    minusAudioId: minus.id,
    plusAudioId: plus.id,
    createdAt: 1,
    updatedAt: 1,
  };
  game.rounds[0].categories[0].questions[0].songId = song.id;
  return { game, song, minus, plus };
};

const emptyState = (): PersistedState => ({
  version: 2,
  games: [],
  songs: [],
  audioAssets: [],
  sessions: [],
  activeGameId: null,
});

describe('melody package', () => {
  it('exports and imports a game with its audio', async () => {
    const { game, song, minus, plus } = makeFixture();
    const exported = await exportGamePackage(game, [song], [minus, plus]);
    const parsed = await parseMelodyPackage(exported.blob);
    const state = emptyState();
    const prepared = await prepareGameImport(parsed, state);
    const imported = finalizeGameImport(prepared, state, 'copy');

    expect(parsed.manifest.type).toBe('melody-game');
    expect(prepared.media.stats).toEqual({ newSongs: 1, reusedSongs: 0, newAudio: 2, reusedAudio: 0 });
    expect(imported.games).toHaveLength(1);
    expect(imported.songs).toHaveLength(1);
    expect(imported.audioAssets).toHaveLength(2);
    expect(imported.sessions).toHaveLength(1);
    expect(imported.games[0].rounds[0].categories[0].questions[0].songId).toBe(imported.songs[0].id);
  });

  it('does not duplicate songs and audio when the same archive is imported again', async () => {
    const { game, song, minus, plus } = makeFixture();
    const exported = await exportGamePackage(game, [song], [minus, plus]);
    const parsed = await parseMelodyPackage(exported.blob);
    const state = emptyState();
    const first = finalizeGameImport(await prepareGameImport(parsed, state), state, 'copy');
    const preparedAgain = await prepareGameImport(parsed, first);
    const copied = finalizeGameImport(preparedAgain, first, 'copy');

    expect(preparedAgain.hasGameConflict).toBe(true);
    expect(preparedAgain.media.stats).toEqual({ newSongs: 0, reusedSongs: 1, newAudio: 0, reusedAudio: 2 });
    expect(copied.games).toHaveLength(2);
    expect(copied.songs).toHaveLength(1);
    expect(copied.audioAssets).toHaveLength(2);
    expect(copied.games[1].id).not.toBe(game.id);
  });

  it('merges an exported media library without duplicates', async () => {
    const { song, minus, plus } = makeFixture();
    const library = await exportLibraryPackage([song], [minus, plus]);
    const parsed = await parseMelodyPackage(library.blob);
    const first = await prepareMediaMerge(parsed, [], []);
    const second = await prepareMediaMerge(parsed, first.songs, first.audioAssets);

    expect(parsed.manifest.type).toBe('melody-library');
    expect(first.stats).toEqual({ newSongs: 1, reusedSongs: 0, newAudio: 2, reusedAudio: 0 });
    expect(second.stats).toEqual({ newSongs: 0, reusedSongs: 1, newAudio: 0, reusedAudio: 2 });
  });
});
