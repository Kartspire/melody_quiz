import type { MediaTrack, Song } from '../../types';


export function mediaTrackNameFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim() || 'Аудиотрек';
}

export function normalizeMediaIdentityText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

export function areMediaTracksEquivalent(
  left: Pick<MediaTrack, 'name' | 'audioId'>,
  right: Pick<MediaTrack, 'name' | 'audioId'>,
) {
  return left.audioId === right.audioId
    && normalizeMediaIdentityText(left.name) === normalizeMediaIdentityText(right.name);
}

export function findEquivalentMediaTrack(
  tracks: readonly MediaTrack[],
  audioId: string,
  name: string,
): MediaTrack | undefined {
  return tracks.find((track) => areMediaTracksEquivalent(track, { audioId, name }));
}

export function areSongsEquivalent(
  left: Pick<Song, 'artist' | 'title' | 'minusTrackId' | 'plusTrackId'>,
  right: Pick<Song, 'artist' | 'title' | 'minusTrackId' | 'plusTrackId'>,
) {
  return normalizeMediaIdentityText(left.artist) === normalizeMediaIdentityText(right.artist)
    && normalizeMediaIdentityText(left.title) === normalizeMediaIdentityText(right.title)
    && left.minusTrackId === right.minusTrackId
    && left.plusTrackId === right.plusTrackId;
}

export function findEquivalentSong(
  songs: readonly Song[],
  candidate: Pick<Song, 'artist' | 'title' | 'minusTrackId' | 'plusTrackId'>,
): Song | undefined {
  return songs.find((song) => areSongsEquivalent(song, candidate));
}

export function removableAudioIdAfterTrackRemoval(tracks: readonly MediaTrack[], trackId: string) {
  const current = tracks.find((track) => track.id === trackId);
  if (!current) return undefined;
  return tracks.some((track) => track.id !== trackId && track.audioId === current.audioId)
    ? undefined
    : current.audioId;
}
