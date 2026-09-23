import { createId } from '../../lib/ids';
import type { AudioClip, AudioEditorLane, AudioProject, AudioProjectMarker } from '../../model/types';
import {
  AUDIO_EDITOR_MAX_PROJECT_MS,
  AUDIO_EDITOR_MIN_CLIP_MS,
  getClipTimelineDurationMs,
  getClipTimelineEndMs,
  normalizeAudioClip,
} from './audioProject';

export const AUDIO_EDITOR_GRID_MS = 50;
export const AUDIO_EDITOR_SNAP_THRESHOLD_PX = 8;
export const AUDIO_EDITOR_MAX_MARKERS = 500;

export type TimelineSnapKind = 'playhead' | 'clip-start' | 'clip-end' | 'marker' | 'grid';

export type TimelineSnapResult = {
  valueMs: number;
  guideMs: number | null;
  kind: TimelineSnapKind | null;
};

export type AudioClipboardClip = {
  clip: AudioClip;
  laneOffset: number;
};

export type AudioClipboard = {
  clips: AudioClipboardClip[];
};

type SnapOptions = {
  pixelsPerSecond: number;
  playheadMs?: number;
  excludedClipIds?: ReadonlySet<string>;
  gridMs?: number;
};

export function getProjectMarkers(project: AudioProject): AudioProjectMarker[] {
  return project.markers ?? [];
}

export function snapTimelinePosition(project: AudioProject, valueMs: number, options: SnapOptions): TimelineSnapResult {
  const bounded = clampTimelineMs(valueMs);
  const thresholdMs = Math.max(1, AUDIO_EDITOR_SNAP_THRESHOLD_PX / Math.max(1, options.pixelsPerSecond) * 1000);
  const candidates = collectSnapCandidates(project, options);
  let best: { valueMs: number; kind: TimelineSnapKind; distance: number; priority: number } | null = null;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate.valueMs - bounded);
    if (distance > thresholdMs) continue;
    const priority = snapPriority(candidate.kind);
    if (!best || distance < best.distance - 0.001 || (Math.abs(distance - best.distance) < 0.001 && priority < best.priority)) {
      best = { ...candidate, distance, priority };
    }
  }

  if (best) return { valueMs: best.valueMs, guideMs: best.valueMs, kind: best.kind };

  const gridMs = Math.max(1, options.gridMs ?? AUDIO_EDITOR_GRID_MS);
  return {
    valueMs: clampTimelineMs(Math.round(bounded / gridMs) * gridMs),
    guideMs: null,
    kind: 'grid',
  };
}

export function snapSelectionDelta(
  project: AudioProject,
  clipIds: readonly string[],
  rawDeltaMs: number,
  options: SnapOptions,
): { deltaMs: number; guideMs: number | null; kind: TimelineSnapKind | null } {
  const selected = getClipLocations(project, new Set(clipIds));
  if (selected.length === 0) return { deltaMs: 0, guideMs: null, kind: null };

  const minStart = Math.min(...selected.map(({ clip }) => clip.timelineStartMs));
  const maxEnd = Math.max(...selected.map(({ clip }) => getClipTimelineEndMs(clip)));
  const clampedDelta = clamp(rawDeltaMs, -minStart, AUDIO_EDITOR_MAX_PROJECT_MS - maxEnd);
  const excluded = new Set(clipIds);
  const movingEdges = selected.flatMap(({ clip }) => [
    clip.timelineStartMs + clampedDelta,
    getClipTimelineEndMs(clip) + clampedDelta,
  ]);
  const thresholdMs = Math.max(1, AUDIO_EDITOR_SNAP_THRESHOLD_PX / Math.max(1, options.pixelsPerSecond) * 1000);
  const candidates = collectSnapCandidates(project, { ...options, excludedClipIds: excluded });

  let best: { adjustment: number; guideMs: number; kind: TimelineSnapKind; distance: number; priority: number } | null = null;
  for (const edge of movingEdges) {
    for (const candidate of candidates) {
      const adjustment = candidate.valueMs - edge;
      const distance = Math.abs(adjustment);
      if (distance > thresholdMs) continue;
      const priority = snapPriority(candidate.kind);
      if (!best || distance < best.distance - 0.001 || (Math.abs(distance - best.distance) < 0.001 && priority < best.priority)) {
        best = { adjustment, guideMs: candidate.valueMs, kind: candidate.kind, distance, priority };
      }
    }
  }

  if (best) {
    const adjusted = clamp(clampedDelta + best.adjustment, -minStart, AUDIO_EDITOR_MAX_PROJECT_MS - maxEnd);
    return { deltaMs: adjusted, guideMs: best.guideMs, kind: best.kind };
  }

  const gridMs = Math.max(1, options.gridMs ?? AUDIO_EDITOR_GRID_MS);
  const anchorStart = minStart + clampedDelta;
  const snappedStart = Math.round(anchorStart / gridMs) * gridMs;
  return {
    deltaMs: clamp(clampedDelta + snappedStart - anchorStart, -minStart, AUDIO_EDITOR_MAX_PROJECT_MS - maxEnd),
    guideMs: null,
    kind: 'grid',
  };
}

