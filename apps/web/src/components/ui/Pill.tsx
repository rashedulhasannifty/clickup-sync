import React from 'react';

type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple';

const TONES: Record<Tone, { bg: string; text: string }> = {
  gray:   { bg: 'var(--pill-gray-bg)',   text: 'var(--pill-gray-text)' },
  green:  { bg: 'var(--pill-green-bg)',  text: 'var(--pill-green-text)' },
  amber:  { bg: 'var(--pill-amber-bg)',  text: 'var(--pill-amber-text)' },
  red:    { bg: 'var(--pill-red-bg)',    text: 'var(--pill-red-text)' },
  blue:   { bg: 'var(--pill-blue-bg)',   text: 'var(--pill-blue-text)' },
  purple: { bg: 'var(--pill-purple-bg)', text: 'var(--pill-purple-text)' },
};

export function Pill({
  children,
  tone = 'gray',
  icon,
  className = '',
}: {
  children: React.ReactNode;
  tone?: Tone;
  icon?: React.ReactNode;
  className?: string;
}) {
  const { bg, text } = TONES[tone];
  return (
    <span
      className={`inline-flex items-center text-[11px] font-semibold leading-snug whitespace-nowrap ${className}`}
      style={{
        padding: '3px 8px',
        borderRadius: 6,
        background: bg,
        color: text,
        gap: 4,
        letterSpacing: '0.01em',
      }}
    >
      {icon}
      {children}
    </span>
  );
}
