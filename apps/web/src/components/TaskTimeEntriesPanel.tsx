import { AlertTriangle, CircleCheck } from 'lucide-react';
import { useTimeEntriesList } from '../hooks/useReports';
import { fmt } from '../lib/formatters';
import { ClickupAvatar } from './ui/ClickupAvatar';
import { Pill } from './ui/Pill';
import { Skeleton } from './ui/Skeleton';
import type { TimeEntryItem } from './TimeEntryDrawer';

/**
 * The per-entry breakdown behind one row of the grouped-by-task Time Entries
 * table.
 *
 * Fetched lazily (mounted only once its row is expanded) and with the page's
 * *own* filter params plus `taskId`, so the entries listed here are exactly the
 * ones the collapsed row totalled. Passing anything less than the full filter
 * set would list entries the total above doesn't include.
 */

/** Entries per expanded task. Far above any real task; guards a pathological one. */
const MAX_ENTRIES = 500;

interface Props {
  taskId: string;
  /** The page's current filter params (limit/offset already stripped by the caller). */
  params: Record<string, string | number | undefined>;
  onSelectEntry: (entry: TimeEntryItem) => void;
}

export function TaskTimeEntriesPanel({ taskId, params, onSelectEntry }: Props) {
  const { data, isLoading, isError } = useTimeEntriesList({ ...params, taskId, limit: MAX_ENTRIES, offset: 0 });
  const items: TimeEntryItem[] = (data as { items?: TimeEntryItem[] } | undefined)?.items ?? [];
  const total: number = (data as { total?: number } | undefined)?.total ?? 0;

  const cell: React.CSSProperties = {
    padding: '5px 10px',
    borderBottom: '1px solid var(--border-soft)',
    whiteSpace: 'nowrap',
    fontSize: 12,
  };
  const head: React.CSSProperties = {
    ...cell,
    color: 'var(--text-muted)',
    fontWeight: 500,
    textTransform: 'uppercase',
    fontSize: 10,
    letterSpacing: '0.04em',
  };

  if (isLoading) {
    return (
      <div style={{ padding: '10px 14px 10px 46px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={12} width={`${70 - i * 12}%`} />)}
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: '10px 14px 10px 46px', fontSize: 12, color: 'var(--text-muted)' }}>
        Could not load this task&apos;s entries.
      </div>
    );
  }

  return (
    <div style={{ padding: '2px 14px 8px 46px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'left' }}>Assignee</th>
            <th style={{ ...head, textAlign: 'left' }}>Start</th>
            <th style={{ ...head, textAlign: 'right' }}>Duration</th>
            <th style={{ ...head, textAlign: 'left' }}>Bill</th>
            <th style={{ ...head, textAlign: 'right' }}>Rate</th>
            <th style={{ ...head, textAlign: 'right' }}>Cost</th>
            <th style={{ ...head, textAlign: 'left' }}>Status</th>
            <th style={{ ...head, textAlign: 'left', width: '30%' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const cur = e.currency ?? 'USD';
            return (
              <tr
                key={e.timeEntryId}
                onClick={() => onSelectEntry(e)}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--hover)'; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent'; }}
              >
                <td style={cell}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ClickupAvatar userId={e.userId} email={e.userEmail} name={e.userName} size={18} />
                    <span>{e.userName}</span>
                  </span>
                </td>
                <td style={{ ...cell, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt.dateTime(e.startTime)}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {fmt.duration(e.durationHours)}
                </td>
                <td style={cell}>
                  {e.billable ? <Pill tone="green" size="xs">billable</Pill> : <Pill tone="gray" size="xs">non</Pill>}
                </td>
                <td style={{ ...cell, textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {e.hourlyRateCents > 0 ? `${fmt.money(e.hourlyRateCents, cur)}/h` : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {e.status === 'COST_EXCLUDED'
                    ? <span style={{ color: 'var(--text-faint)' }}>Excluded</span>
                    : e.costAud > 0 ? fmt.money(e.costAud * 100, cur) : '—'}
                </td>
                <td style={cell}>
                  {e.status === 'COST_CALCULATED'
                    ? <Pill tone="green" size="xs" icon={<CircleCheck size={10} strokeWidth={2} />}>cost calculated</Pill>
                    : e.status === 'COST_EXCLUDED'
                      ? <Pill tone="gray" size="xs">excluded</Pill>
                      : <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} strokeWidth={2} />}>no rate found</Pill>}
                </td>
                <td
                  style={{ ...cell, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0 }}
                  title={e.description ?? ''}
                >
                  {e.description || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {total > items.length && (
        <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
          Showing the first {fmt.number(items.length)} of {fmt.number(total)} entries for this task.
        </div>
      )}
    </div>
  );
}