export function moveClips(project: AudioProject, clipIds: readonly string[], deltaMs: number): AudioProject {
  const ids = new Set(clipIds);
  const selected = getClipLocations(project, ids);
  if (selected.length === 0 || Math.abs(deltaMs) < 0.001) return project;
  const minStart = Math.min(...selected.map(({ clip }) => clip.timelineStartMs));
  const maxEnd = Math.max(...selected.map(({ clip }) => getClipTimelineEndMs(clip)));
  const safeDelta = clamp(deltaMs, -minStart, AUDIO_EDITOR_MAX_PROJECT_MS - maxEnd);
  const next = mapLanes(project, (lane) => ({
    ...lane,
    clips: lane.clips.map((clip) => ids.has(clip.id)
      ? normalizeAudioClip({ ...clip, timelineStartMs: clip.timelineStartMs + safeDelta })
      : clip),
  }));
  return next;
}

export function trimClipStart(project: AudioProject, clipId: string, requestedTimelineStartMs: number): AudioProject {
  const location = findClip(project, clipId);
  if (!location) return project;
  const { lane, clip } = location;
  const deltaMs = requestedTimelineStartMs - clip.timelineStartMs;
  const maxDelta = getClipTimelineDurationMs(clip) - AUDIO_EDITOR_MIN_CLIP_MS;
  const maxNegativeDelta = -Math.min(clip.timelineStartMs, clip.sourceStartMs / clip.playbackRate);
  const safeDelta = clamp(deltaMs, maxNegativeDelta, maxDelta);
  if (Math.abs(safeDelta) < 0.001) return project;
  const next = patchClip(project, lane.id, clip.id, {
    timelineStartMs: clip.timelineStartMs + safeDelta,
    sourceStartMs: clip.sourceStartMs + safeDelta * clip.playbackRate,
  });
  return next;
}

export function trimClipEnd(project: AudioProject, clipId: string, requestedTimelineEndMs: number, sourceDurationMs?: number): AudioProject {
  const location = findClip(project, clipId);
  if (!location) return project;
  const { lane, clip } = location;
  const currentEndMs = getClipTimelineEndMs(clip);
  const deltaMs = requestedTimelineEndMs - currentEndMs;
  const minDelta = -getClipTimelineDurationMs(clip) + AUDIO_EDITOR_MIN_CLIP_MS;
  const maxDelta = sourceDurationMs === undefined ? 0 : Math.max(0, (sourceDurationMs - clip.sourceEndMs) / clip.playbackRate);
  const safeDelta = clamp(deltaMs, minDelta, maxDelta);
  if (Math.abs(safeDelta) < 0.001) return project;
  const next = patchClip(project, lane.id, clip.id, { sourceEndMs: clip.sourceEndMs + safeDelta * clip.playbackRate });
  return next;
}

export function insertClip(
  project: AudioProject,
  laneId: string,
  inputClip: AudioClip,
  positionMs: number,
): AudioProject {
  const position = clampTimelineMs(positionMs);
  const clip = normalizeAudioClip({ ...inputClip, timelineStartMs: position });
  const next = mapLanes(project, (lane) => lane.id === laneId ? { ...lane, clips: [...lane.clips, clip] } : lane);
  return next;
}

export function deleteClips(project: AudioProject, clipIds: readonly string[]): AudioProject {
  const ids = new Set(clipIds);
  if (ids.size === 0) return project;
  return mapLanes(project, (lane) => ({ ...lane, clips: lane.clips.filter((clip) => !ids.has(clip.id)) }));
}

export function copyClips(project: AudioProject, clipIds: readonly string[]): AudioClipboard | null {
  const ids = new Set(clipIds);
  const laneIndexById = new Map(project.lanes.map((lane, index) => [lane.id, index]));
  const selected = getClipLocations(project, ids);
  if (selected.length === 0) return null;
  const minStart = Math.min(...selected.map(({ clip }) => clip.timelineStartMs));
  const minLane = Math.min(...selected.map(({ lane }) => laneIndexById.get(lane.id) ?? 0));
  return {
    clips: selected.map(({ lane, clip }) => ({
      clip: { ...clip, timelineStartMs: clip.timelineStartMs - minStart },
      laneOffset: (laneIndexById.get(lane.id) ?? 0) - minLane,
    })),
  };
}

