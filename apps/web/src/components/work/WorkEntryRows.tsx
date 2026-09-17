import { AlertTriangle, CircleCheck } from 'lucide-react';
import { useTimeEntriesList } from '../../hooks/useReports';
import { fmt } from '../../lib/formatters';
import { toEntryListParams, type WorkParams } from '../../lib/workParams';
import { ClickupAvatar } from '../ui/ClickupAvatar';
import { Pill } from '../ui/Pill';
import { Skeleton } from '../ui/Skeleton';
import type { TimeEntryItem } from '../TimeEntryDrawer';

/**
 * One /work task's entries, shown when its row is expanded. Fetched with
 * `toEntryListParams`, so the entries listed here are exactly the ones the row's
 * Logged value counted. Selection goes through the page (one kind at a time);
 * there are no per-row buttons here on purpose — the selection bar owns edits.
 */
interface Props {
  taskId: string;
  params: WorkParams;
  selectedIds: Set<string>;
  onToggle: (entry: TimeEntryItem) => void;
  onOpen: (entry: TimeEntryItem) => void;
}

export function WorkEntryRows({ taskId, params, selectedIds, onToggle, onOpen }: Props) {
  const { data, isLoading, isError } = useTimeEntriesList(toEntryListParams(params, taskId));
  const items: TimeEntryItem[] = (data as { items?: TimeEntryItem[] } | undefined)?.items ?? [];
  const total: number = (data as { total?: number } | undefined)?.total ?? 0;

  const cell: React.CSSProperties = { padding: '5px 10px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap', fontSize: 12 };
  const head: React.CSSProperties = { ...cell, color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em' };

  if (isLoading) {
    return (
      <div style={{ padding: '10px 14px 10px 46px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={12} width={`${70 - i * 12}%`} />)}
      </div>
    );
  }
  if (isError) {
    return <div style={{ padding: '10px 14px 10px 46px', fontSize: 12, color: 'var(--text-muted)' }}>Couldn&apos;t load this task&apos;s entries. Reload the page to try again.</div>;
  }

  return (
    <div style={{ padding: '2px 14px 8px 46px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...head, width: 28 }} aria-label="Select" />
            <th style={{ ...head, textAlign: 'left' }}>Logged by</th>
            <th style={{ ...head, textAlign: 'left' }}>Start</th>
            <th style={{ ...head, textAlign: 'right' }}>Duration</th>
            <th style={{ ...head, textAlign: 'left' }}>Charge</th>
            <th style={{ ...head, textAlign: 'right' }}>Rate</th>
            <th style={{ ...head, textAlign: 'right' }}>Cost</th>
            <th style={{ ...head, textAlign: 'left' }}>Status</th>
            <th style={{ ...head, textAlign: 'left', width: '28%' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const cur = e.currency ?? 'USD';
            const checked = selectedIds.has(e.timeEntryId);
            return (
              <tr key={e.timeEntryId} onClick={() => onOpen(e)} style={{ cursor: 'pointer', background: checked ? 'var(--selected-bg)' : undefined }}>
                <td style={checked ? { ...cell, boxShadow: 'inset 3px 0 0 var(--accent)' } : cell}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${e.userName}'s entry on ${fmt.dateTime(e.startTime)}`}
                    checked={checked}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={() => onToggle(e)}
                    style={{ borderRadius: 999, cursor: 'pointer' }}
                  />
                </td>
                <td style={cell}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ClickupAvatar userId={e.userId} email={e.userEmail} name={e.userName} size={18} />
                    <span>{e.userName}</span>
                  </span>
                </td>
                <td style={{ ...cell, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt.dateTime(e.startTime)}</td>
                <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.duration(e.durationHours)}</td>
                <td style={cell}>
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    {e.chargeable ? <Pill tone="green" size="xs">chargeable</Pill> : <Pill tone="gray" size="xs">non-chargeable</Pill>}
                    {e.chargeableOverride !== null && <Pill tone="blue" size="xs">override</Pill>}
                  </span>
                </td>
                <td style={{ ...cell, textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {e.hourlyRateCents > 0 ? `${fmt.money(e.hourlyRateCents, cur)}/h` : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {e.status === 'COST_EXCLUDED' ? <span style={{ color: 'var(--text-faint)' }}>Excluded</span> : e.costAud > 0 ? fmt.money(e.costAud * 100, cur) : '—'}
                </td>
                <td style={cell}>
                  {e.status === 'COST_CALCULATED'
                    ? <Pill tone="green" size="xs" icon={<CircleCheck size={10} strokeWidth={2} />}>cost calculated</Pill>
                    : e.status === 'COST_EXCLUDED'
                      ? <Pill tone="gray" size="xs">excluded</Pill>
                      : e.status === 'NOT_CHARGEABLE'
                        ? <Pill tone="gray" size="xs">not chargeable</Pill>
                        : <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} strokeWidth={2} />}>no rate found</Pill>}
                </td>
                <td style={{ ...cell, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0 }} title={e.description ?? ''}>
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
