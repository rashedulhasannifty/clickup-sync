import React from 'react';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  action?: React.ReactNode;
  className?: string;
  padding?: boolean;
  onClick?: () => void;
}

export function Card({ children, title, action, className = '', padding = true, onClick }: CardProps) {
  return (
    <div
      className={`bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] ${onClick ? 'cursor-pointer hover:border-[var(--border-strong)] transition-colors' : ''} ${className}`}
      onClick={onClick}
    >
      {(title || action) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-soft)]">
          {title && <span className="font-semibold text-[var(--text)] text-sm">{title}</span>}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={padding ? 'p-4' : ''}>{children}</div>
    </div>
  );
}
