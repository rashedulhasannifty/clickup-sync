import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  width?: number;
  title?: string;
  footer?: React.ReactNode;
}

/**
 * Selector for elements that can take keyboard focus. Used by the focus trap
 * to find the first/last focusable inside the drawer.
 *
 * Note we filter out `[tabindex="-1"]` and elements with `disabled`/`inert`
 * so Tab/Shift+Tab cycles through real, reachable targets only.
 */
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
    .filter(el => !el.hasAttribute('inert') && el.offsetParent !== null);
}

export function Drawer({ open, onClose, children, width = 520, title, footer }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // a11y: when the drawer opens, remember who had focus so we can restore it on
  // close, then move focus into the panel. When the drawer closes, return focus
  // to the trigger element. This is the standard modal-dialog contract.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    if (panel) {
      // Prefer the first focusable inside the drawer; fall back to the panel
      // itself (which has tabIndex=-1 below) so screen readers land somewhere
      // sensible even if the body is empty.
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

      // Focus trap: when Tab/Shift+Tab would leave the panel, wrap.
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
      // Restore focus to whatever opened the drawer. Guard against the element
      // being removed from the DOM in the meantime.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div
        role="presentation"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(2px)', animation: 'fadeIn 150ms ease-out' }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{
          position: 'relative', width, height: '100%',
          background: 'var(--surface)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '-12px 0 32px rgba(15, 23, 42, 0.08)',
          animation: 'slideInRight 200ms ease-out',
          outline: 'none',
        }}
      >
        {title && (
          <div style={{
            flexShrink: 0,
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}
          >
            <div id={titleId} style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
            <button
              type="button"
              className="btn-3d"
              onClick={onClose}
              aria-label="Close"
              style={{
                flexShrink: 0,
                width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                ['--b-edge' as string]: 'var(--border-strong)',
                ['--b-glow' as string]: 'var(--btn-neutral-glow)',
                ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
              }}
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
        {footer && (
          <div style={{
            flexShrink: 0,
            padding: '12px 18px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
