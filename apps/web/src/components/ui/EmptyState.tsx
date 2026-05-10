import React from 'react';

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-[var(--muted-bg)] flex items-center justify-center text-[var(--text-faint)] text-2xl mb-3">○</div>
      <p className="font-medium text-[var(--text)] mb-1">{title}</p>
      {body && <p className="text-sm text-[var(--text-muted)] max-w-xs mb-4">{body}</p>}
      {action}
    </div>
  );
}
