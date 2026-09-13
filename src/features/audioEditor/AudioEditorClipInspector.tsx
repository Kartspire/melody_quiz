import type { AudioClip, AudioProject } from '../../model/types';
import { AUDIO_EDITOR_MIN_CLIP_MS, getClipTimelineDurationMs, getClipTimelineEndMs } from './audioProject';
import type { AudioEditorMode } from './audioEditorUi';
import { AudioEditorHelpTip } from './AudioEditorGuide';

export function AudioEditorClipInspector({
  mode,
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
  mode: AudioEditorMode;
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
  const hasHiddenAdvancedSettings = clip.gainDb !== 0 || clip.fadeInMs > 0 || clip.fadeOutMs > 0 || clip.playbackRate !== 1 || project.lanes.length > 1 || project.lanes.some((lane) => lane.muted || lane.solo);
  return (
    <section className="audio-editor-inspector">
      <div className="audio-editor-inspector__heading">
        <div>
          <span className="eyebrow">{selectedCount > 1 ? `Активный из ${selectedCount} фрагментов` : 'Выбранный фрагмент'}</span>
          <strong>{sourceName}</strong>
          <small>Длина на таймлайне: {formatMs(duration)}</small>
        </div>
        <div className="inline-actions">
          <button className="secondary-button" title="Поставьте курсор внутри фрагмента и нажмите S" onClick={onSplit} disabled={playheadMs <= clip.timelineStartMs || playheadMs >= getClipTimelineEndMs(clip)}>Разрезать по курсору</button>
          <button className="secondary-button" title="Создать копию выбранного фрагмента" onClick={onDuplicate}>Дублировать</button>
          <button className="danger-button" title="Удалить выбранные фрагменты (Delete)" onClick={onDelete}>{selectedCount > 1 ? `Удалить (${selectedCount})` : 'Удалить'}</button>
        </div>
      </div>

      {mode === 'simple' && (
        <>
          <div className="audio-editor-inspector-tip">
            <strong>Самый простой способ обрезки:</strong> тяните левый и правый край фрагмента прямо на таймлайне. Поля ниже нужны, если хочется указать время точно.
          </div>
          {hasHiddenAdvancedSettings && <div className="audio-editor-inspector-warning">В этом монтаже уже используются расширенные параметры. Переключитесь в «Расширенный» режим, чтобы увидеть и изменить их.</div>}
        </>
      )}

      <div className={`audio-editor-inspector-grid${mode === 'simple' ? ' audio-editor-inspector-grid--simple' : ''}`}>
        {mode === 'advanced' && (
          <NumberField
            label="Позиция, сек"
            help="Где фрагмент начинается на общем таймлайне."
            value={clip.timelineStartMs / 1000}
            min={0}
            step={0.05}
            onChange={(value) => onPatch({ timelineStartMs: value * 1000 })}
          />
        )}
        <NumberField
          label="Начало исходника, сек"
          help="С какой секунды оригинального файла начинается этот фрагмент."
          value={clip.sourceStartMs / 1000}
          min={0}
          max={(clip.sourceEndMs - AUDIO_EDITOR_MIN_CLIP_MS) / 1000}
          step={0.05}
          onChange={(value) => onPatch({ sourceStartMs: value * 1000 })}
        />
        <NumberField
          label="Конец исходника, сек"
          help="На какой секунде оригинального файла заканчивается этот фрагмент."
          value={clip.sourceEndMs / 1000}
          min={(clip.sourceStartMs + AUDIO_EDITOR_MIN_CLIP_MS) / 1000}
          max={maxSourceEnd / 1000}
          step={0.05}
          onChange={(value) => onPatch({ sourceEndMs: value * 1000 })}
        />
        {mode === 'advanced' && (
          <>
            <NumberField label="Громкость, dB" help="0 dB — исходная громкость. Отрицательные значения делают фрагмент тише, положительные — громче." value={clip.gainDb} min={-60} max={12} step={0.5} onChange={(value) => onPatch({ gainDb: value })} />
            <NumberField label="Fade in, сек" help="Плавное появление звука в начале фрагмента." value={clip.fadeInMs / 1000} min={0} max={duration / 1000} step={0.05} onChange={(value) => onPatch({ fadeInMs: value * 1000 })} />
            <NumberField label="Fade out, сек" help="Плавное затухание звука в конце фрагмента." value={clip.fadeOutMs / 1000} min={0} max={duration / 1000} step={0.05} onChange={(value) => onPatch({ fadeOutMs: value * 1000 })} />
            <NumberField label="Скорость" help="0.5 — вдвое медленнее, 2 — вдвое быстрее. Сейчас вместе со скоростью меняется и высота звука." value={clip.playbackRate} min={0.25} max={4} step={0.05} onChange={(value) => onPatch({ playbackRate: value })} />
            <label className="audio-editor-field">
              <span>Дорожка <AudioEditorHelpTip text="Переносит активный фрагмент или всё текущее выделение на другую дорожку." /></span>
              <select value={laneId} onChange={(event) => onMoveLane(event.target.value)}>{project.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}</select>
            </label>
          </>
        )}
      </div>
    </section>
  );
}

function NumberField({ label, help, value, min, max, step, onChange }: { label: string; help?: string; value: number; min?: number; max?: number; step: number; onChange: (value: number) => void }) {
  return <label className="audio-editor-field"><span>{label}{help && <> <AudioEditorHelpTip text={help} /></>}</span><input type="number" value={round(value, 3)} min={min} max={max} step={step} onChange={(event) => {
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
