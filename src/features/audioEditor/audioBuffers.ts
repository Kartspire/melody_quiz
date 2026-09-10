import type { AudioAsset } from '../../model/types';

const MAX_CACHED_AUDIO_BYTES = 192 * 1024 * 1024;

type CachedBuffer = {
  promise: Promise<AudioBuffer>;
  sizeBytes: number;
  lastUsed: number;
};

const bufferCache = new Map<string, CachedBuffer>();
let decoderContext: AudioContext | null = null;
let usageCounter = 0;

export function decodeAudioAsset(asset: AudioAsset): Promise<AudioBuffer> {
  const cached = bufferCache.get(asset.id);
  if (cached) {
    cached.lastUsed = ++usageCounter;
    return cached.promise;
  }

  const entry: CachedBuffer = {
    promise: Promise.resolve(null as unknown as AudioBuffer),
    sizeBytes: 0,
    lastUsed: ++usageCounter,
  };
  const pending = (async () => {
    const context = getDecoderContext();
    const bytes = await asset.blob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    entry.sizeBytes = estimateAudioBufferBytes(buffer);
    trimBufferCache(asset.id);
    return buffer;
  })();
  entry.promise = pending;
  bufferCache.set(asset.id, entry);
  pending.catch(() => {
    if (bufferCache.get(asset.id) === entry) bufferCache.delete(asset.id);
  });
  return pending;
}

export function clearDecodedAudioBufferCache() {
  bufferCache.clear();
}

function getDecoderContext() {
  if (!decoderContext || decoderContext.state === 'closed') decoderContext = new AudioContext();
  return decoderContext;
}

function estimateAudioBufferBytes(buffer: AudioBuffer) {
  return buffer.length * Math.max(1, buffer.numberOfChannels) * Float32Array.BYTES_PER_ELEMENT;
}

function trimBufferCache(preserveId: string) {
  let totalBytes = 0;
  for (const entry of bufferCache.values()) totalBytes += entry.sizeBytes;
  if (totalBytes <= MAX_CACHED_AUDIO_BYTES) return;

  const candidates = [...bufferCache.entries()]
    .filter(([id, entry]) => id !== preserveId && entry.sizeBytes > 0)
    .sort(([, left], [, right]) => left.lastUsed - right.lastUsed);

  for (const [id, entry] of candidates) {
    if (totalBytes <= MAX_CACHED_AUDIO_BYTES) break;
    bufferCache.delete(id);
    totalBytes -= entry.sizeBytes;
  }
}
