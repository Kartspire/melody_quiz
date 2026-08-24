import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useEscapeClose } from './useEscapeClose';

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
};

export function Dialog({ eyebrow, title, description, onClose, children, className = '' }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEscapeClose(onClose);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const initial = dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog;
      initial.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      const previousFocus = restoreFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section
        ref={dialogRef}
        className={`dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
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
          <button type="button" className="icon-button dialog__close" aria-label="Закрыть" onClick={onClose}>×</button>
        </div>
        {children}
      </section>
    </div>
  );
}
