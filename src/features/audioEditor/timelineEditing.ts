import { createId } from '../../lib/ids';
import type { AudioClip, AudioEditorLane, AudioProject, AudioProjectMarker } from '../../model/types';
import {
  AUDIO_EDITOR_MAX_PROJECT_MS,
  AUDIO_EDITOR_MIN_CLIP_MS,
  getClipTimelineDurationMs,
  getClipTimelineEndMs,
  normalizeAudioClip,
  splitAudioClip,
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
  durationMs: number;
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

export function moveClips(project: AudioProject, clipIds: readonly string[], deltaMs: number, autoCrossfade = true): AudioProject {
  const ids = new Set(clipIds);
  const selected = getClipLocations(project, ids);
  if (selected.length === 0 || Math.abs(deltaMs) < 0.001) return project;
  const minStart = Math.min(...selected.map(({ clip }) => clip.timelineStartMs));
  const maxEnd = Math.max(...selected.map(({ clip }) => getClipTimelineEndMs(clip)));
  const safeDelta = clamp(deltaMs, -minStart, AUDIO_EDITOR_MAX_PROJECT_MS - maxEnd);
  const affectedLaneIds = new Set(selected.map(({ lane }) => lane.id));
  const next = mapLanes(project, (lane) => ({
    ...lane,
    clips: lane.clips.map((clip) => ids.has(clip.id)
      ? normalizeAudioClip({ ...clip, timelineStartMs: clip.timelineStartMs + safeDelta })
      : clip),
  }));
  return autoCrossfade ? applyAutoCrossfades(next, affectedLaneIds) : next;
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
  return applyAutoCrossfades(next, new Set([lane.id]));
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
  return applyAutoCrossfades(next, new Set([lane.id]));
}

export function insertClip(
  project: AudioProject,
  laneId: string,
  inputClip: AudioClip,
  positionMs: number,
  ripple: boolean,
): AudioProject {
  const position = clampTimelineMs(positionMs);
  const clip = normalizeAudioClip({ ...inputClip, timelineStartMs: position });
  const duration = getClipTimelineDurationMs(clip);
  const next = mapLanes(project, (lane) => {
    if (lane.id !== laneId) return lane;
    if (!ripple) return { ...lane, clips: [...lane.clips, clip] };
    const withGap = createRippleGap(lane, position, duration);
    return { ...withGap, clips: [...withGap.clips, clip] };
  });
  return ripple ? next : applyAutoCrossfades(next, new Set([laneId]));
}

export function deleteClips(project: AudioProject, clipIds: readonly string[], ripple: boolean): AudioProject {
  const ids = new Set(clipIds);
  if (ids.size === 0) return project;
  return mapLanes(project, (lane) => {
    const selected = lane.clips.filter((clip) => ids.has(clip.id));
    if (selected.length === 0) return lane;
    const remaining = lane.clips.filter((clip) => !ids.has(clip.id));
    if (!ripple) return { ...lane, clips: remaining };

    const ranges = mergeRanges(selected.map((clip) => ({ start: clip.timelineStartMs, end: getClipTimelineEndMs(clip) })));
    const clips = remaining.map((clip) => {
      const shift = ranges.reduce((sum, range) => clip.timelineStartMs >= range.end ? sum + (range.end - range.start) : sum, 0);
      return shift > 0 ? normalizeAudioClip({ ...clip, timelineStartMs: Math.max(0, clip.timelineStartMs - shift) }) : clip;
    });
    return { ...lane, clips };
  });
}

export function copyClips(project: AudioProject, clipIds: readonly string[]): AudioClipboard | null {
  const ids = new Set(clipIds);
  const laneIndexById = new Map(project.lanes.map((lane, index) => [lane.id, index]));
  const selected = getClipLocations(project, ids);
  if (selected.length === 0) return null;
  const minStart = Math.min(...selected.map(({ clip }) => clip.timelineStartMs));
  const minLane = Math.min(...selected.map(({ lane }) => laneIndexById.get(lane.id) ?? 0));
  const maxEnd = Math.max(...selected.map(({ clip }) => getClipTimelineEndMs(clip)));
  return {
    clips: selected.map(({ lane, clip }) => ({
      clip: { ...clip, timelineStartMs: clip.timelineStartMs - minStart },
      laneOffset: (laneIndexById.get(lane.id) ?? 0) - minLane,
    })),
    durationMs: Math.max(AUDIO_EDITOR_MIN_CLIP_MS, maxEnd - minStart),
  };
}

export function pasteClips(
  project: AudioProject,
  clipboard: AudioClipboard,
  positionMs: number,
  anchorLaneId: string,
  ripple: boolean,
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

  if (ripple) {
    const touchedLaneIndexes = new Set(clipboard.clips.map((item) => anchorIndex + Math.min(item.laneOffset, availableMaxOffset)));
    lanes = lanes.map((lane, laneIndex) => touchedLaneIndexes.has(laneIndex)
      ? createRippleGap(lane, safePosition, clipboard.durationMs)
      : lane);
  }

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

  let next: AudioProject = { ...project, lanes };
  if (!ripple) next = applyAutoCrossfades(next, new Set(ids.flatMap((id) => {
    const location = findClip(projectWithLanes(project, lanes), id);
    return location ? [location.lane.id] : [];
  })));
  return { project: next, clipIds: ids };
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
  return applyAutoCrossfades({ ...project, lanes }, new Set([targetLaneId]));
}

export function applyAutoCrossfades(project: AudioProject, laneIds?: ReadonlySet<string>): AudioProject {
  return mapLanes(project, (lane) => {
    if (laneIds && !laneIds.has(lane.id)) return lane;
    if (lane.clips.length < 2) return lane;
    const sorted = [...lane.clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs || a.id.localeCompare(b.id));
    const patches = new Map<string, Partial<AudioClip>>();
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const left = sorted[index]!;
      const right = sorted[index + 1]!;
      const overlap = getClipTimelineEndMs(left) - right.timelineStartMs;
      if (overlap <= 0) continue;
      const safeOverlap = Math.min(overlap, getClipTimelineDurationMs(left), getClipTimelineDurationMs(right));
      patches.set(left.id, { ...(patches.get(left.id) ?? {}), fadeOutMs: safeOverlap });
      patches.set(right.id, { ...(patches.get(right.id) ?? {}), fadeInMs: safeOverlap });
    }
    if (patches.size === 0) return lane;
    return {
      ...lane,
      clips: lane.clips.map((clip) => patches.has(clip.id) ? normalizeAudioClip({ ...clip, ...patches.get(clip.id)! }) : clip),
    };
  });
}

