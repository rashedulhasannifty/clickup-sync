import React from 'react';

type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple';

const TONES: Record<Tone, string> = {
  gray: 'bg-[var(--muted-bg)] text-[var(--text-muted)]',
  green: 'bg-[rgba(16,185,129,0.1)] text-[#059669]',
  amber: 'bg-[rgba(245,158,11,0.1)] text-[#d97706]',
  red: 'bg-[rgba(239,68,68,0.1)] text-[#dc2626]',
  blue: 'bg-[rgba(59,130,246,0.1)] text-[#2563eb]',
  purple: 'bg-[var(--accent-soft)] text-[var(--accent)]',
};

export function Pill({ children, tone = 'gray', className = '' }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
