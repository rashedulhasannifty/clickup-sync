import React, { useEffect } from 'react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
}

export function Drawer({ open, onClose, title, children, width = 520, footer }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30" style={{ animation: 'fadeIn 0.15s ease' }} onClick={onClose} />
      <div
        className="relative bg-[var(--surface)] border-l border-[var(--border)] flex flex-col h-full shadow-2xl"
        style={{ width, animation: 'slideInRight 0.2s ease' }}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)] flex-shrink-0">
            <h2 className="font-semibold text-[var(--text)] text-base">{title}</h2>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded transition-colors">
              ✕
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex-shrink-0 border-t border-[var(--border-soft)] px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
