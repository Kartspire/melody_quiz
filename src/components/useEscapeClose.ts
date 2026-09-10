import { useLayoutEffect, useRef, type RefObject } from 'react';

const dialogs = new Set<HTMLElement>();
let previousOverflow = '';

export function isTopDialog(dialog: HTMLElement) {
  const ordered = [...dialogs].filter((item) => item.isConnected).sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  return ordered.at(-1) === dialog;
}

export function useEscapeClose(onClose: () => void, dialogRef: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogs.size === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    dialogs.add(dialog);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopDialog(dialog)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      dialogs.delete(dialog);
      if (dialogs.size === 0) document.body.style.overflow = previousOverflow;
    };
  }, [dialogRef]);
}
