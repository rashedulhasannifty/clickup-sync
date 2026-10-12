import { Pencil, Trash2 } from 'lucide-react';
import type { EmploymentEventView } from '../../api/people';
import { eventTitle, formatDate } from '../../lib/people';

const JOIN_TYPES = new Set(['JOINED', 'JOINED_AS_INTERN']);

/**
 * Employment history, newest first: a vertical rail with one dot per event.
 * Past records (history entered by HR) carry a small "From records" tag and,
 * when `onEdit`/`onDelete` are given, their own edit and delete buttons; what
 * the system recorded itself never does. Once a past record gives the real
 * join date, the app's own JOINED row reads as when they were added here.
 */
export function CareerTimeline({
  events,
  onEdit,
  onDelete,
}: {
  events: EmploymentEventView[];
  onEdit?: (e: EmploymentEventView) => void;
  onDelete?: (e: EmploymentEventView) => void;
}) {
  if (events.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No events recorded yet.</div>;
  }
  const pastJoin = events.some((e) => e.source === 'PAST_RECORD' && JOIN_TYPES.has(e.type));
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {events.map((e, i) => {
        const past = e.source === 'PAST_RECORD';
        const title = !past && e.type === 'JOINED' && pastJoin ? 'Added to this system' : eventTitle(e);
        return (
          <li key={e.id} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: i === events.length - 1 ? 0 : 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 10 }}>
              <span
                aria-hidden
                style={{
                  width: 10, height: 10, borderRadius: '50%', marginTop: 4, flexShrink: 0,
                  background: past ? 'var(--surface)' : 'var(--accent)',
                  border: past ? '2px solid var(--accent)' : undefined,
                  boxSizing: 'border-box',
                }}
              />
              {i !== events.length - 1 && <span aria-hidden style={{ flex: 1, width: 2, background: 'var(--border)', marginTop: 2 }} />}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
                {past && (
                  <span
                    title="Entered from records: history from before this system"
                    style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--accent-strong)', background: 'var(--accent-soft)', borderRadius: 999, padding: '0 7px', lineHeight: '17px' }}
                  >
                    From records
                  </span>
                )}
                {past && (onEdit || onDelete) && (
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2 }}>
                    {onEdit && (
                      <button type="button" aria-label={`Edit ${title}`} title="Edit" onClick={() => onEdit(e)} style={iconButton}>
                        <Pencil size={12} />
                      </button>
                    )}
                    {onDelete && (
                      <button type="button" aria-label={`Delete ${title}`} title="Delete" onClick={() => onDelete(e)} style={iconButton}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {formatDate(e.effectiveDate)}
                {e.type === 'TRANSFERRED' && e.fromLabel ? ` · from ${e.fromLabel}` : ''}
                {e.type !== 'TRANSFERRED' && e.type !== 'INCREMENT' && e.fromLabel && !JOIN_TYPES.has(e.type) ? ` · from ${e.fromLabel}` : ''}
                {e.createdByName ? ` · by ${e.createdByName}` : ''}
              </div>
              {e.notes && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                  {e.notes}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const iconButton = {
  all: 'unset',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 6,
  color: 'var(--text-muted)',
} as const;
