import { createAudioAsset, createMediaTrack } from '../../model/defaults';
import { $mediaTracks } from '../../model/core/state';
import { mediaTrackAdded } from '../../model/media/model';
import type { MediaTrack } from '../../model/types';

export type AddGeneratedTrackResult = {
  track: MediaTrack;
  status: 'created' | 'existing';
};

export async function addGeneratedTrackToLibrary(blob: Blob, fileName: string): Promise<AddGeneratedTrackResult> {
  const normalizedFileName = fileName.trim() || 'track.wav';
  const file = new File([blob], normalizedFileName, {
    type: blob.type || 'audio/wav',
    lastModified: Date.now(),
  });
  const audioAsset = await createAudioAsset(file);
  const candidate = createMediaTrack(audioAsset, trackNameFromFileName(normalizedFileName));
  const existing = findEquivalentMediaTrack($mediaTracks.getState(), candidate.audioId, candidate.name);
  if (existing) return { track: existing, status: 'existing' };

  mediaTrackAdded({ track: candidate, audioAsset });

  // Effector applies the event synchronously. Re-read the store so a concurrent
  // identical add resolves to the track that actually won instead of returning
  // a phantom object or creating a second logical entry.
  const created = $mediaTracks.getState().find((track) => track.id === candidate.id);
  if (created) return { track: created, status: 'created' };

  const raced = findEquivalentMediaTrack($mediaTracks.getState(), candidate.audioId, candidate.name);
  if (raced) return { track: raced, status: 'existing' };

  throw new Error('Не удалось добавить трек в медиатеку.');
}

export function findEquivalentMediaTrack(
  tracks: MediaTrack[],
  audioId: string,
  name: string,
): MediaTrack | undefined {
  const normalizedName = normalizeMediaTrackName(name);
  return tracks.find((track) => track.audioId === audioId
    && normalizeMediaTrackName(track.name) === normalizedName);
}

export function trackNameFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim() || 'Аудиотрек';
}

function normalizeMediaTrackName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}
