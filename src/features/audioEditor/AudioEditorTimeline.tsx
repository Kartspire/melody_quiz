import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { AudioAsset, AudioClip, AudioProject, MediaTrack } from '../../model/types';
import { getClipTimelineDurationMs, getClipTimelineEndMs, getProjectDurationMs, normalizeAudioClip } from './audioProject';
import { WaveformCanvas } from './WaveformCanvas';
import { getProjectMarkers, moveClips, snapSelectionDelta, snapTimelinePosition, trimClipEnd, trimClipStart } from './timelineEditing';
import { cloneAudioProject } from './useAudioEditorHistory';

const MIN_ZOOM = 16;
const MAX_ZOOM = 180;

type ProjectChangeOptions = {
  recordHistory?: boolean;
  historySnapshot?: AudioProject;
};

export function AudioEditorTimeline({
  project,
  trackById,
  assetById,
  sourceDurations,
  pixelsPerSecond,
  playheadMs,
  isPlaying,
  selectedClipIds,
  activeClipId,
  onSeek,
  onSelectionChange,
  onSelectLane,
  onProjectChange,
  onToggleLane,
  onRenameLane,
  onRemoveLane,
  onZoomChange,
  onRemoveMarker,
}: {
  project: AudioProject;
  trackById: Map<string, MediaTrack>;
  assetById: Map<string, AudioAsset>;
  sourceDurations: Record<string, number>;
  pixelsPerSecond: number;
  playheadMs: number;
  isPlaying: boolean;
  selectedClipIds: readonly string[];
  activeClipId: string | null;
  onSeek: (positionMs: number) => void;
  onSelectionChange: (clipIds: string[], activeClipId: string | null, laneId?: string) => void;
  onSelectLane: (laneId: string) => void;
  onProjectChange: (project: AudioProject, options?: ProjectChangeOptions) => void;
  onToggleLane: (laneId: string, key: 'muted' | 'solo') => void;
  onRenameLane: (laneId: string, name: string) => void;
  onRemoveLane: (laneId: string) => void;
  onZoomChange: (value: number) => void;
  onRemoveMarker: (markerId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [snapGuideMs, setSnapGuideMs] = useState<number | null>(null);
  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const width = Math.max(1200, Math.ceil((getProjectDurationMs(project) + 30_000) / 1000 * pixelsPerSecond));

  useEffect(() => {
    if (!isPlaying) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const x = playheadMs / 1000 * pixelsPerSecond;
    const leftSafe = scroll.scrollLeft + scroll.clientWidth * 0.18;
    const rightSafe = scroll.scrollLeft + scroll.clientWidth * 0.82;
    if (x < leftSafe || x > rightSafe) {
      scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.28);
    }
  }, [isPlaying, pixelsPerSecond, playheadMs]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const timeAtPointerMs = (scroll.scrollLeft + localX) / pixelsPerSecond * 1000;
    const factor = event.deltaY < 0 ? 1.12 : 0.88;
    const nextZoom = clamp(Math.round(pixelsPerSecond * factor), MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === pixelsPerSecond) return;
    onZoomChange(nextZoom);
    requestAnimationFrame(() => {
      const current = scrollRef.current;
      if (current) current.scrollLeft = Math.max(0, timeAtPointerMs / 1000 * nextZoom - localX);
    });
  };

  return (
    <div className="audio-editor-timeline-shell">
      <div className="audio-editor-lane-controls">
        <div className="audio-editor-ruler-spacer" />
        {project.lanes.map((lane) => (
          <div key={lane.id} className="audio-editor-lane-control" onClick={() => onSelectLane(lane.id)}>
            <input value={lane.name} maxLength={120} onChange={(event) => onRenameLane(lane.id, event.target.value)} />
            <div>
              <button className={lane.muted ? 'audio-editor-mini audio-editor-mini--active' : 'audio-editor-mini'} onClick={(event) => { event.stopPropagation(); onToggleLane(lane.id, 'muted'); }}>M</button>
              <button className={lane.solo ? 'audio-editor-mini audio-editor-mini--active' : 'audio-editor-mini'} onClick={(event) => { event.stopPropagation(); onToggleLane(lane.id, 'solo'); }}>S</button>
              <button className="audio-editor-mini" disabled={project.lanes.length <= 1 || lane.clips.length > 0} onClick={(event) => { event.stopPropagation(); onRemoveLane(lane.id); }}>×</button>
            </div>
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="audio-editor-scroll" onWheel={handleWheel}>
        <div
          className="audio-editor-timeline"
          style={{ width }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            onSelectionChange([], null);
            onSeek((event.clientX - rect.left) / pixelsPerSecond * 1000);
          }}
        >
          <TimelineRuler
            project={project}
            width={width}
            pixelsPerSecond={pixelsPerSecond}
            onSeek={onSeek}
            onRemoveMarker={onRemoveMarker}
          />
          {project.lanes.map((lane) => (
            <div
              key={lane.id}
              className="audio-editor-lane"
              style={{ width, backgroundSize: `${pixelsPerSecond}px 100%` }}
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget) return;
                const rect = event.currentTarget.getBoundingClientRect();
                onSelectLane(lane.id);
                onSelectionChange([], null, lane.id);
                onSeek((event.clientX - rect.left) / pixelsPerSecond * 1000);
              }}
            >
              {lane.clips.map((clip) => {
                const track = trackById.get(clip.sourceTrackId);
                const asset = track ? assetById.get(track.audioId) : undefined;
                return (
                  <TimelineClip
                    key={clip.id}
                    clip={clip}
                    project={project}
                    laneId={lane.id}
                    label={track?.name ?? 'Исходник отсутствует'}
                    asset={asset}
                    sourceDurationMs={sourceDurations[clip.sourceTrackId]}
                    pixelsPerSecond={pixelsPerSecond}
                    playheadMs={playheadMs}
                    selected={selectedSet.has(clip.id)}
                    activeClipId={activeClipId}
                    selectedClipIds={selectedClipIds}
                    onSelectionChange={onSelectionChange}
                    onProjectChange={onProjectChange}
                    onSnapGuideChange={setSnapGuideMs}
                  />
                );
              })}
            </div>
          ))}

          {getProjectMarkers(project).map((marker) => (
            <div
              key={marker.id}
              className="audio-editor-marker-line"
              style={{ left: marker.positionMs / 1000 * pixelsPerSecond }}
              title={`${marker.label} — ${formatMs(marker.positionMs)}`}
              aria-hidden="true"
            />
          ))}
          {snapGuideMs !== null && <div className="audio-editor-snap-guide" style={{ left: snapGuideMs / 1000 * pixelsPerSecond }} aria-hidden="true" />}
          <div className="audio-editor-playhead" style={{ left: playheadMs / 1000 * pixelsPerSecond }} aria-hidden="true"><span /></div>
        </div>
      </div>
    </div>
  );
}

