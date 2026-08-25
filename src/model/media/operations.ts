import { createEffect } from 'effector';
import { createAudioAsset, createMediaTrack } from '../defaults';
import { $mediaTracks } from '../core/state';
import type { MediaTrack } from '../types';
import { mediaTrackAdded } from './model';
import { findEquivalentMediaTrack, mediaTrackNameFromFileName } from './domain/libraryIdentity';

export type AddMediaTrackFileResult = {
  track: MediaTrack;
  status: 'created' | 'existing';
};

export type AddMediaTrackFileParams = {
  blob: Blob;
  fileName: string;
};

let generatedTrackQueue: Promise<void> = Promise.resolve();

/**
 * Application-level media command used by tools that produce audio Blobs.
 * The queue makes the read/check/add sequence atomic from the point of view of
 * this browser tab, so two simultaneous clicks cannot create two equivalent
 * logical MediaTracks for the same generated file.
 */
export const addMediaTrackFileFx = createEffect<AddMediaTrackFileParams, AddMediaTrackFileResult>((params) => {
  const operation = generatedTrackQueue.then(() => addMediaTrackFile(params));
  generatedTrackQueue = operation.then(() => undefined, () => undefined);
  return operation;
});

async function addMediaTrackFile({ blob, fileName }: AddMediaTrackFileParams): Promise<AddMediaTrackFileResult> {
  const normalizedFileName = fileName.trim() || 'track.wav';
  const file = new File([blob], normalizedFileName, {
    type: blob.type || 'audio/wav',
    lastModified: Date.now(),
  });
  const audioAsset = await createAudioAsset(file);
  const name = mediaTrackNameFromFileName(normalizedFileName);

  const before = $mediaTracks.getState();
  const existing = findEquivalentMediaTrack(before, audioAsset.id, name);
  if (existing) return { track: existing, status: 'existing' };

  const candidate = createMediaTrack(audioAsset, name);
  mediaTrackAdded({ track: candidate, audioAsset });

  const after = $mediaTracks.getState();
  const created = after.find((track) => track.id === candidate.id);
  if (created) return { track: created, status: 'created' };

  const raced = findEquivalentMediaTrack(after, audioAsset.id, name);
  if (raced) return { track: raced, status: 'existing' };
  throw new Error('Не удалось добавить трек в медиатеку.');
}
