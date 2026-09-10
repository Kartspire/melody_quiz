import { combine, createEvent, sample } from 'effector';
import { cloneSong } from '../defaults';
import { DATA_LIMITS } from '../limits';
import { isMediaTrackUsed } from './selectors';
import { assertValidMediaTrack, isValidTimestamp } from '../validation';
import { isVerifiedAudioAsset } from './domain/audioAsset';
import { removableAudioIdAfterTrackRemoval } from './domain/libraryIdentity';
import { $audioAssets, $audioProjects, $games, $mediaTracks, $songs } from '../core/state';
import type { AudioAsset, MediaTrack, Song } from '../types';

export const songAdded = createEvent<{ song: Song; mediaTracks: MediaTrack[]; audioAssets: AudioAsset[] }>();
export const mediaTrackAdded = createEvent<{ track: MediaTrack; audioAsset: AudioAsset }>();
export const mediaTrackChanged = createEvent<{ trackId: string; patch: Partial<Pick<MediaTrack, 'name'>> }>();
export const mediaTrackAudioChanged = createEvent<{ trackId: string; audioAsset: AudioAsset }>();
export const mediaTrackDeleteRequested = createEvent<string>();
export const songChanged = createEvent<{ songId: string; patch: Partial<Pick<Song, 'artist' | 'title'>> }>();
export const songDuplicated = createEvent<string>();
export const songDeleteRequested = createEvent<string>();
export const songTrackChanged = createEvent<{
  songId: string;
  kind: 'minus' | 'plus';
  trackId?: string;
  track?: MediaTrack;
  audioAsset?: AudioAsset;
}>();

const songAdditionApplied = createEvent<{ song: Song; mediaTracks: MediaTrack[]; audioAssets: AudioAsset[] }>();
const mediaTrackAdditionApplied = createEvent<{ track: MediaTrack; audioAsset: AudioAsset }>();
const mediaTrackAudioChangeApplied = createEvent<{
  trackId: string;
  audioAsset: AudioAsset;
  removableAudioId?: string;
}>();
const songTrackChangeApplied = createEvent<{
  songId: string;
  kind: 'minus' | 'plus';
  trackId?: string;
  track?: MediaTrack;
  audioAsset?: AudioAsset;
}>();
const mediaTrackDeletionApplied = createEvent<{ trackId: string; removableAudioId?: string }>();
const songDeletionApplied = createEvent<{ songId: string; removableAudioIds: string[] }>();

$games.on(songDeletionApplied, (games, { songId }) => games.map((game) => {
  let changed = false;
  const rounds = game.rounds.map((round) => ({
    ...round,
    categories: round.categories.map((category) => ({
      ...category,
      questions: category.questions.map((question) => {
        if (question.songId !== songId) return question;
        changed = true;
        return { id: question.id, points: question.points };
      }),
    })),
  }));
  return changed ? { ...game, rounds, updatedAt: Date.now() } : game;
}));

$songs
  .on(songAdditionApplied, (songs, { song }) => {
    if (songs.some((item) => item.id === song.id)) return songs;
    if (
      song.artist.length > DATA_LIMITS.text.artist
      || song.title.length > DATA_LIMITS.text.songTitle
      || (!song.artist.trim() && !song.title.trim())
    ) return songs;
    return [...songs, song];
  })
  .on(songDuplicated, (songs, songId) => {
    const source = songs.find((song) => song.id === songId);
    return source ? [...songs, cloneSong(source)] : songs;
  })
  .on(songChanged, (songs, { songId, patch }) => {
    if (
      (patch.artist !== undefined && patch.artist.length > DATA_LIMITS.text.artist)
      || (patch.title !== undefined && patch.title.length > DATA_LIMITS.text.songTitle)
    ) return songs;
    return songs.map((song) => {
      if (song.id !== songId) return song;
      const next = { ...song, ...patch };
      if (!next.artist.trim() && !next.title.trim()) return song;
      return { ...next, updatedAt: Date.now() };
    });
  })
  .on(songTrackChangeApplied, (songs, { songId, kind, trackId }) =>
    songs.map((song) =>
      song.id === songId
        ? {
            ...song,
            [kind === 'minus' ? 'minusTrackId' : 'plusTrackId']: trackId,
            updatedAt: Date.now(),
          }
        : song,
    ),
  )
  .on(songDeletionApplied, (songs, { songId }) => songs.filter((song) => song.id !== songId));

