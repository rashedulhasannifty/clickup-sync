import React from 'react';

type Tone = 'info' | 'warning' | 'error' | 'success' | 'neutral' | 'blue' | 'amber' | 'red' | 'green';

const STYLES: Record<Tone, { bg: string; border: string; text: string }> = {
  info:    { bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.3)',  text: 'var(--pill-blue-text)' },
  blue:    { bg: 'var(--pill-blue-bg)',    border: 'rgba(59,130,246,0.25)', text: 'var(--pill-blue-text)' },
  warning: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)',  text: 'var(--pill-amber-text)' },
  amber:   { bg: 'var(--pill-amber-bg)',  border: 'rgba(245,158,11,0.25)', text: 'var(--pill-amber-text)' },
  error:   { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.3)',   text: 'var(--pill-red-text)' },
  red:     { bg: 'var(--pill-red-bg)',    border: 'rgba(239,68,68,0.25)',  text: 'var(--pill-red-text)' },
  success: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)',  text: 'var(--pill-green-text)' },
  green:   { bg: 'var(--pill-green-bg)',  border: 'rgba(16,185,129,0.25)', text: 'var(--pill-green-text)' },
  neutral: { bg: 'var(--muted-bg)',       border: 'var(--border)',          text: 'var(--text-muted)' },
};

export function Callout({ tone = 'info', icon, children }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode }) {
  const s = STYLES[tone] ?? STYLES.info;
  return (
    <div style={{
      display: 'flex', gap: 8, borderRadius: 8, padding: '10px 12px', fontSize: 13,
      background: s.bg, border: `1px solid ${s.border}`, color: s.text,
    }}>
      {icon && <span style={{ flexShrink: 0, display: 'flex', paddingTop: 1 }}>{icon}</span>}
      <div style={{ color: 'var(--text)' }}>{children}</div>
    </div>
  );
}
