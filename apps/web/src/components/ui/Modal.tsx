import React, { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, children, footer, width = 480 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" style={{ animation: 'fadeIn 0.15s ease' }} onClick={onClose} />
      <div
        className="relative bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl flex flex-col"
        style={{ width, maxHeight: '90vh', animation: 'modalIn 0.15s ease' }}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)]">
            <h2 className="font-semibold text-[var(--text)] text-base">{title}</h2>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded transition-colors">✕</button>
          </div>
        )}
        <div className="overflow-y-auto p-5 flex-1">{children}</div>
        {footer && <div className="border-t border-[var(--border-soft)] px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