$mediaTracks
  .on(songAdditionApplied, (tracks, { mediaTracks }) => mergeById(tracks, mediaTracks))
  .on(mediaTrackAdditionApplied, (tracks, { track }) => mergeById(tracks, [track]))
  .on(mediaTrackChanged, (tracks, { trackId, patch }) => tracks.map((track) => {
    if (track.id !== trackId) return track;
    const name = patch.name ?? track.name;
    if (!name.trim() || name.length > DATA_LIMITS.text.mediaTrackName) return track;
    return { ...track, ...patch, updatedAt: Date.now() };
  }))
  .on(mediaTrackAudioChangeApplied, (tracks, { trackId, audioAsset }) => tracks.map((track) =>
    track.id === trackId ? { ...track, audioId: audioAsset.id, updatedAt: Date.now() } : track,
  ))
  .on(songTrackChangeApplied, (tracks, { track }) => track ? mergeById(tracks, [track]) : tracks)
  .on(mediaTrackDeletionApplied, (tracks, { trackId }) => tracks.filter((track) => track.id !== trackId));

$audioAssets
  .on(songAdditionApplied, (assets, { audioAssets }) => mergeAudioAssets(assets, audioAssets))
  .on(mediaTrackAdditionApplied, (assets, { audioAsset }) => mergeAudioAssets(assets, [audioAsset]))
  .on(mediaTrackAudioChangeApplied, (assets, { audioAsset, removableAudioId }) => {
    const withoutOld = removableAudioId && removableAudioId !== audioAsset.id
      ? assets.filter((asset) => asset.id !== removableAudioId)
      : assets;
    return mergeAudioAssets(withoutOld, [audioAsset]);
  })
  .on(songTrackChangeApplied, (assets, { audioAsset }) => audioAsset ? mergeAudioAssets(assets, [audioAsset]) : assets)
  .on(mediaTrackDeletionApplied, (assets, { removableAudioId }) =>
    removableAudioId ? assets.filter((asset) => asset.id !== removableAudioId) : assets,
  );

sample({
  clock: songAdded,
  source: combine({ songs: $songs, mediaTracks: $mediaTracks, audioAssets: $audioAssets }),
  filter: ({ songs, mediaTracks, audioAssets }, payload) => isValidSongAddition(
    songs,
    mediaTracks,
    audioAssets,
    payload,
  ),
  fn: (_, payload) => payload,
  target: songAdditionApplied,
});

sample({
  clock: mediaTrackAdded,
  source: $mediaTracks,
  filter: (tracks, { track, audioAsset }) => !tracks.some((item) => item.id === track.id)
    && isValidMediaTrackValue(track)
    && track.audioId === audioAsset.id
    && isVerifiedAudioAsset(audioAsset),
  fn: (_, payload) => payload,
  target: mediaTrackAdditionApplied,
});

sample({
  clock: mediaTrackAudioChanged,
  source: $mediaTracks,
  filter: (tracks, { trackId, audioAsset }) => tracks.some((track) => track.id === trackId)
    && isVerifiedAudioAsset(audioAsset),
  fn: (tracks, { trackId, audioAsset }) => {
    const current = tracks.find((track) => track.id === trackId)!;
    const removableAudioId = current.audioId !== audioAsset.id
      && !tracks.some((track) => track.id !== trackId && track.audioId === current.audioId)
      ? current.audioId
      : undefined;
    return { trackId, audioAsset, removableAudioId };
  },
  target: mediaTrackAudioChangeApplied,
});

