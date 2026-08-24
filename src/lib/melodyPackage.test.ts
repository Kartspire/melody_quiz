import { describe, expect, it } from 'vitest';
import { createGame, createInterRoundStage } from '../model/defaults';
import { createContinueLyricsInterRound } from '../interRounds/templates';
import type { AudioAsset, MediaTrack, PersistedState, Song } from '../model/types';
import { digestBlobWithCrc, sha256Blob } from './contentHash';
import { createStoredZip } from './zipStore';
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
  const minusTrack: MediaTrack = { id: 'track-minus-1', name: 'Кино — Группа крови (минус)', audioId: minus.id, createdAt: now, updatedAt: now };
  const plusTrack: MediaTrack = { id: 'track-plus-1', name: 'Кино — Группа крови (плюс)', audioId: plus.id, createdAt: now, updatedAt: now };
  const song: Song = {
    id: 'song-1',
    artist: 'Кино',
    title: 'Группа крови',
    minusTrackId: minusTrack.id,
    plusTrackId: plusTrack.id,
    createdAt: now,
    updatedAt: now,
  };
  game.rounds[0].categories[0].questions.forEach((question, index) => {
    question.songId = song.id;
    question.points = (index + 1) * 100;
  });
  return { game, song, minusTrack, plusTrack, minus, plus };
};

const emptyState = (): PersistedState => ({
  version: 4,
  games: [],
  songs: [],
  mediaTracks: [],
  audioAssets: [],
  sessions: [],
  activeGameId: null,
});

const emptyStats = {
  newSongs: 0,
  reusedSongs: 0,
  deduplicatedSongs: 0,
  newTracks: 0,
  reusedTracks: 0,
  deduplicatedTracks: 0,
  newAudio: 0,
  reusedAudio: 0,
  internalAudioReuses: 0,
};

