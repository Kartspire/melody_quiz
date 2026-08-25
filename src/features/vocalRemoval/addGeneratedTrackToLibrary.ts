import {
  addMediaTrackFileFx,
  type AddMediaTrackFileResult,
  findEquivalentMediaTrack,
  mediaTrackNameFromFileName,
} from '../../model/media';

export type AddGeneratedTrackResult = AddMediaTrackFileResult;

export function addGeneratedTrackToLibrary(blob: Blob, fileName: string): Promise<AddGeneratedTrackResult> {
  return addMediaTrackFileFx({ blob, fileName });
}

// Backward-compatible exports keep existing tests/features independent from
// the Effector store while the identity rules live in the media domain.
export { findEquivalentMediaTrack };
export const trackNameFromFileName = mediaTrackNameFromFileName;
