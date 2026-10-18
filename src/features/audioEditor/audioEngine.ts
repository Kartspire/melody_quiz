import type { AudioAsset, AudioClip, AudioProject, AudioTimeRange, MediaTrack } from '../../model/types';
import { encodeStereoWav } from '../vocalRemoval/wav';
import { decodeAudioAsset } from './audioBuffers';
import { getClipTimelineDurationMs, getClipTimelineEndMs, getProjectDurationMs } from './audioProject';

export const MAX_OFFLINE_RENDER_MS = 10 * 60 * 1000;
export type MixLevels = { left: number; right: number };
export type AudioProjectPlayback = {
  stop: () => void;
  position?: () => number;
  ended?: () => boolean;
  updateMix?: (project: AudioProject) => void;
  levels?: () => MixLevels;
};
export type RenderOptions = { range?: AudioTimeRange | null; signal?: AbortSignal; sampleRate?: 44100 | 48000 };
type ScheduledClip = { source: AudioBufferSourceNode; gain: GainNode; clipId: string; laneId: string; fromMs: number; endMs: number; startAt: number };

export function playbackStructure(project: AudioProject | null) {
  return project && JSON.stringify([project.id, project.lanes.map(lane => [lane.id, lane.clips.map(c => [c.id, c.sourceTrackId, c.timelineStartMs, c.sourceStartMs, c.sourceEndMs, c.playbackRate])])]);
}
export function resolveRenderRange(project: AudioProject, range?: AudioTimeRange | null): AudioTimeRange {
  const result = range ?? { startMs: 0, endMs: getProjectDurationMs(project) };
  if (!Number.isFinite(result.startMs) || !Number.isFinite(result.endMs) || result.startMs < 0 || result.endMs <= result.startMs || result.endMs > 6 * 60 * 60 * 1000) throw new Error('Укажите непустой диапазон от 0 до 6 часов.');
  return result;
}
export async function playAudioProject(
  project: AudioProject, mediaTracks: readonly MediaTrack[], audioAssets: readonly AudioAsset[], fromMs: number,
  options: RenderOptions & { loop?: boolean } = {},
): Promise<AudioProjectPlayback> {
  const range = resolveRenderRange(project, options.range);
  const loop = Boolean(options.loop && options.range);
  const from = loop ? range.startMs : Math.max(range.startMs, Math.min(fromMs, range.endMs));
  if (loop && range.endMs - range.startMs < 50) throw new Error('Для повтора выделите хотя бы 0,05 секунды.');
  const context = new AudioContext();
  const scheduled = new Set<ScheduledClip>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    options.signal?.removeEventListener('abort', stop);
    for (const item of scheduled) { try { item.source.stop(); } catch { /* already ended */ } item.source.disconnect(); item.gain.disconnect(); }
    scheduled.clear();
    void context.close().catch(() => undefined);
  };
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    options.signal?.throwIfAborted();
    await context.resume();
    // Muted lanes must be ready for live unmute too.
    const decoded = await decodeRequiredBuffers(project.lanes, mediaTracks, audioAssets, options.signal);
    options.signal?.throwIfAborted();
    const master = context.createGain();
    master.channelCount = 2; master.channelCountMode = 'explicit';
    master.gain.value = dbToGain(project.masterGainDb ?? 0);
    master.connect(context.destination);
    const splitter = context.createChannelSplitter(2);
    master.connect(splitter);
    const meters = [context.createAnalyser(), context.createAnalyser()];
    meters.forEach((meter, i) => { meter.fftSize = 2048; splitter.connect(meter, i); });
    const samples = new Float32Array(2048);
    const startAt = context.currentTime + 0.03;
    const period = (range.endMs - range.startMs) / 1000;
    let current = project;
    let cycle = 0;
    const scheduleCycle = (cycleAt: number, cycleFrom: number) => {
      for (const lane of current.lanes) for (const clip of lane.clips) {
        const buffer = decoded.get(clip.sourceTrackId);
        if (!buffer) continue;
        const item = scheduleClip(context, master, buffer, clip, cycleFrom, cycleAt, range.endMs, lane.muted);
        if (!item) continue;
        item.laneId = lane.id;
        scheduled.add(item);
        item.source.onended = () => { scheduled.delete(item); item.source.disconnect(); item.gain.disconnect(); };
      }
    };
    const fill = () => {
      // Timers only refill the queue. Every boundary is derived from AudioContext
      // time and the integer cycle index, so repeated loops never accumulate drift.
      if (loop) cycle = Math.max(cycle, Math.floor((context.currentTime - startAt) / period));
      while (startAt + cycle * period < context.currentTime + 1) {
        const cycleStart = startAt + cycle * period;
        const at = Math.max(cycleStart, context.currentTime);
        // A throttled/background tab may miss its refill. Skip expired cycles
        // and resume the current one, never launch many old cycles at once.
        scheduleCycle(at, loop ? range.startMs + (at - cycleStart) * 1000 : from);
        cycle += 1;
        if (!loop) break;
      }
    };
    fill();
    if (loop) timer = setInterval(fill, 100);
    return {
      stop,
      position: () => {
        const elapsed = Math.max(0, context.currentTime - startAt) * 1000;
        return loop ? range.startMs + elapsed % (period * 1000) : Math.min(range.endMs, from + elapsed);
      },
      ended: () => !loop && context.currentTime >= startAt + (range.endMs - from) / 1000,
      updateMix: (next) => {
        current = next;
        master.gain.setTargetAtTime(dbToGain(next.masterGainDb ?? 0), context.currentTime, 0.005);
        const clips = new Map(next.lanes.flatMap(lane => lane.clips.map(clip => [clip.id, { clip, muted: lane.muted }] as const)));
        for (const item of scheduled) {
          const nextClip = clips.get(item.clipId);
          if (!nextClip) continue;
          const at = Math.max(item.startAt, context.currentTime);
          const position = item.fromMs + (at - item.startAt) * 1000;
          if (position >= item.endMs) continue;
          item.gain.gain.cancelScheduledValues(at);
          scheduleEnvelope(item.gain.gain, nextClip.clip, position, item.endMs, at, nextClip.muted);
        }
      },
      levels: () => {
        const peaks = meters.map(meter => {
          meter.getFloatTimeDomainData(samples);
          let peak = 0;
          for (const value of samples) peak = Math.max(peak, Math.abs(value));
          return peak;
        });
        return { left: peaks[0], right: peaks[1] };
      },
    };
  } catch (error) { stop(); throw error; }
}

