import type { AudioAsset, AudioClip, AudioProject, MediaTrack } from '../../model/types';
import { encodeStereoWav } from '../vocalRemoval/wav';
import { decodeAudioAsset } from './audioBuffers';
import { getClipTimelineDurationMs, getClipTimelineEndMs, getProjectDurationMs } from './audioProject';

const MAX_OFFLINE_RENDER_MS = 10 * 60 * 1000;

export type AudioProjectPlayback = {
  stop: () => void;
};

export async function playAudioProject(
  project: AudioProject,
  mediaTracks: readonly MediaTrack[],
  audioAssets: readonly AudioAsset[],
  fromMs: number,
): Promise<AudioProjectPlayback> {
  const context = new AudioContext();
  const sources: AudioBufferSourceNode[] = [];
  const trackById = new Map(mediaTracks.map((track) => [track.id, track]));
  const assetById = new Map(audioAssets.map((asset) => [asset.id, asset]));
  const audibleLanes = getAudibleLanes(project);

  try {
    await context.resume();
    const decoded = await decodeRequiredBuffers(audibleLanes, trackById, assetById);
    const startAt = context.currentTime + 0.03;

    for (const lane of audibleLanes) {
      for (const clip of lane.clips) {
        if (getClipTimelineEndMs(clip) <= fromMs) continue;
        const buffer = decoded.get(clip.sourceTrackId);
        if (!buffer) continue;
        scheduleClip(context, context.destination, buffer, clip, fromMs, startAt, sources);
      }
    }
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }

  return {
    stop: () => {
      for (const source of sources) {
        try { source.stop(); } catch { /* source already ended */ }
      }
      void context.close();
    },
  };
}

export async function renderAudioProjectToWav(
  project: AudioProject,
  mediaTracks: readonly MediaTrack[],
  audioAssets: readonly AudioAsset[],
): Promise<Blob> {
  const durationMs = getProjectDurationMs(project);
  if (durationMs <= 0) throw new Error('Добавьте хотя бы один фрагмент на таймлайн.');
  if (durationMs > MAX_OFFLINE_RENDER_MS) throw new Error('Рендер WAV ограничен 10 минутами, чтобы не переполнить память браузера.');
  const sampleRate = 44_100;
  const frameCount = Math.max(1, Math.ceil(durationMs / 1000 * sampleRate));
  const offline = new OfflineAudioContext(2, frameCount, sampleRate);
  const trackById = new Map(mediaTracks.map((track) => [track.id, track]));
  const assetById = new Map(audioAssets.map((asset) => [asset.id, asset]));
  const audibleLanes = getAudibleLanes(project);
  const decoded = await decodeRequiredBuffers(audibleLanes, trackById, assetById);
  const sources: AudioBufferSourceNode[] = [];

  for (const lane of audibleLanes) {
    for (const clip of lane.clips) {
      const buffer = decoded.get(clip.sourceTrackId);
      if (!buffer) continue;
      scheduleClip(offline, offline.destination, buffer, clip, 0, 0, sources);
    }
  }

  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  return encodeStereoWav(left, right, rendered.sampleRate);
}

async function decodeRequiredBuffers(
  lanes: AudioProject['lanes'],
  trackById: Map<string, MediaTrack>,
  assetById: Map<string, AudioAsset>,
) {
  const requiredTrackIds = new Set(lanes.flatMap((lane) => lane.clips.map((clip) => clip.sourceTrackId)));
  const result = new Map<string, AudioBuffer>();
  await Promise.all([...requiredTrackIds].map(async (trackId) => {
    const track = trackById.get(trackId);
    if (!track) throw new Error(`Исходный трек проекта больше не существует: ${trackId}.`);
    const asset = assetById.get(track.audioId);
    if (!asset) throw new Error(`Не найден аудиофайл для трека «${track.name}».`);
    result.set(trackId, await decodeAudioAsset(asset));
  }));
  return result;
}

function getAudibleLanes(project: AudioProject) {
  const hasSolo = project.lanes.some((lane) => lane.solo);
  return project.lanes.filter((lane) => hasSolo ? lane.solo : !lane.muted);
}

function scheduleClip(
  context: BaseAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  clip: AudioClip,
  fromMs: number,
  contextStartTime: number,
  sources: AudioBufferSourceNode[],
) {
  const clipEndMs = getClipTimelineEndMs(clip);
  const playFromMs = Math.max(fromMs, clip.timelineStartMs);
  if (playFromMs >= clipEndMs) return;

  const sourceOffsetMs = clip.sourceStartMs + (playFromMs - clip.timelineStartMs) * clip.playbackRate;
  const maxSourceEndMs = Math.min(clip.sourceEndMs, buffer.duration * 1000);
  const sourceDurationMs = maxSourceEndMs - sourceOffsetMs;
  if (sourceDurationMs <= 0) return;

  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = clip.playbackRate;
  source.connect(gain).connect(destination);

  const delaySeconds = Math.max(0, playFromMs - fromMs) / 1000;
  const startTime = contextStartTime + delaySeconds;
  const timelineDurationMs = sourceDurationMs / clip.playbackRate;
  const endTime = startTime + timelineDurationMs / 1000;
  const baseGain = dbToGain(clip.gainDb);
  const clipTimelineDurationMs = getClipTimelineDurationMs(clip);
  const clipTimelineEndMs = clip.timelineStartMs + clipTimelineDurationMs;

  const startFactor = fadeFactor(clip, playFromMs, clipTimelineEndMs);
  gain.gain.setValueAtTime(baseGain * startFactor, startTime);

  const fadeInEndMs = clip.timelineStartMs + clip.fadeInMs;
  if (clip.fadeInMs > 0 && playFromMs < fadeInEndMs) {
    const fadeInEndTime = startTime + (fadeInEndMs - playFromMs) / 1000;
    gain.gain.linearRampToValueAtTime(baseGain, Math.min(endTime, fadeInEndTime));
  }

  const fadeOutStartMs = clipTimelineEndMs - clip.fadeOutMs;
  if (clip.fadeOutMs > 0 && clipTimelineEndMs > playFromMs) {
    const fadeOutStartAt = startTime + Math.max(0, fadeOutStartMs - playFromMs) / 1000;
    if (fadeOutStartAt > startTime) gain.gain.setValueAtTime(baseGain, Math.min(endTime, fadeOutStartAt));
    gain.gain.linearRampToValueAtTime(0, endTime);
  }

  source.start(startTime, sourceOffsetMs / 1000, sourceDurationMs / 1000);
  sources.push(source);
}

function fadeFactor(clip: AudioClip, positionMs: number, clipEndMs: number) {
  const fadeIn = clip.fadeInMs > 0 ? Math.min(1, Math.max(0, (positionMs - clip.timelineStartMs) / clip.fadeInMs)) : 1;
  const fadeOut = clip.fadeOutMs > 0 ? Math.min(1, Math.max(0, (clipEndMs - positionMs) / clip.fadeOutMs)) : 1;
  return Math.min(fadeIn, fadeOut);
}

function dbToGain(db: number) {
  return db <= -60 ? 0 : 10 ** (db / 20);
}
