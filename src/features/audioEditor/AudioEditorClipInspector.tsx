import { useEffect, useRef, useState } from 'react';
import { GainSlider } from './editorFields';
import type { AudioClip, AudioProject } from '../../model/types';
import { AUDIO_EDITOR_MIN_CLIP_MS, getClipTimelineDurationMs, getClipTimelineEndMs } from './audioProject';
import { AudioEditorHelpTip } from './AudioEditorGuide';
import { clampEditableNumber, formatEditableNumber, isEditableDecimalDraft, parseEditableDecimal } from './editableNumber';

export function AudioEditorClipInspector({
  project,
  clip,
  laneId,
  sourceName,
  sourceDurationMs,
  playheadMs,
  selectedCount,
  onPatch, onBeginGain, onCommitGain,
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
  onPatch: (patch: Partial<AudioClip>, preview?: boolean) => void;
  onBeginGain?: () => void;
  onCommitGain?: () => void;
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
          <button className="secondary-button" title="Поставьте курсор внутри фрагмента и нажмите S" onClick={onSplit} disabled={playheadMs <= clip.timelineStartMs || playheadMs >= getClipTimelineEndMs(clip)}>Разрезать по курсору</button>
          <button className="secondary-button" title="Создать копию выбранного фрагмента" onClick={onDuplicate}>Дублировать</button>
          <button className="danger-button" title="Удалить выбранные фрагменты (Delete)" onClick={onDelete}>{selectedCount > 1 ? `Удалить (${selectedCount})` : 'Удалить'}</button>
        </div>
      </div>


      <div className="audio-editor-inspector-grid">
        <NumberField
          label="Позиция, сек"
          help="Где фрагмент начинается на общем таймлайне."
          value={clip.timelineStartMs / 1000}
          min={0}
          step={0.05}
          onChange={(value) => onPatch({ timelineStartMs: value * 1000 })}
        />
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
        <GainSlider label="Громкость фрагмента" value={clip.gainDb} onBegin={() => onBeginGain?.()} onPreview={value => onPatch({ gainDb: value }, true)} onCommit={() => onCommitGain?.()} />
        <NumberField label="Fade in, сек" help="Плавное появление звука в начале фрагмента." value={clip.fadeInMs / 1000} min={0} max={duration / 1000} step={0.05} onChange={(value) => onPatch({ fadeInMs: value * 1000 })} />
        <NumberField label="Fade out, сек" help="Плавное затухание звука в конце фрагмента." value={clip.fadeOutMs / 1000} min={0} max={duration / 1000} step={0.05} onChange={(value) => onPatch({ fadeOutMs: value * 1000 })} />
        <NumberField label="Скорость" help="0.5 — вдвое медленнее, 2 — вдвое быстрее. Сейчас вместе со скоростью меняется и высота звука." value={clip.playbackRate} min={0.25} max={4} step={0.05} onChange={(value) => onPatch({ playbackRate: value })} />
        <label className="audio-editor-field">
          <span>Дорожка <AudioEditorHelpTip text="Переносит активный фрагмент или всё текущее выделение на другую дорожку." /></span>
          <select value={laneId} onChange={(event) => onMoveLane(event.target.value)}>{project.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}</select>
        </label>
      </div>
    </section>
  );
}

export function NumberField({ label, help, value, min, max, step, onChange }: { label: string; help?: string; value: number; min?: number; max?: number; step: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(() => formatEditableNumber(value));
  const editingRef = useRef(false);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(formatEditableNumber(value));
  }, [value]);

  const commit = (raw = draft) => {
    const parsed = parseEditableDecimal(raw);
    if (parsed === null) {
      setDraft(formatEditableNumber(value));
      return;
    }

    const normalized = clampEditableNumber(parsed, min, max);
    setDraft(formatEditableNumber(normalized));
    if (Math.abs(normalized - value) >= 0.000_001) onChange(normalized);
  };

  const nudge = (direction: 1 | -1) => {
    const parsed = parseEditableDecimal(draft);
    const base = parsed ?? value;
    const normalized = clampEditableNumber(base + step * direction, min, max);
    setDraft(formatEditableNumber(normalized));
    onChange(normalized);
  };

  return (
    <label className="audio-editor-field">
      <span>{label}{help && <> <AudioEditorHelpTip text={help} /></>}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        aria-label={label}
        onFocus={() => {
          editingRef.current = true;
          skipBlurCommitRef.current = false;
        }}
        onChange={(event) => {
          const next = event.target.value;
          if (isEditableDecimalDraft(next)) setDraft(next);
        }}
        onBlur={() => {
          editingRef.current = false;
          if (skipBlurCommitRef.current) {
            skipBlurCommitRef.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            skipBlurCommitRef.current = true;
            setDraft(formatEditableNumber(value));
            event.currentTarget.blur();
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            nudge(1);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            nudge(-1);
          }
        }}
      />
    </label>
  );
}

function formatMs(ms: number) {
  const totalTenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(seconds % 1 ? 1 : 0).padStart(seconds % 1 ? 4 : 2, '0')}`;
}
