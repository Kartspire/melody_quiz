import { useEffect, useRef, useState } from 'react';

export function TextField({ label, value, maxLength, onCommit }: { label: string; value: string; maxLength: number; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input aria-label={label} value={draft} maxLength={maxLength} onChange={e => setDraft(e.target.value)}
    onBlur={() => { const next = draft.trim() || value; setDraft(next); if (next !== value) onCommit(next); }}
    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(value); e.preventDefault(); } }} />;
}

/** Preview each change, commit one history entry on release/blur. */
export function GainSlider({ label, value, max = 12, onBegin, onPreview, onCommit }: {
  label: string; value: number; max?: number; onBegin: () => void; onPreview: (value: number) => void; onCommit: () => void;
}) {
  const active = useRef(false);
  const finish = () => { if (active.current) { active.current = false; onCommit(); } };
  return <label className="audio-editor-gain"><span>{label} <output>{value.toFixed(1)} dB</output></span>
    <input type="range" aria-label={label} min={-60} max={max} step={0.5} value={value}
      onChange={e => { if (!active.current) { active.current = true; onBegin(); } onPreview(Number(e.target.value)); }}
      onPointerUp={finish} onPointerCancel={finish} onKeyUp={finish} onBlur={finish} />
    <button className="audio-editor-volume-reset" type="button" disabled={value === 0} onClick={() => { onBegin(); onPreview(0); onCommit(); }}>Сбросить на 0 dB</button>
  </label>;
}
