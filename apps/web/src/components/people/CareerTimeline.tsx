import type { EmploymentEventView } from '../../api/people';
import { eventTitle, formatDate } from '../../lib/people';

/** Employment history, newest first: a vertical rail with one dot per event. */
export function CareerTimeline({ events }: { events: EmploymentEventView[] }) {
  if (events.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No events recorded yet.</div>;
  }
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {events.map((e, i) => (
        <li key={e.id} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: i === events.length - 1 ? 0 : 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 10 }}>
            <span
              aria-hidden
              style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', marginTop: 4, flexShrink: 0 }}
            />
            {i !== events.length - 1 && <span aria-hidden style={{ flex: 1, width: 2, background: 'var(--border)', marginTop: 2 }} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{eventTitle(e)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {formatDate(e.effectiveDate)}
              {e.type === 'TRANSFERRED' && e.fromLabel ? ` · from ${e.fromLabel}` : ''}
              {e.type !== 'TRANSFERRED' && e.fromLabel && e.type !== 'JOINED' ? ` · from ${e.fromLabel}` : ''}
              {e.createdByName ? ` · by ${e.createdByName}` : ''}
            </div>
            {e.notes && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                {e.notes}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
