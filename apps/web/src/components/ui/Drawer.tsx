import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  width?: number;
  title?: string;
  footer?: React.ReactNode;
}

export function Drawer({ open, onClose, children, width = 520, title, footer }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
        style={{
          position: 'relative', width, height: '100%',
          background: 'var(--surface)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '-12px 0 32px rgba(15, 23, 42, 0.08)',
          animation: 'slideInRight 200ms ease-out',
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
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                flexShrink: 0,
                width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
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
