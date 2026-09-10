import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { isTopDialog, useEscapeClose } from './useEscapeClose';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"]):not(.hidden-file-input)',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type DialogProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  busy?: boolean;
};

export function Dialog({ eyebrow, title, description, onClose, children, className = '', busy = false }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useEscapeClose(() => { if (!busy) onClose(); }, dialogRef);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || !isTopDialog(dialog)) return;
      const initial = getFocusable(dialog)[0] ?? dialog;
      if (dialog.contains(document.activeElement)) return;
      initial.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      const previousFocus = restoreFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog || !isTopDialog(dialog)) return;
    event.stopPropagation();
    const focusable = getFocusable(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const outsideControls = !focusable.includes(document.activeElement as HTMLElement);
    if (event.shiftKey && (document.activeElement === first || outsideControls)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || outsideControls)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (!busy && event.currentTarget === event.target && dialogRef.current && isTopDialog(dialogRef.current)) onClose();
    }}>
      <section
        ref={dialogRef}
        className={`dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <div className="dialog__header">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
            {description && <div id={descriptionId} className="dialog__description">{description}</div>}
          </div>
          <button type="button" disabled={busy} className="icon-button dialog__close" aria-label="Закрыть" onClick={onClose}>×</button>
        </div>
        <fieldset disabled={busy} className="dialog__fields">{children}</fieldset>
      </section>
    </div>
  );
}

function getFocusable(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) =>
    !element.matches(':disabled') && !element.closest('[hidden], [inert], [aria-hidden="true"]')
      && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden',
  );
}
