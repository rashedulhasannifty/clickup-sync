import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open?: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  /**
   * When provided, the body + footer are wrapped in a <form> so pressing Enter
   * in a field (or a footer button with type="submit") submits the dialog.
   * The handler should preventDefault internally is unnecessary — we already do.
   */
  onSubmit?: () => void;
}

// Same focusable-element contract the Drawer uses for its trap.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
}

export function Modal({ open = true, onClose, title, subtitle, children, footer, width = 480, onSubmit }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // a11y: focus-on-open, trap Tab within the dialog, restore focus on close —
  // the standard modal-dialog contract (mirrors Drawer). Without this, keyboard
  // and screen-reader users can Tab out of the modal into the page behind it.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) {
      const focusables = getFocusable(panel);
      (focusables[0] ?? panel).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusables = getFocusable(panel);
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)',
          animation: 'fadeIn 150ms ease-out',
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{
          position: 'relative', width, maxWidth: '100%', maxHeight: '90vh',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(15, 23, 42, 0.18)',
          display: 'flex', flexDirection: 'column',
          animation: 'modalIn 180ms ease-out',
          outline: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '16px 18px 12px',
            borderBottom: title || subtitle ? '1px solid var(--border-soft)' : undefined,
          }}
        >
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && <div id={titleId} style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{title}</div>}
              {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                border: 0,
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                padding: 4,
                borderRadius: 6,
                flexShrink: 0,
              }}
            >
              <X size={16} strokeWidth={1.75} />
            </button>
        </div>
        {onSubmit ? (
          <form
            onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
            style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
          >
            <div style={{ padding: '14px 18px 18px', overflowY: 'auto', flex: 1 }}>{children}</div>
            {footer && (
              <div style={{ borderTop: '1px solid var(--border-soft)', padding: '12px 18px 16px' }}>{footer}</div>
            )}
          </form>
        ) : (
          <>
            <div style={{ padding: '14px 18px 18px', overflowY: 'auto', flex: 1 }}>{children}</div>
            {footer && (
              <div style={{ borderTop: '1px solid var(--border-soft)', padding: '12px 18px 16px' }}>{footer}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
