import { describe, expect, it } from 'vitest';
import { createGame } from '../model/defaults';
import type { AudioAsset, PersistedState, Song } from '../model/types';
import { sha256Blob } from './contentHash';
import {
  exportGamePackage,
  exportLibraryPackage,
  finalizeGameImport,
  parseMelodyPackage,
  prepareGameImport,
  prepareMediaMerge,
} from './melodyPackage';

const mp3Blob = (seed: number) => new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x64, seed, seed + 1, seed + 2, seed + 3])], { type: 'audio/mpeg' });

const makeAudio = async (name: string, seed: number): Promise<AudioAsset> => {
  const blob = mp3Blob(seed);
  const sha256 = await sha256Blob(blob);
  return { id: sha256, name, type: 'audio/mpeg', blob, sha256, verified: true };
};

const makeFixture = async () => {
  const game = createGame('Тестовая игра');
  const minus = await makeAudio('minus.mp3', 1);
  const plus = await makeAudio('plus.mp3', 9);
  const now = Date.now();
  const song: Song = {
    id: 'song-1',
    artist: 'Кино',
    title: 'Группа крови',
    minusAudioId: minus.id,
    plusAudioId: plus.id,
    createdAt: now,
    updatedAt: now,
  };
  game.rounds[0].categories[0].questions.forEach((question, index) => {
    question.songId = song.id;
    question.points = (index + 1) * 100;
  });
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

const emptyStats = {
  newSongs: 0,
  reusedSongs: 0,
  deduplicatedSongs: 0,
  newAudio: 0,
  reusedAudio: 0,
  internalAudioReuses: 0,
};

describe('melody package', () => {
  it('exports and imports a game with its audio', async () => {
    const { game, song, minus, plus } = await makeFixture();
    const exported = await exportGamePackage(game, [song], [minus, plus]);
    const parsed = await parseMelodyPackage(exported.blob);
    const state = emptyState();
    const prepared = await prepareGameImport(parsed, state);
    const imported = finalizeGameImport(prepared, state, 'copy');

    expect(parsed.manifest.type).toBe('melody-game');
    expect(prepared.media.stats).toEqual({ ...emptyStats, newSongs: 1, newAudio: 2 });
    expect(imported.games).toHaveLength(1);
    expect(imported.songs).toHaveLength(1);
    expect(imported.audioAssets).toHaveLength(2);
    expect(imported.sessions).toHaveLength(1);
    expect(imported.games[0].rounds[0].categories[0].questions[0].songId).toBe(imported.songs[0].id);
    expect(imported.audioAssets.every((asset) => asset.id === asset.sha256)).toBe(true);
  });

  it('does not duplicate songs and audio when the same archive is imported again', async () => {
    const { game, song, minus, plus } = await makeFixture();
    const exported = await exportGamePackage(game, [song], [minus, plus]);
    const parsed = await parseMelodyPackage(exported.blob);
    const state = emptyState();
    const first = finalizeGameImport(await prepareGameImport(parsed, state), state, 'copy');
    const preparedAgain = await prepareGameImport(parsed, first);
    const copied = finalizeGameImport(preparedAgain, first, 'copy');

    expect(preparedAgain.hasGameConflict).toBe(true);
    expect(preparedAgain.media.stats.newSongs).toBe(0);
    expect(preparedAgain.media.stats.reusedSongs).toBe(1);
    expect(preparedAgain.media.stats.newAudio).toBe(0);
    expect(preparedAgain.media.stats.reusedAudio).toBe(2);
    expect(copied.games).toHaveLength(2);
    expect(copied.songs).toHaveLength(1);
    expect(copied.audioAssets).toHaveLength(2);
    expect(copied.games[1].id).not.toBe(game.id);
  });

  it('merges an exported media library without duplicates', async () => {
    const { song, minus, plus } = await makeFixture();
    const library = await exportLibraryPackage([song], [minus, plus]);
    const parsed = await parseMelodyPackage(library.blob);
    const first = await prepareMediaMerge(parsed, [], []);
    const second = await prepareMediaMerge(parsed, first.songs, first.audioAssets);

    expect(parsed.manifest.type).toBe('melody-library');
    expect(first.stats.newSongs).toBe(1);
    expect(first.stats.newAudio).toBe(2);
    expect(second.stats.newSongs).toBe(0);
    expect(second.stats.reusedSongs).toBe(1);
    expect(second.stats.newAudio).toBe(0);
    expect(second.stats.reusedAudio).toBe(2);
  });

  it('deduplicates duplicate songs and shared audio inside one archive', async () => {
    const { song, minus, plus } = await makeFixture();
    const duplicate: Song = { ...song, id: 'song-2' };
    const exported = await exportLibraryPackage([song, duplicate], [minus, plus]);
    const parsed = await parseMelodyPackage(exported.blob);
    const prepared = await prepareMediaMerge(parsed, [], []);

    expect(prepared.songs).toHaveLength(1);
    expect(prepared.audioAssets).toHaveLength(2);
    expect(prepared.stats.newSongs).toBe(1);
    expect(prepared.stats.deduplicatedSongs).toBe(1);
    expect(prepared.stats.newAudio).toBe(2);
    expect(prepared.stats.internalAudioReuses).toBe(2);
  });

  it('rejects an archive with tampered bytes', async () => {
    const { song, minus, plus } = await makeFixture();
    const exported = await exportLibraryPackage([song], [minus, plus]);
    const bytes = new Uint8Array(await exported.blob.arrayBuffer());
    bytes[Math.floor(bytes.length / 3)] ^= 0xff;
    await expect(parseMelodyPackage(new Blob([bytes]))).rejects.toThrow();
  });
});
