import type { ReactNode } from 'react';
import { Dialog } from './Dialog';

type PickerDialogProps = {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

export function PickerDialog({ eyebrow, title, description, onClose, children, className = '' }: PickerDialogProps) {
  return (
    <Dialog
      eyebrow={eyebrow}
      title={title}
      description={description}
      onClose={onClose}
      className={`picker-dialog ${className}`.trim()}
    >
      {children}
    </Dialog>
  );
}

export function PickerToolbar({ children }: { children: ReactNode }) {
  return <div className="picker-dialog__toolbar">{children}</div>;
}

export function PickerList({ children }: { children: ReactNode }) {
  return <div className="picker-dialog__list">{children}</div>;
}

export function PickerRow({
  selected,
  onClick,
  primary,
  secondary,
  meta,
}: {
  selected: boolean;
  onClick: () => void;
  primary: ReactNode;
  secondary: ReactNode;
  meta: ReactNode;
}) {
  return (
    <button
      type="button"
      className={selected ? 'picker-dialog__row picker-dialog__row--selected' : 'picker-dialog__row'}
      onClick={onClick}
    >
      <div><strong>{primary}</strong><span>{secondary}</span></div>
      <small>{meta}</small>
    </button>
  );
}

export function PickerEmpty({ children }: { children: ReactNode }) {
  return <div className="empty-state compact-empty"><p>{children}</p></div>;
}

export function PickerFooterAction({ children }: { children: ReactNode }) {
  return <div className="picker-dialog__footer">{children}</div>;
}
