import React from 'react';

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 text-xs rounded border border-[var(--border-strong)] bg-[var(--muted-bg)] text-[var(--text-muted)] font-mono leading-none">
      {children}
    </kbd>
  );
}
