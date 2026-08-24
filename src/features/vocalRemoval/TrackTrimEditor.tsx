import { useEffect, useState } from 'react';
import { MIN_CLIP_SECONDS, type TrimRange } from './audioClip';
import { clampNumber, formatAudioTime, formatEditableTime, parseAudioTime } from './audioTime';
import { InlineAudioPlayer } from './InlineAudioPlayer';

export function TrackTrimEditor({
  source,
  duration,
  range,
  disabled,
  busy,
  onChange,
  onCreateClip,
}: {
  source: string;
  duration: number;
  range: TrimRange;
  disabled: boolean;
  busy: boolean;
  onChange: (range: TrimRange) => void;
  onCreateClip: () => void;
}) {
  const selectedDuration = Math.max(0, range.end - range.start);

  return (
    <section className="track-editor-card">
      <div className="track-editor-card__heading">
        <div>
          <span className="eyebrow">Обрезка</span>
          <h2>Выберите нужный фрагмент</h2>
          <p>Перетащите левый и правый маркеры или укажите время вручную.</p>
        </div>
        <strong>{formatAudioTime(selectedDuration)}</strong>
      </div>

      <TrimRangeSelector
        duration={duration}
        start={range.start}
        end={range.end}
        disabled={disabled}
        onChange={onChange}
      />

      <div className="trim-time-fields">
        <TimeField
          label="Начало"
          value={range.start}
          max={Math.max(0, range.end - MIN_CLIP_SECONDS)}
          disabled={disabled}
          onCommit={(value) => onChange({ start: value, end: range.end })}
        />
        <TimeField
          label="Конец"
          value={range.end}
          min={Math.min(duration, range.start + MIN_CLIP_SECONDS)}
          max={duration}
          disabled={disabled}
          onCommit={(value) => onChange({ start: range.start, end: value })}
        />
        <div className="trim-duration-field">
          <span>Длина</span>
          <strong>{formatAudioTime(selectedDuration)}</strong>
        </div>
      </div>

      <div className="trim-preview">
        <span>Предпрослушивание выбранного участка</span>
        <InlineAudioPlayer source={source} label="Выбранный фрагмент" range={range} />
      </div>

      <div className="track-editor-actions">
        <button className="secondary-button" disabled={disabled} onClick={onCreateClip}>
          {busy ? 'Обрезаем…' : 'Подготовить обрезанный WAV'}
        </button>
        <small>Фрагмент: {formatAudioTime(range.start)} — {formatAudioTime(range.end)}</small>
      </div>
    </section>
  );
}

function TrimRangeSelector({
  duration,
  start,
  end,
  disabled,
  onChange,
}: {
  duration: number;
  start: number;
  end: number;
  disabled: boolean;
  onChange: (range: TrimRange) => void;
}) {
  const startPercent = duration > 0 ? (start / duration) * 100 : 0;
  const endPercent = duration > 0 ? (end / duration) * 100 : 100;

  return (
    <div className="trim-range-selector">
      <div className="trim-range-selector__track" aria-hidden="true">
        <span style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }} />
      </div>
      <input
        className="trim-range-input trim-range-input--start"
        type="range"
        aria-label="Начало фрагмента"
        min={0}
        max={duration}
        step={0.05}
        value={start}
        disabled={disabled}
        onChange={(event) => onChange({ start: Math.min(Number(event.target.value), end - MIN_CLIP_SECONDS), end })}
      />
      <input
        className="trim-range-input trim-range-input--end"
        type="range"
        aria-label="Конец фрагмента"
        min={0}
        max={duration}
        step={0.05}
        value={end}
        disabled={disabled}
        onChange={(event) => onChange({ start, end: Math.max(Number(event.target.value), start + MIN_CLIP_SECONDS) })}
      />
      <div className="trim-range-selector__labels" aria-hidden="true">
        <span>0:00</span>
        <span>{formatAudioTime(duration)}</span>
      </div>
    </div>
  );
}

function TimeField({
  label,
  value,
  min = 0,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(() => formatEditableTime(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(formatEditableTime(value));
  }, [editing, value]);

  const commit = () => {
    const parsed = parseAudioTime(text);
    if (parsed === null) {
      setText(formatEditableTime(value));
    } else {
      onCommit(clampNumber(parsed, min, max));
    }
    setEditing(false);
  };

  return (
    <label className="trim-time-field">
      <span>{label}</span>
      <input
        value={text}
        disabled={disabled}
        inputMode="decimal"
        aria-label={`${label} фрагмента`}
        onFocus={() => setEditing(true)}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setText(formatEditableTime(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