sample({
  clock: songTrackChanged,
  source: combine({ songs: $songs, mediaTracks: $mediaTracks }),
  filter: ({ songs, mediaTracks }, payload) => {
    if (!songs.some((song) => song.id === payload.songId)) return false;
    if (!payload.trackId && !payload.track) return true;
    if (payload.track) {
      return !mediaTracks.some((track) => track.id === payload.track!.id)
        && payload.track.id === (payload.trackId ?? payload.track.id)
        && isValidMediaTrackValue(payload.track)
        && payload.audioAsset?.id === payload.track.audioId
        && isVerifiedAudioAsset(payload.audioAsset);
    }
    return mediaTracks.some((track) => track.id === payload.trackId);
  },
  fn: (_, payload) => ({ ...payload, trackId: payload.trackId ?? payload.track?.id }),
  target: songTrackChangeApplied,
});

sample({
  clock: mediaTrackDeleteRequested,
  source: combine({ songs: $songs, mediaTracks: $mediaTracks, games: $games, audioProjects: $audioProjects }),
  filter: ({ songs, mediaTracks, games, audioProjects }, trackId) => mediaTracks.some((track) => track.id === trackId)
    && !isMediaTrackUsed(games, songs, trackId, audioProjects),
  fn: ({ mediaTracks }, trackId) => ({
    trackId,
    removableAudioId: removableAudioIdAfterTrackRemoval(mediaTracks, trackId),
  }),
  target: mediaTrackDeletionApplied,
});

sample({
  clock: songDeleteRequested,
  source: $songs,
  filter: (songs, songId) => songs.some((song) => song.id === songId),
  fn: (_, songId) => ({ songId, removableAudioIds: [] }),
  target: songDeletionApplied,
});

function isValidSongAddition(
  songs: Song[],
  currentTracks: MediaTrack[],
  currentAssets: AudioAsset[],
  payload: { song: Song; mediaTracks: MediaTrack[]; audioAssets: AudioAsset[] },
) {
  const { song, mediaTracks, audioAssets } = payload;
  if (songs.some((item) => item.id === song.id)) return false;
  if (
    !song.id
    || song.id.length > DATA_LIMITS.text.id
    || song.artist.length > DATA_LIMITS.text.artist
    || song.title.length > DATA_LIMITS.text.songTitle
    || (!song.artist.trim() && !song.title.trim())
    || !isValidTimestamp(song.createdAt)
    || !isValidTimestamp(song.updatedAt)
  ) return false;

  if (audioAssets.some((asset) => !isVerifiedAudioAsset(asset))) return false;
  const availableAudioIds = new Set([...currentAssets, ...audioAssets].map((asset) => asset.id));
  const currentTrackIds = new Set(currentTracks.map((track) => track.id));
  const additionTrackIds = new Set<string>();
  for (const track of mediaTracks) {
    if (!isValidMediaTrackValue(track) || currentTrackIds.has(track.id) || additionTrackIds.has(track.id) || !availableAudioIds.has(track.audioId)) return false;
    additionTrackIds.add(track.id);
  }

  const availableTrackIds = new Set([...currentTrackIds, ...additionTrackIds]);
  return [song.minusTrackId, song.plusTrackId].every((trackId) => !trackId || availableTrackIds.has(trackId));
}

function isValidMediaTrackValue(track: MediaTrack) {
  try {
    assertValidMediaTrack(track);
    return true;
  } catch {
    return false;
  }
}

function mergeAudioAssets(current: AudioAsset[], additions: AudioAsset[]) {
  if (additions.length === 0) return current;
  const byId = new Map(current.map((asset) => [asset.id, asset]));
  for (const asset of additions) if (!byId.has(asset.id)) byId.set(asset.id, asset);
  return [...byId.values()];
}

function mergeById<T extends { id: string }>(current: T[], additions: T[]) {
  if (additions.length === 0) return current;
  const byId = new Map(current.map((item) => [item.id, item]));
  additions.forEach((item) => { if (!byId.has(item.id)) byId.set(item.id, item); });
  return [...byId.values()];
}
