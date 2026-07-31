const STATUS_COLORS: Record<string, { bg: string; dot: string; text: string }> = {
  complete: { bg: 'rgba(16,185,129,0.1)', dot: '#10b981', text: '#059669' },
  completed: { bg: 'rgba(16,185,129,0.1)', dot: '#10b981', text: '#059669' },
  success: { bg: 'rgba(16,185,129,0.1)', dot: '#10b981', text: '#059669' },
  processed: { bg: 'rgba(16,185,129,0.1)', dot: '#10b981', text: '#059669' },
  closed: { bg: 'rgba(16,185,129,0.1)', dot: '#10b981', text: '#059669' },
  running: { bg: 'rgba(59,130,246,0.1)', dot: '#3b82f6', text: '#2563eb' },
  pending: { bg: 'rgba(59,130,246,0.1)', dot: '#3b82f6', text: '#2563eb' },
  'in progress': { bg: 'rgba(59,130,246,0.1)', dot: '#3b82f6', text: '#2563eb' },
  active: { bg: 'rgba(59,130,246,0.1)', dot: '#3b82f6', text: '#2563eb' },
  open: { bg: 'rgba(100,116,139,0.1)', dot: '#64748b', text: '#475569' },
  review: { bg: 'rgba(245,158,11,0.1)', dot: '#f59e0b', text: '#d97706' },
  partial: { bg: 'rgba(245,158,11,0.1)', dot: '#f59e0b', text: '#d97706' },
  blocked: { bg: 'rgba(239,68,68,0.1)', dot: '#ef4444', text: '#dc2626' },
  failed: { bg: 'rgba(239,68,68,0.1)', dot: '#ef4444', text: '#dc2626' },
  error: { bg: 'rgba(239,68,68,0.1)', dot: '#ef4444', text: '#dc2626' },
  COST_CALCULATED: { bg: 'rgba(16,185,129,0.1)', dot: '#10b981', text: '#059669' },
  NO_RATE_FOUND: { bg: 'rgba(245,158,11,0.1)', dot: '#f59e0b', text: '#d97706' },
  Fresh: { bg: 'rgba(16,185,129,0.1)', dot: '#10b981', text: '#059669' },
  Stale: { bg: 'rgba(245,158,11,0.1)', dot: '#f59e0b', text: '#d97706' },
  Unknown: { bg: 'rgba(100,116,139,0.1)', dot: '#64748b', text: '#475569' },
};

const DEFAULT_COLORS = { bg: 'rgba(100,116,139,0.1)', dot: '#64748b', text: '#475569' };

export function StatusBadge({ status, color }: { status: string; color?: string }) {
  const c = color
    ? { bg: `${color}22`, dot: color, text: color }
    : STATUS_COLORS[status] ?? STATUS_COLORS[status?.toLowerCase()] ?? DEFAULT_COLORS;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: c.bg, color: c.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.dot }} />
      {status}
    </span>
  );
}
