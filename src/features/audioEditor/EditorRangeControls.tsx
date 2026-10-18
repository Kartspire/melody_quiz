import type { AudioTimeRange } from '../../model/types';
import { NumberField } from './AudioEditorClipInspector';

export function EditorRangeControls({ range, loop, onRange, onLoop, onPlay, onSave }: {
  range: AudioTimeRange | null; loop: boolean; onRange: (range: AudioTimeRange | null) => void;
  onLoop: (value: boolean) => void; onPlay: () => void; onSave: () => void;
}) {
  if (!range) return null;
  return <section className="audio-editor-range-controls" aria-label="Диапазон времени">
    <div className="audio-editor-range-fields">
      <NumberField label="Начало диапазона, сек" value={range.startMs / 1000} min={0} max={(range.endMs - 1) / 1000} step={0.001} onChange={v => onRange({ ...range, startMs: Math.round(v * 1000) })} />
      <NumberField label="Конец диапазона, сек" value={range.endMs / 1000} min={(range.startMs + 1) / 1000} max={21600} step={0.001} onChange={v => onRange({ ...range, endMs: Math.round(v * 1000) })} />
      <NumberField label="Длина диапазона, сек" value={(range.endMs - range.startMs) / 1000} min={0.001} max={(21_600_000 - range.startMs) / 1000} step={0.001} onChange={v => onRange({ ...range, endMs: range.startMs + Math.round(v * 1000) })} />
    </div>
    <div className="inline-actions">
      <button className="secondary-button" onClick={onPlay}>▶ Диапазон / пауза</button>
      <label className="audio-editor-check"><input type="checkbox" checked={loop} onChange={e => onLoop(e.target.checked)} />Повторять</label>
      <button className="secondary-button" onClick={onSave}>Сохранить диапазон</button>
      <button className="secondary-button" onClick={() => onRange(null)}>Снять диапазон</button>
    </div>
  </section>;
}
