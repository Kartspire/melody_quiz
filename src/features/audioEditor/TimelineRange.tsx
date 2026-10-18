import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AudioProject, AudioTimeRange } from '../../model/types';
import { snapTimelinePosition } from './timelineEditing';
import { startPointerDrag } from './pointerDrag';

export function startRangeDrag(event: ReactPointerEvent, project: AudioProject, zoom: number, range: AudioTimeRange | null,
  edge: 'start' | 'end' | 'new', onChange: (range: AudioTimeRange | null) => void, onSeek: (ms: number, precise?: boolean) => void) {
  if (event.button !== 0) return;
  event.stopPropagation();
  const owner = event.currentTarget.closest<HTMLElement>('.audio-editor-timeline-shell')!;
  const rect = owner.querySelector('.audio-editor-ruler')!.getBoundingClientRect();
  const read = (x: number, altKey: boolean) => snapTimelinePosition(project, (x - rect.left) / zoom * 1000, { pixelsPerSecond: zoom, disabled: altKey }).valueMs;
  const startX = event.clientX;
  const anchor = edge === 'new' ? read(startX, event.altKey) : edge === 'start' ? range!.endMs : range!.startMs;
  let moved = false;
  startPointerDrag(owner, event.pointerId, e => {
    if (!moved && Math.abs(e.clientX - startX) < 3) return;
    moved = true;
    const value = read(e.clientX, e.altKey);
    onChange({ startMs: Math.min(21_599_999, value, anchor), endMs: Math.min(21_600_000, Math.max(value, anchor + (value === anchor ? 1 : 0))) });
  }, cancelled => {
    if (cancelled) onChange(range);
    else if (!moved && edge === 'new') onSeek(anchor, true);
  });
}
export function TimelineRange({ project, zoom, range, onChange, onSeek }: {
  project: AudioProject; zoom: number; range: AudioTimeRange; onChange: (range: AudioTimeRange | null) => void; onSeek: (ms: number, precise?: boolean) => void;
}) {
  return <div className="audio-editor-range-overlay" style={{ left: range.startMs / 1000 * zoom, width: (range.endMs - range.startMs) / 1000 * zoom }}>
    <button className="audio-editor-range-edge audio-editor-range-edge--start" aria-label="Начало диапазона" onPointerDown={e => startRangeDrag(e, project, zoom, range, 'start', onChange, onSeek)} />
    <button className="audio-editor-range-edge audio-editor-range-edge--end" aria-label="Конец диапазона" onPointerDown={e => startRangeDrag(e, project, zoom, range, 'end', onChange, onSeek)} />
  </div>;
}
