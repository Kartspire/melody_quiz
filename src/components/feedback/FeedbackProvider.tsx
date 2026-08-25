import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Dialog } from '../Dialog';

export type ToastKind = 'success' | 'error' | 'info';

export type ToastOptions = {
  message: string;
  title?: string;
  kind?: ToastKind;
  durationMs?: number;
};

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
};

type ToastItem = Required<Pick<ToastOptions, 'message' | 'kind'>> & {
  id: number;
  title?: string;
};

type ConfirmRequest = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

type FeedbackApi = {
  notify: (options: ToastOptions | string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const FeedbackContext = createContext<FeedbackApi | null>(null);
const DEFAULT_TOAST_DURATION_MS = 3600;
const MAX_VISIBLE_TOASTS = 4;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const nextToastIdRef = useRef(1);
  const timersRef = useRef(new Map<number, number>());
  const confirmRef = useRef<ConfirmRequest | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((options: ToastOptions | string) => {
    const normalized = typeof options === 'string' ? { message: options } : options;
    const id = nextToastIdRef.current++;
    const item: ToastItem = {
      id,
      message: normalized.message,
      title: normalized.title,
      kind: normalized.kind ?? 'info',
    };
    setToasts((current) => [...current, item].slice(-MAX_VISIBLE_TOASTS));

    const timer = window.setTimeout(
      () => dismissToast(id),
      Math.max(1200, normalized.durationMs ?? DEFAULT_TOAST_DURATION_MS),
    );
    timersRef.current.set(id, timer);
  }, [dismissToast]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    if (confirmRef.current) confirmRef.current.resolve(false);
    const request = { ...options, resolve };
    confirmRef.current = request;
    setConfirmRequest(request);
  }), []);

  const resolveConfirm = useCallback((confirmed: boolean) => {
    const current = confirmRef.current;
    if (!current) return;
    confirmRef.current = null;
    setConfirmRequest(null);
    current.resolve(confirmed);
  }, []);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
    confirmRef.current?.resolve(false);
    confirmRef.current = null;
  }, []);

  const value = useMemo<FeedbackApi>(() => ({ notify, confirm }), [confirm, notify]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      {confirmRequest && (
        <Dialog
          eyebrow={confirmRequest.tone === 'danger' ? 'Подтверждение действия' : undefined}
          title={confirmRequest.title}
          description={confirmRequest.description}
          onClose={() => resolveConfirm(false)}
          className="confirm-dialog"
        >
          <div className="confirm-dialog__actions">
            <button
              type="button"
              className={confirmRequest.tone === 'danger' ? 'danger-button' : 'primary-button'}
              onClick={() => resolveConfirm(true)}
            >
              {confirmRequest.confirmLabel ?? 'Подтвердить'}
            </button>
            <button type="button" className="secondary-button" onClick={() => resolveConfirm(false)}>
              {confirmRequest.cancelLabel ?? 'Отмена'}
            </button>
          </div>
        </Dialog>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used inside FeedbackProvider.');
  return context;
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-viewport" aria-live="polite" aria-relevant="additions removals">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`app-toast app-toast--${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="app-toast__icon" aria-hidden="true">
            {toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '!' : 'i'}
          </span>
          <div className="app-toast__content">
            {toast.title && <strong>{toast.title}</strong>}
            <span>{toast.message}</span>
          </div>
          <button type="button" className="app-toast__close" aria-label="Закрыть уведомление" onClick={() => onDismiss(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
