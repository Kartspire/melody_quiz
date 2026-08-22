import { useEffect, useRef, useState } from 'react';

export function DraftNumberInput({
  value,
  onCommit,
  min,
  max,
  className,
  ariaLabel,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const skipNextBlurCommit = useRef(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.trunc(parsed)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      aria-label={ariaLabel}
      value={draft}
      onFocus={(event) => {
        setFocused(true);
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const next = event.target.value;
        if (!/^-?\d*$/.test(next)) return;
        setDraft(next);
      }}
      onBlur={() => {
        setFocused(false);
        if (skipNextBlurCommit.current) {
          skipNextBlurCommit.current = false;
          setDraft(String(value));
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          skipNextBlurCommit.current = true;
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}
