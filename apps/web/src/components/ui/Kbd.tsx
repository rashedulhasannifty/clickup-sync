import React from 'react';

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: 'inherit',
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 5px',
        borderRadius: 4,
        background: 'var(--muted-bg)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </kbd>
  );
}
