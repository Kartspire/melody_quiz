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
    masterGainDb: 0,
    ranges: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicateAudioProject(project: AudioProject): AudioProject {
  const now = Date.now();
  return {
    ...project, id: createId('audio-project'), name: `${project.name.slice(0, 190)} — копия`,
    createdAt: now, updatedAt: now,
    markers: project.markers?.map((marker) => ({ ...marker, id: createId('audio-marker') })),
    ranges: project.ranges?.map((range) => ({ ...range, id: createId('audio-range') })),
    lanes: project.lanes.map((lane) => ({ ...lane, id: createId('audio-lane'),
      clips: lane.clips.map((clip) => ({ ...clip, id: createId('audio-clip') })),
    })),
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
    // Source-aligned cuts can land between timeline milliseconds at non-unit rates.
    timelineStartMs: clamp(Number.isFinite(clip.timelineStartMs) ? clip.timelineStartMs : 0, 0, AUDIO_EDITOR_MAX_PROJECT_MS),
    sourceStartMs,
    sourceEndMs,
    gainDb: clamp(clip.gainDb, -60, 12),
    fadeInMs: Math.min(clampMs(clip.fadeInMs), timelineDuration),
    fadeOutMs: Math.min(clampMs(clip.fadeOutMs), timelineDuration),
    playbackRate,
  };
}

export function splitAudioClip(clip: AudioClip, timelinePositionMs: number): [AudioClip, AudioClip] | null {
  const relativeTimelineMs = timelinePositionMs - clip.timelineStartMs;
  if (!Number.isFinite(relativeTimelineMs)) return null;
  const splitSourceMs = Math.round(clip.sourceStartMs + relativeTimelineMs * clip.playbackRate);
  if (splitSourceMs - clip.sourceStartMs < AUDIO_EDITOR_MIN_CLIP_MS || clip.sourceEndMs - splitSourceMs < AUDIO_EDITOR_MIN_CLIP_MS) return null;
  const left = normalizeAudioClip({
    ...clip,
    sourceEndMs: splitSourceMs,
    fadeOutMs: 0,
  });
  const right = normalizeAudioClip({
    ...clip,
    id: createId('audio-clip'),
    timelineStartMs: getClipTimelineEndMs(left),
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
