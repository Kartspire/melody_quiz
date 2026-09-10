import type { AudioAsset } from '../../model/types';
import { decodeAudioAsset } from './audioBuffers';

export const WAVEFORM_PEAK_BUCKETS = 4096;

type WaveformPeakData = {
  peaks: Float32Array;
  durationMs: number;
};

const waveformCache = new Map<string, Promise<WaveformPeakData>>();

export function getWaveformPeaks(asset: AudioAsset): Promise<WaveformPeakData> {
  const cached = waveformCache.get(asset.id);
  if (cached) return cached;
  const pending = decodeAudioAsset(asset).then((buffer) => ({
    peaks: calculateWaveformPeaks(buffer, WAVEFORM_PEAK_BUCKETS),
    durationMs: buffer.duration * 1000,
  }));
  waveformCache.set(asset.id, pending);
  pending.catch(() => {
    if (waveformCache.get(asset.id) === pending) waveformCache.delete(asset.id);
  });
  return pending;
}

export function calculateWaveformPeaks(buffer: Pick<AudioBuffer, 'getChannelData' | 'numberOfChannels' | 'length'>, bucketCount: number) {
  const count = Math.max(1, Math.floor(bucketCount));
  const peaks = new Float32Array(count);
  if (buffer.numberOfChannels <= 0 || buffer.length <= 0) return peaks;
  const channels = buffer.numberOfChannels;
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  const samplesPerBucket = Math.max(1, buffer.length / count);

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * samplesPerBucket);
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor((bucket + 1) * samplesPerBucket)));
    let peak = 0;
    for (const data of channelData) {
      for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(data[index] ?? 0));
    }
    peaks[bucket] = peak;
  }
  return peaks;
}

export function clearWaveformPeakCache() {
  waveformCache.clear();
}
