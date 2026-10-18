import type { AudioAsset, AudioProject, MediaTrack } from '../../model/types';
import { renderAudioProjectBuffer } from './audioEngine';
import type { LoudnessAnalysis } from './loudness';

export async function analyzeMix(project: AudioProject, tracks: readonly MediaTrack[], assets: readonly AudioAsset[], signal: AbortSignal): Promise<LoudnessAnalysis> {
  const buffer = await renderAudioProjectBuffer(project, tracks, assets, { sampleRate: 48000, signal });
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./loudness.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('Анализ отменён', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: LoudnessAnalysis; error?: string }>) => { finish(); if (event.data.result) resolve(event.data.result); else reject(new Error(event.data.error)); };
    worker.onerror = event => { finish(); reject(new Error(event.message)); };
    const channels = [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()];
    worker.postMessage(channels, channels.map(c => c.buffer));
  });
}
