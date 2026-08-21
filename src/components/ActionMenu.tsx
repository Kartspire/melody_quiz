import { type ReactNode, useEffect, useRef, useState } from 'react';

export function ActionMenu({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }, 0);

    const close = (restoreFocus = false) => {
      setOpen(false);
      if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    const onWindowBlur = () => close();

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`action-menu ${className}`.trim()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="action-menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >⋯</button>
      {open && (
        <div
          ref={panelRef}
          className="action-menu__panel"
          role="menu"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button:not(:disabled)')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
