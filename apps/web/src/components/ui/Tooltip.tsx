import React, { useState } from 'react';

export function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-xs text-white bg-[var(--text)] rounded shadow-lg whitespace-nowrap z-50 pointer-events-none">
          {content}
        </span>
      )}
    </span>
  );
}