export function applyCrossfadeToSelection(project: AudioProject, clipIds: readonly string[]): AudioProject | null {
  if (clipIds.length !== 2) return null;
  const ids = new Set(clipIds);
  for (const lane of project.lanes) {
    const clips = lane.clips.filter((clip) => ids.has(clip.id)).sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    if (clips.length !== 2) continue;
    const overlap = getClipTimelineEndMs(clips[0]!) - clips[1]!.timelineStartMs;
    if (overlap <= 0) return null;
    return applyAutoCrossfades(project, new Set([lane.id]));
  }
  return null;
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

function createRippleGap(lane: AudioEditorLane, positionMs: number, durationMs: number): AudioEditorLane {
  const clips: AudioClip[] = [];
  for (const existing of lane.clips) {
    const start = existing.timelineStartMs;
    const end = getClipTimelineEndMs(existing);
    if (start < positionMs && end > positionMs) {
      const split = splitAudioClip(existing, positionMs);
      if (split) {
        clips.push(split[0], normalizeAudioClip({ ...split[1], timelineStartMs: split[1].timelineStartMs + durationMs }));
        continue;
      }
    }
    clips.push(start >= positionMs
      ? normalizeAudioClip({ ...existing, timelineStartMs: existing.timelineStartMs + durationMs })
      : existing);
  }
  return { ...lane, clips };
}

function mergeRanges(ranges: { start: number; end: number }[]) {
  const sorted = ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start);
  const result: { start: number; end: number }[] = [];
  for (const range of sorted) {
    const last = result[result.length - 1];
    if (!last || range.start > last.end) result.push({ ...range });
    else last.end = Math.max(last.end, range.end);
  }
  return result;
}

function createLaneForPaste(index: number): AudioEditorLane {
  return { id: createId('audio-lane'), name: `Дорожка ${index + 1}`, muted: false, solo: false, clips: [] };
}

function projectWithLanes(project: AudioProject, lanes: AudioEditorLane[]): AudioProject {
  return { ...project, lanes };
}

function clampTimelineMs(value: number) {
  return Math.round(clamp(Number.isFinite(value) ? value : 0, 0, AUDIO_EDITOR_MAX_PROJECT_MS));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
