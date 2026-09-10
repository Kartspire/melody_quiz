import type { AudioClip, AudioProject } from '../../model/types';
import { AUDIO_EDITOR_MIN_CLIP_MS, getClipTimelineDurationMs, getClipTimelineEndMs } from './audioProject';

export function AudioEditorClipInspector({
  project,
  clip,
  laneId,
  sourceName,
  sourceDurationMs,
  playheadMs,
  selectedCount,
  onPatch,
  onMoveLane,
  onSplit,
  onDuplicate,
  onDelete,
}: {
  project: AudioProject;
  clip: AudioClip;
  laneId: string;
  sourceName: string;
  sourceDurationMs?: number;
  playheadMs: number;
  selectedCount: number;
  onPatch: (patch: Partial<AudioClip>) => void;
  onMoveLane: (laneId: string) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const duration = getClipTimelineDurationMs(clip);
  const maxSourceEnd = sourceDurationMs ?? clip.sourceEndMs;
  return (
    <section className="audio-editor-inspector">
      <div className="audio-editor-inspector__heading">
        <div>
          <span className="eyebrow">{selectedCount > 1 ? `Активный из ${selectedCount} фрагментов` : 'Выбранный фрагмент'}</span>
          <strong>{sourceName}</strong>
          <small>Длина на таймлайне: {formatMs(duration)}</small>
        </div>
        <div className="inline-actions">
          <button className="secondary-button" title="S" onClick={onSplit} disabled={playheadMs <= clip.timelineStartMs || playheadMs >= getClipTimelineEndMs(clip)}>Разрезать по курсору</button>
          <button className="secondary-button" onClick={onDuplicate}>Дублировать</button>
          <button className="danger-button" title="Delete" onClick={onDelete}>{selectedCount > 1 ? `Удалить (${selectedCount})` : 'Удалить'}</button>
        </div>
      </div>
      <div className="audio-editor-inspector-grid">
        <NumberField label="Позиция, сек" value={clip.timelineStartMs / 1000} min={0} step={0.05} onChange={(value) => onPatch({ timelineStartMs: value * 1000 })} />
        <NumberField label="Начало исходника, сек" value={clip.sourceStartMs / 1000} min={0} max={(clip.sourceEndMs - AUDIO_EDITOR_MIN_CLIP_MS) / 1000} step={0.05} onChange={(value) => onPatch({ sourceStartMs: value * 1000 })} />
        <NumberField label="Конец исходника, сек" value={clip.sourceEndMs / 1000} min={(clip.sourceStartMs + AUDIO_EDITOR_MIN_CLIP_MS) / 1000} max={maxSourceEnd / 1000} step={0.05} onChange={(value) => onPatch({ sourceEndMs: value * 1000 })} />
        <NumberField label="Громкость, dB" value={clip.gainDb} min={-60} max={12} step={0.5} onChange={(value) => onPatch({ gainDb: value })} />
        <NumberField label="Fade in, сек" value={clip.fadeInMs / 1000} min={0} max={duration / 1000} step={0.05} onChange={(value) => onPatch({ fadeInMs: value * 1000 })} />
        <NumberField label="Fade out, сек" value={clip.fadeOutMs / 1000} min={0} max={duration / 1000} step={0.05} onChange={(value) => onPatch({ fadeOutMs: value * 1000 })} />
        <NumberField label="Скорость" value={clip.playbackRate} min={0.25} max={4} step={0.05} onChange={(value) => onPatch({ playbackRate: value })} />
        <label className="audio-editor-field"><span>Дорожка</span><select value={laneId} onChange={(event) => onMoveLane(event.target.value)}>{project.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}</select></label>
      </div>
    </section>
  );
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min?: number; max?: number; step: number; onChange: (value: number) => void }) {
  return <label className="audio-editor-field"><span>{label}</span><input type="number" value={round(value, 3)} min={min} max={max} step={step} onChange={(event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next)));
  }} /></label>;
}

function formatMs(ms: number) {
  const totalTenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(seconds % 1 ? 1 : 0).padStart(seconds % 1 ? 4 : 2, '0')}`;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