export function pasteClips(
  project: AudioProject,
  clipboard: AudioClipboard,
  positionMs: number,
  anchorLaneId: string,
): { project: AudioProject; clipIds: string[] } {
  if (clipboard.clips.length === 0) return { project, clipIds: [] };
  const anchorIndex = Math.max(0, project.lanes.findIndex((lane) => lane.id === anchorLaneId));
  const maxOffset = Math.max(...clipboard.clips.map((item) => item.laneOffset));
  let lanes = project.lanes.map((lane) => ({ ...lane, clips: [...lane.clips] }));
  while (anchorIndex + maxOffset >= lanes.length && lanes.length < 32) {
    lanes.push(createLaneForPaste(lanes.length));
  }
  const availableMaxOffset = Math.max(0, lanes.length - 1 - anchorIndex);
  const safePosition = clampTimelineMs(positionMs);
  const ids: string[] = [];


  for (const item of clipboard.clips) {
    const laneIndex = anchorIndex + Math.min(item.laneOffset, availableMaxOffset);
    const id = createId('audio-clip');
    ids.push(id);
    const clip = normalizeAudioClip({
      ...item.clip,
      id,
      timelineStartMs: safePosition + item.clip.timelineStartMs,
    });
    const lane = lanes[laneIndex]!;
    lanes[laneIndex] = { ...lane, clips: [...lane.clips, clip] };
  }

  return { project: { ...project, lanes }, clipIds: ids };
}

export function moveClipsToLane(project: AudioProject, clipIds: readonly string[], targetLaneId: string): AudioProject {
  const ids = new Set(clipIds);
  const selected = getClipLocations(project, ids);
  if (selected.length === 0 || !project.lanes.some((lane) => lane.id === targetLaneId)) return project;
  const clips = selected.map(({ clip }) => clip);
  const lanes = project.lanes.map((lane) => ({
    ...lane,
    clips: lane.id === targetLaneId
      ? [...lane.clips.filter((clip) => !ids.has(clip.id)), ...clips]
      : lane.clips.filter((clip) => !ids.has(clip.id)),
  }));
  return { ...project, lanes };
}

export function addProjectMarker(project: AudioProject, positionMs: number, label?: string): { project: AudioProject; marker: AudioProjectMarker } | null {
  const markers = getProjectMarkers(project);
  if (markers.length >= AUDIO_EDITOR_MAX_MARKERS) return null;
  const marker: AudioProjectMarker = {
    id: createId('audio-marker'),
    positionMs: clampTimelineMs(positionMs),
    label: (label?.trim() || `Маркер ${markers.length + 1}`).slice(0, 120),
  };
  return { project: { ...project, markers: [...markers, marker] }, marker };
}

export function removeProjectMarker(project: AudioProject, markerId: string): AudioProject {
  return { ...project, markers: getProjectMarkers(project).filter((marker) => marker.id !== markerId) };
}

export function renameProjectMarker(project: AudioProject, markerId: string, label: string): AudioProject {
  const normalized = label.trim().slice(0, 120) || 'Маркер';
  return { ...project, markers: getProjectMarkers(project).map((marker) => marker.id === markerId ? { ...marker, label: normalized } : marker) };
}

export function findClip(project: AudioProject, clipId: string): { lane: AudioEditorLane; clip: AudioClip } | null {
  for (const lane of project.lanes) {
    const clip = lane.clips.find((item) => item.id === clipId);
    if (clip) return { lane, clip };
  }
  return null;
}

function patchClip(project: AudioProject, laneId: string, clipId: string, patch: Partial<AudioClip>): AudioProject {
  return mapLanes(project, (lane) => lane.id === laneId ? {
    ...lane,
    clips: lane.clips.map((clip) => clip.id === clipId ? normalizeAudioClip({ ...clip, ...patch }) : clip),
  } : lane);
}

function collectSnapCandidates(project: AudioProject, options: SnapOptions) {
  const excluded = options.excludedClipIds ?? new Set<string>();
  const candidates: { valueMs: number; kind: TimelineSnapKind }[] = [];
  if (Number.isFinite(options.playheadMs)) candidates.push({ valueMs: clampTimelineMs(options.playheadMs!), kind: 'playhead' });
  for (const marker of getProjectMarkers(project)) candidates.push({ valueMs: marker.positionMs, kind: 'marker' });
  for (const lane of project.lanes) {
    for (const clip of lane.clips) {
      if (excluded.has(clip.id)) continue;
      candidates.push({ valueMs: clip.timelineStartMs, kind: 'clip-start' });
      candidates.push({ valueMs: getClipTimelineEndMs(clip), kind: 'clip-end' });
    }
  }
  return candidates;
}

function snapPriority(kind: TimelineSnapKind) {
  switch (kind) {
    case 'playhead': return 0;
    case 'marker': return 1;
    case 'clip-start':
    case 'clip-end': return 2;
    case 'grid': return 3;
  }
}

function getClipLocations(project: AudioProject, ids: ReadonlySet<string>) {
  return project.lanes.flatMap((lane) => lane.clips.filter((clip) => ids.has(clip.id)).map((clip) => ({ lane, clip })));
}

function mapLanes(project: AudioProject, mapper: (lane: AudioEditorLane) => AudioEditorLane): AudioProject {
  return { ...project, lanes: project.lanes.map(mapper) };
}

function createLaneForPaste(index: number): AudioEditorLane {
  return { id: createId('audio-lane'), name: `Дорожка ${index + 1}`, muted: false, solo: false, clips: [] };
}

function clampTimelineMs(value: number) {
  return Math.round(clamp(Number.isFinite(value) ? value : 0, 0, AUDIO_EDITOR_MAX_PROJECT_MS));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
