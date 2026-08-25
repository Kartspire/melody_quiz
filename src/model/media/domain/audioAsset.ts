import { DATA_LIMITS } from '../../limits';
import type { AudioAsset } from '../../types';

export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'flac' | 'mp4';

export type AudioFormatDescriptor = {
  format: AudioFormat;
  mimeType: string;
  extensions: readonly string[];
};

export const AUDIO_FORMATS: readonly AudioFormatDescriptor[] = [
  { format: 'mp3', mimeType: 'audio/mpeg', extensions: ['.mp3'] },
  { format: 'wav', mimeType: 'audio/wav', extensions: ['.wav'] },
  { format: 'ogg', mimeType: 'audio/ogg', extensions: ['.ogg', '.opus'] },
  { format: 'flac', mimeType: 'audio/flac', extensions: ['.flac'] },
  { format: 'mp4', mimeType: 'audio/mp4', extensions: ['.m4a', '.mp4'] },
] as const;

export const AUDIO_FILE_ACCEPT = [
  ...AUDIO_FORMATS.map((descriptor) => descriptor.mimeType),
  ...AUDIO_FORMATS.flatMap((descriptor) => descriptor.extensions),
].join(',');

export type AudioBlobInspection = {
  format: AudioFormat;
  mimeType: string;
};

export function inspectAudioHeader(bytes: Uint8Array): AudioBlobInspection | null {
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return descriptorResult('mp3');
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return descriptorResult('wav');
  if (ascii(bytes, 0, 4) === 'OggS') return descriptorResult('ogg');
  if (ascii(bytes, 0, 4) === 'fLaC') return descriptorResult('flac');
  if (ascii(bytes, 4, 4) === 'ftyp') return descriptorResult('mp4');
  return null;
}

export function inferAudioFormat(name: string, type: string): AudioFormat | null {
  const normalizedType = type.trim().toLowerCase().split(';', 1)[0];
  const byMime = AUDIO_FORMATS.find((descriptor) => {
    if (descriptor.format === 'mp3') return normalizedType === 'audio/mpeg' || normalizedType === 'audio/mp3';
    if (descriptor.format === 'wav') return normalizedType === 'audio/wav' || normalizedType === 'audio/x-wav' || normalizedType === 'audio/wave';
    if (descriptor.format === 'ogg') return normalizedType === 'audio/ogg' || normalizedType === 'audio/opus';
    if (descriptor.format === 'flac') return normalizedType === 'audio/flac' || normalizedType === 'audio/x-flac';
    return normalizedType === 'audio/mp4' || normalizedType === 'video/mp4' || normalizedType === 'audio/x-m4a';
  });
  if (byMime) return byMime.format;

  const lowerName = name.trim().toLowerCase();
  return AUDIO_FORMATS.find((descriptor) => descriptor.extensions.some((extension) => lowerName.endsWith(extension)))?.format ?? null;
}

export function canonicalAudioMimeType(format: AudioFormat) {
  return AUDIO_FORMATS.find((descriptor) => descriptor.format === format)!.mimeType;
}

/**
 * `verified` is a persisted integrity marker, not a browser-playability promise.
 * Browser decodability is checked separately when a file enters the library.
 */
export function isVerifiedAudioAsset(asset: unknown): boolean {
  if (!asset || typeof asset !== 'object') return false;
  const value = asset as Partial<AudioAsset>;
  return typeof value.id === 'string'
    && /^[a-f0-9]{64}$/i.test(value.id)
    && value.sha256 === value.id
    && value.verified === true
    && typeof value.name === 'string'
    && value.name.trim().length > 0
    && value.name.length <= DATA_LIMITS.text.audioName
    && typeof value.type === 'string'
    && value.type.length <= DATA_LIMITS.text.mimeType
    && value.blob instanceof Blob
    && value.blob.size > 0;
}

export function hasAvailableAudioAssetReference(
  trackId: string | undefined,
  trackById: ReadonlyMap<string, { audioId: string }>,
  audioById: ReadonlyMap<string, AudioAsset>,
) {
  if (!trackId) return false;
  const track = trackById.get(trackId);
  if (!track) return false;
  return isVerifiedAudioAsset(audioById.get(track.audioId));
}

function descriptorResult(format: AudioFormat): AudioBlobInspection {
  return { format, mimeType: canonicalAudioMimeType(format) };
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}
