import type { AttendanceDayView } from '../../api/people';
import {
  formatClock,
  formatDate,
  formatMinutes,
  formatShortDate,
  formatWeekday,
  rowSourceLabel,
  STRIP_STATE,
} from '../../lib/people';

const LEGEND_ORDER = ['on-time', 'late', 'present', 'weekend', 'sick', 'casual', 'leave', 'absent'] as const;

/** Real door data with no punch and no leave: say so plainly, it is not a data gap. */
function stateLabel(d: AttendanceDayView): string {
  if (d.state === 'absent' && (d.source === 'stellar-csv' || d.source === 'stellar-api')) return 'Absent, no leave recorded';
  return STRIP_STATE[d.state].label;
}

function describeDay(d: AttendanceDayView): string {
  const parts = [`${formatWeekday(d.date)} ${formatDate(d.date)} · ${stateLabel(d)}`];
  if (d.firstIn) {
    parts.push(`in ${formatClock(d.firstIn)}, out ${formatClock(d.lastOut)}${d.missingOut ? ' (last out missing)' : ''}`);
    if (d.workedMinutes != null) {
      parts.push(`worked ${formatMinutes(d.workedMinutes)}${d.sessions ? ` in ${d.sessions} session${d.sessions === 1 ? '' : 's'}` : ''}`);
    } else {
      parts.push(formatMinutes(d.minutesInOffice));
    }
  }
  if (d.note) parts.push(`note: ${d.note}`);
  const source = rowSourceLabel(d.source);
  if (source) parts.push(source);
  return parts.join(' · ');
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
            title={describeDay(d)}
            aria-label={describeDay(d)}
            style={{
              height: 24,
              borderRadius: 5,
              background: STRIP_STATE[d.state].color,
              opacity: d.state === 'future' ? 0.7 : 1,
              // Weekend work is extra: a dashed outline sets it apart from the working days.
              outline: d.state === 'weekend' ? '1px dashed var(--text-faint)' : undefined,
              outlineOffset: d.state === 'weekend' ? 1 : undefined,
              position: 'relative',
            }}
          >
            {d.missingOut && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--surface)',
                  boxShadow: '0 0 0 1px var(--red)',
                }}
              />
            )}
          </span>
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
        {days.some((d) => d.missingOut) && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--surface)', boxShadow: '0 0 0 1px var(--red)' }} />
            Last out missing
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{days.filter((d) => d.missingOut).length}</span>
          </span>
        )}
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