describe('melody package', () => {
  it('exports and imports a game with media tracks and physical audio', async () => {
    const { game, song, minusTrack, plusTrack, minus, plus } = await makeFixture();
    const exported = await exportGamePackage(game, [song], [minusTrack, plusTrack], [minus, plus]);
    const parsed = await parseMelodyPackage(exported.blob);
    const state = emptyState();
    const prepared = await prepareGameImport(parsed, state);
    const imported = finalizeGameImport(prepared, state, 'copy');

    expect(parsed.manifest.type).toBe('melody-game');
    expect(parsed.manifest.formatVersion).toBe(4);
    expect(prepared.media.stats).toEqual({ ...emptyStats, newSongs: 1, newTracks: 2, newAudio: 2 });
    expect(imported.games).toHaveLength(1);
    expect(imported.songs).toHaveLength(1);
    expect(imported.mediaTracks).toHaveLength(2);
    expect(imported.audioAssets).toHaveLength(2);
    expect(imported.sessions).toHaveLength(1);
    expect(imported.games[0].rounds[0].categories[0].questions[0].songId).toBe(imported.songs[0].id);
    expect(imported.audioAssets.every((asset) => asset.id === asset.sha256)).toBe(true);
  });

  it('exports and imports standalone media used only by an inter-round', async () => {
    const game = createGame('Игра с межраундом');
    const audio = await makeAudio('lyrics.mp3', 27);
    const now = Date.now();
    const track: MediaTrack = { id: 'track-inter-round', name: 'Продолжи песню — задание 1', audioId: audio.id, createdAt: now, updatedAt: now };
    const interRound = createContinueLyricsInterRound();
    interRound.tasks[0] = {
      ...interRound.tasks[0],
      trackId: track.id,
      requiredWordsCount: 5,
      cutAtMs: 1_500,
      answerText: 'правильные следующие слова песни',
    };
    game.interRounds = [interRound];
    game.stages = [game.stages[0], createInterRoundStage(interRound.id)];

    const exported = await exportGamePackage(game, [], [track], [audio]);
    const parsed = await parseMelodyPackage(exported.blob);
    const state = emptyState();
    const prepared = await prepareGameImport(parsed, state);
    const imported = finalizeGameImport(prepared, state, 'copy');

    expect(parsed.manifest.formatVersion).toBe(4);
    expect(parsed.game?.interRounds).toHaveLength(1);
    expect(parsed.tracks).toHaveLength(1);
    expect(imported.games[0].stages.map((stage) => stage.kind)).toEqual(['round', 'interRound']);
    const importedInterRound = imported.games[0].interRounds[0];
    expect(importedInterRound.templateId).toBe('continueLyrics');
    if (importedInterRound.templateId === 'continueLyrics') {
      expect(importedInterRound.tasks[0].trackId).toBe(imported.mediaTracks[0].id);
    }
  });

  it('does not duplicate songs, tracks or physical audio when the same archive is imported again', async () => {
    const { game, song, minusTrack, plusTrack, minus, plus } = await makeFixture();
    const parsed = await parseMelodyPackage((await exportGamePackage(game, [song], [minusTrack, plusTrack], [minus, plus])).blob);
    const state = emptyState();
    const first = finalizeGameImport(await prepareGameImport(parsed, state), state, 'copy');
    const preparedAgain = await prepareGameImport(parsed, first);
    const copied = finalizeGameImport(preparedAgain, first, 'copy');

    expect(preparedAgain.hasGameConflict).toBe(true);
    expect(preparedAgain.media.stats.newSongs).toBe(0);
    expect(preparedAgain.media.stats.reusedSongs).toBe(1);
    expect(preparedAgain.media.stats.newTracks).toBe(0);
    expect(preparedAgain.media.stats.reusedTracks).toBe(2);
    expect(preparedAgain.media.stats.newAudio).toBe(0);
    expect(preparedAgain.media.stats.reusedAudio).toBe(2);
    expect(copied.games).toHaveLength(2);
    expect(copied.songs).toHaveLength(1);
    expect(copied.mediaTracks).toHaveLength(2);
    expect(copied.audioAssets).toHaveLength(2);
  });

  it('preserves standalone media tracks in a library export', async () => {
    const { song, minusTrack, plusTrack, minus, plus } = await makeFixture();
    const standaloneAudio = await makeAudio('jingle.mp3', 17);
    const now = Date.now();
    const standaloneTrack: MediaTrack = { id: 'track-jingle', name: 'Заставка межраунда', audioId: standaloneAudio.id, createdAt: now, updatedAt: now };
    const parsed = await parseMelodyPackage((await exportLibraryPackage([song], [minusTrack, plusTrack, standaloneTrack], [minus, plus, standaloneAudio])).blob);
    const prepared = await prepareMediaMerge(parsed, [], [], []);

    expect(prepared.songs).toHaveLength(1);
    expect(prepared.mediaTracks).toHaveLength(3);
    expect(prepared.audioAssets).toHaveLength(3);
    expect(prepared.mediaTracks.some((track) => track.name === 'Заставка межраунда')).toBe(true);
  });

  it('preserves distinct logical songs while deduplicating only physical audio', async () => {
    const { song, minusTrack, plusTrack, minus, plus } = await makeFixture();
    const duplicate: Song = { ...song, id: 'song-2' };
    const exported = await exportLibraryPackage([song, duplicate], [minusTrack, plusTrack], [minus, plus]);
    const parsed = await parseMelodyPackage(exported.blob);
    const prepared = await prepareMediaMerge(parsed, [], [], []);

    expect(prepared.songs).toHaveLength(2);
    expect(prepared.mediaTracks).toHaveLength(2);
    expect(prepared.audioAssets).toHaveLength(2);
    expect(prepared.stats.newSongs).toBe(2);
    expect(prepared.stats.deduplicatedSongs).toBe(0);
    expect(prepared.stats.newTracks).toBe(2);
    expect(prepared.stats.newAudio).toBe(2);
  });

  it('keeps two semantic media tracks while storing the same physical audio only once', async () => {
    const sharedAudio = await makeAudio('shared.mp3', 33);
    const now = Date.now();
    const first: MediaTrack = { id: 'track-shared-a', name: 'Фрагмент для песни', audioId: sharedAudio.id, createdAt: now, updatedAt: now };
    const second: MediaTrack = { id: 'track-shared-b', name: 'Фрагмент для межраунда', audioId: sharedAudio.id, createdAt: now, updatedAt: now };

    const parsed = await parseMelodyPackage((await exportLibraryPackage([], [first, second], [sharedAudio])).blob);
    const prepared = await prepareMediaMerge(parsed, [], [], []);

    expect(prepared.mediaTracks).toHaveLength(2);
    expect(prepared.audioAssets).toHaveLength(1);
    expect(prepared.stats.newTracks).toBe(2);
    expect(prepared.stats.newAudio).toBe(1);
    expect(prepared.stats.internalAudioReuses).toBe(1);
  });

  it('imports legacy v1 packages and migrates direct song audio refs to media tracks', async () => {
    const audio = await makeAudio('legacy.mp3', 41);
    const audioDigests = await digestBlobWithCrc(audio.blob);
    const audioPath = `audio/${audio.sha256}.mp3`;
    const now = Date.now();
    const legacySongs = [{
      id: 'legacy-song',
      artist: 'Legacy',
      title: 'Song',
      minus: { path: audioPath, name: audio.name, type: audio.type, size: audio.blob.size, sha256: audio.sha256 },
      createdAt: now,
      updatedAt: now,
    }];
    const songsBlob = new Blob([JSON.stringify(legacySongs)], { type: 'application/json' });
    const songsDigests = await digestBlobWithCrc(songsBlob);
    const manifest = {
      type: 'melody-library',
      formatVersion: 1,
      appVersion: '1.3.4',
      exportedAt: new Date().toISOString(),
      files: [
        { path: 'songs.json', size: songsBlob.size, sha256: songsDigests.sha256, mediaType: 'application/json' },
        { path: audioPath, size: audio.blob.size, sha256: audio.sha256, mediaType: audio.type },
      ],
    };
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const manifestDigests = await digestBlobWithCrc(manifestBlob);
    const archive = await createStoredZip([
      { name: 'manifest.json', data: manifestBlob, crc32: manifestDigests.crc32 },
      { name: 'songs.json', data: songsBlob, crc32: songsDigests.crc32 },
      { name: audioPath, data: audio.blob, crc32: audioDigests.crc32 },
    ]);

    const parsed = await parseMelodyPackage(archive);
    const prepared = await prepareMediaMerge(parsed, [], [], []);

    expect(parsed.manifest.formatVersion).toBe(1);
    expect(parsed.tracks).toHaveLength(1);
    expect(prepared.songs).toHaveLength(1);
    expect(prepared.mediaTracks).toHaveLength(1);
    expect(prepared.audioAssets).toHaveLength(1);
    expect(prepared.songs[0].minusTrackId).toBe(prepared.mediaTracks[0].id);
  });

  it('allows exporting and importing an unfinished draft game as a backup', async () => {
    const game = createGame('Черновик');
    const interRound = createContinueLyricsInterRound();
    interRound.tasks[0] = {
      ...interRound.tasks[0],
      trackId: undefined,
      answerText: '',
    };
    game.interRounds = [interRound];
    game.stages = [game.stages[0], createInterRoundStage(interRound.id)];

    const exported = await exportGamePackage(game, [], [], []);
    const parsed = await parseMelodyPackage(exported.blob);

    expect(parsed.game?.id).toBe(game.id);
    expect(parsed.game?.interRounds[0].templateId).toBe('continueLyrics');
  });

  it('rejects an archive with tampered bytes', async () => {
    const { song, minusTrack, plusTrack, minus, plus } = await makeFixture();
    const exported = await exportLibraryPackage([song], [minusTrack, plusTrack], [minus, plus]);
    const bytes = new Uint8Array(await exported.blob.arrayBuffer());
    bytes[Math.floor(bytes.length / 3)] ^= 0xff;
    await expect(parseMelodyPackage(new Blob([bytes]))).rejects.toThrow();
  });
});