function TimelineRuler({ project, width, pixelsPerSecond, onSeek, onRemoveMarker }: {
  project: AudioProject;
  width: number;
  pixelsPerSecond: number;
  onSeek: (positionMs: number) => void;
  onRemoveMarker: (markerId: string) => void;
}) {
  const durationSeconds = Math.ceil(width / pixelsPerSecond);
  const step = pixelsPerSecond >= 120 ? 1 : pixelsPerSecond >= 64 ? 2 : pixelsPerSecond >= 30 ? 5 : 10;
  const ticks: number[] = [];
  for (let second = 0; second <= durationSeconds; second += step) ticks.push(second);
  return (
    <div className="audio-editor-ruler" onPointerDown={(event) => {
      if (event.target !== event.currentTarget && !(event.target instanceof HTMLSpanElement)) return;
      const rect = event.currentTarget.getBoundingClientRect();
      onSeek((event.clientX - rect.left) / pixelsPerSecond * 1000);
    }}>
      {ticks.map((second) => <span key={second} style={{ left: second * pixelsPerSecond }}>{formatMs(second * 1000)}</span>)}
      {getProjectMarkers(project).map((marker) => (
        <button
          key={marker.id}
          className="audio-editor-marker"
          style={{ left: marker.positionMs / 1000 * pixelsPerSecond }}
          title={`${marker.label}. Двойной клик — удалить`}
          onPointerDown={(event) => { event.stopPropagation(); onSeek(marker.positionMs); }}
          onDoubleClick={(event) => { event.stopPropagation(); onRemoveMarker(marker.id); }}
        >
          <span>{marker.label}</span>
        </button>
      ))}
    </div>
  );
}

