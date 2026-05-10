import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open?: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}

export function Modal({ open = true, onClose, title, subtitle, children, footer, width = 480 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
        style={{
          position: 'relative', width, maxWidth: '100%', maxHeight: '90vh',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(15, 23, 42, 0.18)',
          display: 'flex', flexDirection: 'column',
          animation: 'modalIn 180ms ease-out',
        }}
      >
        {(title || subtitle) && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '16px 18px 12px',
            borderBottom: title ? '1px solid var(--border-soft)' : undefined,
          }}
          >
            <div style={{ flex: 1 }}>
              {title && <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{title}</div>}
              {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 6 }}
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        )}
        <div style={{ padding: '14px 18px 18px', overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ borderTop: '1px solid var(--border-soft)', padding: '12px 18px 16px' }}>{footer}</div>
        )}
      </div>
    </div>
  );
}
