export {
  mediaTrackAdded,
  mediaTrackAudioChanged,
  mediaTrackChanged,
  mediaTrackDeleteRequested,
  songAdded,
  songChanged,
  songDeleteRequested,
  songDuplicated,
  songTrackChanged,
} from './model';

export { addMediaTrackFileFx } from './operations';
export type { AddMediaTrackFileParams, AddMediaTrackFileResult } from './operations';

export {
  buildMediaTrackUsageMap,
  buildSongUsageMap,
  isMediaTrackUsed,
} from './selectors';
export type { MediaTrackUsage, SongUsage } from './selectors';

export {
  AUDIO_FILE_ACCEPT,
  AUDIO_FORMATS,
  canonicalAudioMimeType,
  hasAvailableAudioAssetReference,
  inferAudioFormat,
  inspectAudioHeader,
  isVerifiedAudioAsset,
} from './domain/audioAsset';
export type { AudioBlobInspection, AudioFormat, AudioFormatDescriptor } from './domain/audioAsset';

export {
  areMediaTracksEquivalent,
  areSongsEquivalent,
  findEquivalentMediaTrack,
  findEquivalentSong,
  mediaTrackNameFromFileName,
  normalizeMediaIdentityText,
  removableAudioIdAfterTrackRemoval,
} from './domain/libraryIdentity';
