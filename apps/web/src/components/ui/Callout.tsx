import React from 'react';

type Tone = 'info' | 'warning' | 'error' | 'success' | 'neutral';

const STYLES: Record<Tone, { bg: string; border: string; text: string; icon: string }> = {
  info: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.3)', text: '#2563eb', icon: 'ℹ' },
  warning: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)', text: '#d97706', icon: '⚠' },
  error: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)', text: '#dc2626', icon: '✕' },
  success: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)', text: '#059669', icon: '✓' },
  neutral: { bg: 'var(--muted-bg)', border: 'var(--border)', text: 'var(--text-muted)', icon: '·' },
};

export function Callout({ tone = 'info', children }: { tone?: Tone; children: React.ReactNode }) {
  const s = STYLES[tone];
  return (
    <div className="flex gap-2 rounded-[var(--radius)] px-3 py-2.5 text-sm" style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text }}>
      <span className="flex-shrink-0 font-bold">{s.icon}</span>
      <div className="text-[var(--text)]">{children}</div>
    </div>
  );
}