function TimelineClip({
  clip,
  project,
  laneId,
  label,
  asset,
  sourceDurationMs,
  pixelsPerSecond,
  playheadMs,
  selected,
  activeClipId,
  selectedClipIds,
  onSelectionChange,
  onProjectChange,
  onSnapGuideChange,
}: {
  clip: AudioClip;
  project: AudioProject;
  laneId: string;
  label: string;
  asset?: AudioAsset;
  sourceDurationMs?: number;
  pixelsPerSecond: number;
  playheadMs: number;
  selected: boolean;
  activeClipId: string | null;
  selectedClipIds: readonly string[];
  onSelectionChange: (clipIds: string[], activeClipId: string | null, laneId?: string) => void;
  onProjectChange: (project: AudioProject, options?: ProjectChangeOptions) => void;
  onSnapGuideChange: (positionMs: number | null) => void;
}) {
  const left = clip.timelineStartMs / 1000 * pixelsPerSecond;
  const timelineDuration = getClipTimelineDurationMs(clip);
  const width = Math.max(8, timelineDuration / 1000 * pixelsPerSecond);
  const fadeInLeft = Math.min(width - 4, Math.max(0, clip.fadeInMs / 1000 * pixelsPerSecond));
  const fadeOutRight = Math.min(width - 4, Math.max(0, clip.fadeOutMs / 1000 * pixelsPerSecond));

  const gesture = (event: ReactPointerEvent, mode: 'move' | 'left' | 'right' | 'fade-in' | 'fade-out') => {
    event.stopPropagation();
    const modifier = event.ctrlKey || event.metaKey || event.shiftKey;
    if (modifier && mode === 'move') {
      const next = selected ? selectedClipIds.filter((id) => id !== clip.id) : [...selectedClipIds, clip.id];
      const nextActive = selected
        ? (activeClipId === clip.id ? next[next.length - 1] ?? null : (activeClipId && next.includes(activeClipId) ? activeClipId : activeClipIdFromSelection(project, next, clip.id)))
        : clip.id;
      onSelectionChange(next, nextActive, laneId);
      return;
    }

    const dragIds = mode === 'move' && selected ? [...selectedClipIds] : [clip.id];
    if (!selected || mode !== 'move') onSelectionChange(mode === 'move' ? dragIds : [clip.id], clip.id, laneId);

    const startX = event.clientX;
    const snapshot = cloneAudioProject(project);
    const initialLocation = findClip(snapshot, clip.id);
    if (!initialLocation) return;
    const initial = initialLocation.clip;
    let changed = false;
    let finalProject = snapshot;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      const rawDeltaMs = (moveEvent.clientX - startX) / pixelsPerSecond * 1000;
      if (mode === 'move') {
        const snap = snapSelectionDelta(snapshot, dragIds, rawDeltaMs, { pixelsPerSecond, playheadMs });
        if (Math.abs(snap.deltaMs) < 0.001) return;
        finalProject = moveClips(snapshot, dragIds, snap.deltaMs, true);
        changed = true;
        onSnapGuideChange(snap.guideMs);
        onProjectChange(finalProject, { recordHistory: false });
        return;
      }

      if (mode === 'fade-in' || mode === 'fade-out') {
        const maxFade = getClipTimelineDurationMs(initial);
        const value = mode === 'fade-in' ? initial.fadeInMs + rawDeltaMs : initial.fadeOutMs - rawDeltaMs;
        const nextValue = clamp(Math.round(value / 10) * 10, 0, maxFade);
        if (Math.abs(nextValue - (mode === 'fade-in' ? initial.fadeInMs : initial.fadeOutMs)) < 0.001) return;
        finalProject = patchClipInProject(snapshot, laneId, clip.id, mode === 'fade-in' ? { fadeInMs: nextValue } : { fadeOutMs: nextValue });
        changed = true;
        onSnapGuideChange(null);
        onProjectChange(finalProject, { recordHistory: false });
        return;
      }

      const movingEdge = mode === 'left'
        ? initial.timelineStartMs + rawDeltaMs
        : getClipTimelineEndMs(initial) + rawDeltaMs;
      const snap = snapTimelinePosition(snapshot, movingEdge, { pixelsPerSecond, playheadMs, excludedClipIds: new Set([clip.id]) });
      const deltaMs = mode === 'left' ? snap.valueMs - initial.timelineStartMs : snap.valueMs - getClipTimelineEndMs(initial);

      finalProject = mode === 'left'
        ? trimClipStart(snapshot, clip.id, initial.timelineStartMs + deltaMs)
        : trimClipEnd(snapshot, clip.id, getClipTimelineEndMs(initial) + deltaMs, sourceDurationMs);
      if (finalProject === snapshot) return;
      changed = true;
      onSnapGuideChange(snap.guideMs);
      onProjectChange(finalProject, { recordHistory: false });
    };

    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      onSnapGuideChange(null);
      if (changed) onProjectChange(finalProject, { recordHistory: true, historySnapshot: snapshot });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div
      className={`audio-editor-clip${selected ? ' audio-editor-clip--selected' : ''}${activeClipId === clip.id ? ' audio-editor-clip--active' : ''}`}
      style={{ left, width }}
      title={label}
      onPointerDown={(event) => gesture(event, 'move')}
      data-clip-id={clip.id}
    >
      <WaveformCanvas asset={asset} sourceStartMs={clip.sourceStartMs} sourceEndMs={clip.sourceEndMs} />
      <div className="audio-editor-fade-area audio-editor-fade-area--in" style={{ width: fadeInLeft }} aria-hidden="true" />
      <div className="audio-editor-fade-area audio-editor-fade-area--out" style={{ width: fadeOutRight }} aria-hidden="true" />
      <strong>{label}</strong>
      <small>{formatMs(clip.sourceStartMs)}–{formatMs(clip.sourceEndMs)}</small>
      <button className="audio-editor-trim-handle audio-editor-trim-handle--left" aria-label="Обрезать начало" onPointerDown={(event) => gesture(event, 'left')} />
      <button className="audio-editor-trim-handle audio-editor-trim-handle--right" aria-label="Обрезать конец" onPointerDown={(event) => gesture(event, 'right')} />
      <button className="audio-editor-fade-handle audio-editor-fade-handle--in" aria-label="Fade in" style={{ left: fadeInLeft }} onPointerDown={(event) => gesture(event, 'fade-in')} />
      <button className="audio-editor-fade-handle audio-editor-fade-handle--out" aria-label="Fade out" style={{ right: fadeOutRight }} onPointerDown={(event) => gesture(event, 'fade-out')} />
    </div>
  );
}

function patchClipInProject(project: AudioProject, laneId: string, clipId: string, patch: Partial<AudioClip>) {
  return {
    ...project,
    lanes: project.lanes.map((lane) => lane.id === laneId ? {
      ...lane,
      clips: lane.clips.map((item) => item.id === clipId ? normalizeAudioClip({ ...item, ...patch }) : item),
    } : lane),
  };
}

function findClip(project: AudioProject, clipId: string) {
  for (const lane of project.lanes) {
    const clip = lane.clips.find((item) => item.id === clipId);
    if (clip) return { lane, clip };
  }
  return null;
}

function activeClipIdFromSelection(project: AudioProject, ids: readonly string[], removedId: string) {
  const idSet = new Set(ids);
  for (const lane of project.lanes) {
    for (const clip of lane.clips) if (clip.id !== removedId && idSet.has(clip.id)) return clip.id;
  }
  return null;
}

function formatMs(ms: number) {
  const totalTenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(seconds % 1 ? 1 : 0).padStart(seconds % 1 ? 4 : 2, '0')}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
