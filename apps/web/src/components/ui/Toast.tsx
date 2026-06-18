import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastTone = 'blue' | 'green' | 'red' | 'amber';

interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
}

export interface ToastApi {
  /** Show a toast with an explicit tone (default blue/info). */
  show: (text: string, tone?: ToastTone) => void;
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Access the toast API. Must be used under <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

const TONE_STYLE: Record<ToastTone, { accent: string; icon: ReactNode }> = {
  blue: { accent: 'var(--pill-blue-text)', icon: <Info size={16} strokeWidth={2} /> },
  green: { accent: 'var(--pill-green-text)', icon: <CheckCircle2 size={16} strokeWidth={2} /> },
  red: { accent: 'var(--pill-red-text)', icon: <AlertTriangle size={16} strokeWidth={2} /> },
  amber: { accent: 'var(--pill-amber-text)', icon: <AlertTriangle size={16} strokeWidth={2} /> },
};

const AUTO_DISMISS_MS = 5000;

/** A single persistent live region holding the toasts of one urgency level. */
function ToastRegion({
  live,
  toasts,
  onPause,
  onResume,
  onDismiss,
}: {
  live: 'polite' | 'assertive';
  toasts: ToastItem[];
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  return (
    <div aria-live={live} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {toasts.map((t) => {
        const s = TONE_STYLE[t.tone];
        return (
          <div
            key={t.id}
            onMouseEnter={() => onPause(t.id)}
            onMouseLeave={() => onResume(t.id)}
            className="toast-enter"
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '11px 12px',
              borderRadius: 10,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderLeft: `3px solid ${s.accent}`,
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)',
              fontSize: 13,
              color: 'var(--text)',
            }}
          >
            <span style={{ color: s.accent, flexShrink: 0, display: 'flex', paddingTop: 1 }}>{s.icon}</span>
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.45, wordBreak: 'break-word' }}>{t.text}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => onDismiss(t.id)}
              style={{
                flexShrink: 0,
                border: 0,
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                padding: 2,
                marginTop: 1,
              }}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (text: string, tone: ToastTone = 'blue') => {
      const id = (idRef.current += 1);
      setToasts((list) => [...list, { id, tone, text }]);
      timersRef.current.set(id, setTimeout(() => remove(id), AUTO_DISMISS_MS));
    },
    [remove],
  );

  // Pause the auto-dismiss timer while the pointer is over a toast so users
  // have time to read (and reach the dismiss button); resume on leave.
  const pause = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const resume = useCallback(
    (id: number) => {
      if (timersRef.current.has(id)) return;
      timersRef.current.set(id, setTimeout(() => remove(id), AUTO_DISMISS_MS));
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (t) => show(t, 'green'),
      error: (t) => show(t, 'red'),
      info: (t) => show(t, 'blue'),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxWidth: 'min(380px, calc(100vw - 32px))',
            pointerEvents: 'none',
          }}
        >
          {/* Two PERSISTENT live regions (always mounted, even when empty) so
              screen readers reliably announce toasts inserted into them.
              Errors/warnings interrupt (assertive); info/success wait (polite). */}
          <ToastRegion
            live="assertive"
            toasts={toasts.filter((t) => t.tone === 'red' || t.tone === 'amber')}
            onPause={pause}
            onResume={resume}
            onDismiss={remove}
          />
          <ToastRegion
            live="polite"
            toasts={toasts.filter((t) => t.tone !== 'red' && t.tone !== 'amber')}
            onPause={pause}
            onResume={resume}
            onDismiss={remove}
          />
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
