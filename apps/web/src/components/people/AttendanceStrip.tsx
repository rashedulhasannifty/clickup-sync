import type { AttendanceDayView } from '../../api/people';
import { formatClock, formatDate, formatMinutes, formatShortDate, formatWeekday, STRIP_STATE } from '../../lib/people';

const LEGEND_ORDER = ['on-time', 'late', 'sick', 'casual', 'leave', 'absent'] as const;

function describe(d: AttendanceDayView): string {
  const base = `${formatWeekday(d.date)} ${formatDate(d.date)} · ${STRIP_STATE[d.state].label}`;
  if (d.firstIn) {
    return `${base} · in ${formatClock(d.firstIn)}, out ${formatClock(d.lastOut)} · ${formatMinutes(d.minutesInOffice)}`;
  }
  return base;
}

/** The last business days at a glance: one cell per day, coloured by state, with a legend and counts. */
export function AttendanceStrip({ days }: { days: AttendanceDayView[] }) {
  if (days.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No working days in the employment window yet.</div>;
  }
  const counts = new Map<string, number>();
  for (const d of days) counts.set(d.state, (counts.get(d.state) ?? 0) + 1);

  return (
    <div>
      <div
        role="list"
        aria-label={`Attendance for the last ${days.length} working days`}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(22px, 26px))', gap: 4 }}
      >
        {days.map((d) => (
          <span
            key={d.date}
            role="listitem"
            title={describe(d)}
            aria-label={describe(d)}
            style={{
              height: 24,
              borderRadius: 5,
              background: STRIP_STATE[d.state].color,
              opacity: d.state === 'future' ? 0.7 : 1,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
        <span>{formatShortDate(days[0].date)}</span>
        <span>{formatShortDate(days[days.length - 1].date)}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        {LEGEND_ORDER.filter((s) => counts.has(s)).map((s) => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: STRIP_STATE[s].color }} />
            {STRIP_STATE[s].label}
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{counts.get(s)}</span>
          </span>
        ))}
        {counts.has('future') && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: STRIP_STATE.future.color }} />
            {STRIP_STATE.future.label}
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{counts.get('future')}</span>
          </span>
        )}
      </div>
    </div>
  );
}
