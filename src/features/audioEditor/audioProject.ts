import { createId } from '../../lib/ids';
import type { AudioClip, AudioEditorLane, AudioProject } from '../../model/types';

export const AUDIO_EDITOR_MIN_CLIP_MS = 50;
export const AUDIO_EDITOR_MAX_PROJECT_MS = 6 * 60 * 60 * 1000;

export function createAudioEditorLane(index = 0): AudioEditorLane {
  return {
    id: createId('audio-lane'),
    name: `Дорожка ${index + 1}`,
    muted: false,
    solo: false,
    clips: [],
  };
}

export function createAudioProject(name = 'Новый монтаж'): AudioProject {
  const now = Date.now();
  return {
    id: createId('audio-project'),
    name: name.trim().slice(0, 200) || 'Новый монтаж',
    lanes: [createAudioEditorLane(0)],
    markers: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createAudioClip(sourceTrackId: string, sourceDurationMs: number, timelineStartMs = 0): AudioClip {
  const end = Math.max(AUDIO_EDITOR_MIN_CLIP_MS, clampMs(sourceDurationMs));
  return {
    id: createId('audio-clip'),
    sourceTrackId,
    timelineStartMs: clampMs(timelineStartMs),
    sourceStartMs: 0,
    sourceEndMs: end,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    playbackRate: 1,
  };
}

export function getClipTimelineDurationMs(clip: AudioClip) {
  return Math.max(0, (clip.sourceEndMs - clip.sourceStartMs) / clip.playbackRate);
}

export function getClipTimelineEndMs(clip: AudioClip) {
  return clip.timelineStartMs + getClipTimelineDurationMs(clip);
}

export function getProjectDurationMs(project: AudioProject) {
  return project.lanes.reduce(
    (projectEnd, lane) => lane.clips.reduce((laneEnd, clip) => Math.max(laneEnd, getClipTimelineEndMs(clip)), projectEnd),
    0,
  );
}

export function normalizeAudioClip(clip: AudioClip): AudioClip {
  const playbackRate = clamp(clip.playbackRate, 0.25, 4);
  const sourceStartMs = clampMs(clip.sourceStartMs);
  const sourceEndMs = Math.max(sourceStartMs + AUDIO_EDITOR_MIN_CLIP_MS, clampMs(clip.sourceEndMs));
  const sourceDuration = sourceEndMs - sourceStartMs;
  const timelineDuration = sourceDuration / playbackRate;
  return {
    ...clip,
    timelineStartMs: clampMs(clip.timelineStartMs),
    sourceStartMs,
    sourceEndMs,
    gainDb: clamp(clip.gainDb, -60, 12),
    fadeInMs: clampMs(Math.min(clip.fadeInMs, timelineDuration)),
    fadeOutMs: clampMs(Math.min(clip.fadeOutMs, timelineDuration)),
    playbackRate,
  };
}

export function splitAudioClip(clip: AudioClip, timelinePositionMs: number): [AudioClip, AudioClip] | null {
  const relativeTimelineMs = timelinePositionMs - clip.timelineStartMs;
  const timelineDuration = getClipTimelineDurationMs(clip);
  if (relativeTimelineMs < AUDIO_EDITOR_MIN_CLIP_MS || relativeTimelineMs > timelineDuration - AUDIO_EDITOR_MIN_CLIP_MS) return null;

  const splitSourceMs = clip.sourceStartMs + relativeTimelineMs * clip.playbackRate;
  const left = normalizeAudioClip({
    ...clip,
    sourceEndMs: splitSourceMs,
    fadeOutMs: 0,
  });
  const right = normalizeAudioClip({
    ...clip,
    id: createId('audio-clip'),
    timelineStartMs: timelinePositionMs,
    sourceStartMs: splitSourceMs,
    fadeInMs: 0,
  });
  return [left, right];
}

function clampMs(value: number) {
  return Math.round(clamp(Number.isFinite(value) ? value : 0, 0, AUDIO_EDITOR_MAX_PROJECT_MS));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