export async function renderAudioProjectBuffer(
  project: AudioProject, mediaTracks: readonly MediaTrack[], audioAssets: readonly AudioAsset[], options: RenderOptions = {},
): Promise<AudioBuffer> {
  options.signal?.throwIfAborted();
  const range = resolveRenderRange(project, options.range);
  const durationMs = range.endMs - range.startMs;
  if (durationMs > MAX_OFFLINE_RENDER_MS) throw new Error('Один WAV ограничен 10 минутами. Выберите более короткий диапазон.');
  const sampleRate = options.sampleRate ?? 44_100;
  const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil(durationMs / 1000 * sampleRate)), sampleRate);
  const master = offline.createGain();
  master.channelCount = 2; master.channelCountMode = 'explicit';
  master.gain.value = dbToGain(project.masterGainDb ?? 0);
  master.connect(offline.destination);
  const lanes = project.lanes.filter(lane => !lane.muted).map(lane => ({ ...lane, clips: lane.clips.filter(clip => getClipTimelineEndMs(clip) > range.startMs && clip.timelineStartMs < range.endMs) }));
  const decoded = await decodeRequiredBuffers(lanes, mediaTracks, audioAssets, options.signal);
  for (const lane of lanes) for (const clip of lane.clips) {
    const buffer = decoded.get(clip.sourceTrackId);
    if (buffer) scheduleClip(offline, master, buffer, clip, range.startMs, 0, range.endMs, false);
  }
  options.signal?.throwIfAborted();
  const rendered = await offline.startRendering();
  options.signal?.throwIfAborted();
  return rendered;
}
export async function renderAudioProjectToWav(
  project: AudioProject, mediaTracks: readonly MediaTrack[], audioAssets: readonly AudioAsset[], options: RenderOptions = {},
): Promise<Blob> {
  const rendered = await renderAudioProjectBuffer(project, mediaTracks, audioAssets, options);
  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  return encodeStereoWav(left, right, rendered.sampleRate);
}
async function decodeRequiredBuffers(lanes: AudioProject['lanes'], tracks: readonly MediaTrack[], assets: readonly AudioAsset[], signal?: AbortSignal) {
  const trackById = new Map(tracks.map(t => [t.id, t]));
  const assetById = new Map(assets.map(a => [a.id, a]));
  const result = new Map<string, AudioBuffer>();
  for (const trackId of new Set(lanes.flatMap(l => l.clips.map(c => c.sourceTrackId)))) {
    signal?.throwIfAborted();
    const track = trackById.get(trackId);
    const asset = track && assetById.get(track.audioId);
    if (!asset) throw new Error(`Исходный трек проекта недоступен: ${track?.name ?? trackId}.`);
    result.set(trackId, await decodeAudioAsset(asset));
  }
  return result;
}
function scheduleClip(context: BaseAudioContext, destination: AudioNode, buffer: AudioBuffer, clip: AudioClip, fromMs: number, contextStartTime: number, toMs: number, muted: boolean): ScheduledClip | null {
  const window = getClipPlaybackWindow(clip, fromMs, buffer.duration * 1000, toMs);
  if (!window) return null;
  const { playFromMs, sourceOffsetMs, sourceDurationMs, timelineDurationMs } = window;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = clip.playbackRate;
  source.connect(gain).connect(destination);
  const startAt = contextStartTime + Math.max(0, playFromMs - fromMs) / 1000;
  const endMs = playFromMs + timelineDurationMs;
  scheduleEnvelope(gain.gain, clip, playFromMs, endMs, startAt, muted);
  source.start(startAt, sourceOffsetMs / 1000, sourceDurationMs / 1000);
  return { source, gain, clipId: clip.id, laneId: '', fromMs: playFromMs, endMs, startAt };
}
function scheduleEnvelope(param: AudioParam, clip: AudioClip, fromMs: number, endMs: number, at: number, muted: boolean) {
  const base = muted ? 0 : dbToGain(clip.gainDb);
  const duration = getClipTimelineDurationMs(clip);
  const clipEnd = clip.timelineStartMs + duration;
  param.setValueAtTime(base * fadeFactor(clip, fromMs, clipEnd), at);
  const turns = clip.fadeInMs + clip.fadeOutMs > duration
    ? [clip.timelineStartMs + duration * clip.fadeInMs / (clip.fadeInMs + clip.fadeOutMs)]
    : [clip.timelineStartMs + clip.fadeInMs, clipEnd - clip.fadeOutMs];
  for (const position of [...new Set([...turns, endMs])].filter(p => p > fromMs && p <= endMs).sort((a, b) => a - b)) {
    param.linearRampToValueAtTime(base * fadeFactor(clip, position, clipEnd), at + (position - fromMs) / 1000);
  }
}
export function getClipPlaybackWindow(clip: AudioClip, fromMs: number, bufferDurationMs: number, toMs = Infinity) {
  const playFromMs = Math.max(fromMs, clip.timelineStartMs);
  const end = Math.min(getClipTimelineEndMs(clip), toMs);
  if (playFromMs >= end) return null;
  const sourceOffsetMs = clip.sourceStartMs + (playFromMs - clip.timelineStartMs) * clip.playbackRate;
  const maxSourceEndMs = Math.min(clip.sourceEndMs, Math.max(0, bufferDurationMs), sourceOffsetMs + (end - playFromMs) * clip.playbackRate);
  const sourceDurationMs = maxSourceEndMs - sourceOffsetMs;
  if (sourceDurationMs <= 0) return null;
  return { playFromMs, sourceOffsetMs, sourceDurationMs, timelineDurationMs: sourceDurationMs / clip.playbackRate };
}
function fadeFactor(clip: AudioClip, positionMs: number, clipEndMs: number) {
  const fadeIn = clip.fadeInMs > 0 ? Math.min(1, Math.max(0, (positionMs - clip.timelineStartMs) / clip.fadeInMs)) : 1;
  const fadeOut = clip.fadeOutMs > 0 ? Math.min(1, Math.max(0, (clipEndMs - positionMs) / clip.fadeOutMs)) : 1;
  return Math.min(fadeIn, fadeOut);
}
export function dbToGain(db: number) { return db <= -60 ? 0 : 10 ** (db / 20); }
