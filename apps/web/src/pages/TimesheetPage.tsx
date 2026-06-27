import { useMemo, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Download, AlertTriangle } from 'lucide-react';
import { useTimesheet, useTimeEntriesAssignees, type TimesheetDay } from '../hooks/useReports';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { exportTimesheetXlsx } from '../lib/timesheet-xlsx';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Switch } from '../components/ui/Switch';
import { MetricCard } from '../components/ui/MetricCard';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { fmt } from '../lib/formatters';

export function TimesheetPage() {
  const { fromDate, toDate, dateRangeLabel } = useGlobalFilters();
  const { data: assignees } = useTimeEntriesAssignees();
  const [userId, setUserId] = useState('');
  const [showCost, setShowCost] = useState(true);

  const assigneeOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Select an assignee…' }];
    for (const a of assignees ?? []) {
      if (!a.id) continue;
      opts.push({ value: a.id, label: a.name ?? a.id });
    }
    return opts;
  }, [assignees]);

  const assigneeName = useMemo(
    () => assignees?.find((a) => a.id === userId)?.name ?? userId,
    [assignees, userId],
  );

  const query = useTimesheet({ userId, from: fromDate || undefined, to: toDate || undefined });
  const sheet = query.data;

  const exportExcel = useMutation({
    mutationFn: async () => {
      if (!sheet) return;
      await exportTimesheetXlsx({ assigneeName: sheet.userName ?? assigneeName ?? 'assignee', sheet, includeCost: showCost });
    },
  });

  const cost = (v: number | null): ReactNode =>
    v == null ? <span style={{ color: 'var(--text-faint)' }}>—</span> : fmt.money(v * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Timesheet"
        description="Per-day, per-task tracked time for one assignee."
        actions={
          <Button
            size="md"
            variant="subtle"
            icon={<Download size={13} strokeWidth={1.75} />}
            loading={exportExcel.isPending}
            disabled={!sheet || !sheet.days.length || exportExcel.isPending}
            onClick={() => exportExcel.mutate()}
          >
            Export Excel
          </Button>
        }
      />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}>
        <Select ariaLabel="Select assignee" size="md" options={assigneeOptions} value={userId} onChange={setUserId} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Range: {dateRangeLabel}</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Switch ariaLabel="Show cost column" checked={showCost} onChange={setShowCost} />
          <span>Show cost</span>
        </label>
      </div>

      {!userId ? (
        <EmptyState
          icon={<CalendarClock size={20} strokeWidth={1.75} />}
          title="Select an assignee"
          body="Choose an assignee to see their daily tracked-time breakdown. Use the date range in the top bar to change the window."
        />
      ) : (
        <>
          <QueryError query={query} what="timesheet" />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <MetricCard dense label="Total hours" value={fmt.hours(sheet?.totalHours ?? 0)} />
            {showCost && (
              <MetricCard dense label="Total cost" value={sheet?.totalCostAud == null ? '—' : fmt.money((sheet.totalCostAud) * 100)} />
            )}
            {!!sheet?.missingRateCount && (
              <MetricCard
                dense
                label="Missing rates"
                value={fmt.number(sheet.missingRateCount)}
                sublabel="entries without a rate"
                icon={<AlertTriangle size={13} strokeWidth={1.75} />}
              />
            )}
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', background: 'var(--muted-bg)' }}>
                  <th style={{ padding: '8px 12px', width: 200 }}>Date</th>
                  <th style={{ padding: '8px 12px' }}>Task</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', width: 100 }}>Hours</th>
                  {showCost && <th style={{ padding: '8px 12px', textAlign: 'right', width: 120 }}>Cost</th>}
                </tr>
              </thead>
              <tbody>
                {(sheet?.days ?? []).map((day: TimesheetDay) => (
                  <DayRows key={day.date} day={day} showCost={showCost} renderCost={cost} />
                ))}
                {sheet && (
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px' }}>Total</td>
                    <td />
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(sheet.totalHours)}</td>
                    {showCost && <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cost(sheet.totalCostAud)}</td>}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function DayRows({
  day,
  showCost,
  renderCost,
}: {
  day: TimesheetDay;
  showCost: boolean;
  renderCost: (v: number | null) => ReactNode;
}) {
  const muted = day.isWeekend;
  return (
    <>
      <tr style={{ background: muted ? 'var(--muted-bg)' : 'var(--hover-bg, var(--muted-bg))', borderTop: '1px solid var(--border)' }}>
        <td style={{ padding: '8px 12px', fontWeight: 600, color: muted ? 'var(--text-muted)' : 'var(--text)' }}>
          {day.date} · {day.weekday}
          {day.missingRateCount > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--pill-amber-text, var(--text-muted))' }}>
              {day.missingRateCount} missing rate
            </span>
          )}
        </td>
        <td style={{ padding: '8px 12px', color: 'var(--text-faint)' }}>{day.tasks.length ? '' : 'No time logged'}</td>
        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(day.subtotalHours)}</td>
        {showCost && <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{renderCost(day.subtotalCostAud)}</td>}
      </tr>
      {day.tasks.map((t) => (
        <tr key={t.taskId} style={{ borderTop: '1px solid var(--border)' }}>
          <td />
          <td style={{ padding: '6px 12px', paddingLeft: 24 }}>{t.taskName ?? t.taskId}</td>
          <td style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(t.hours)}</td>
          {showCost && <td style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{renderCost(t.costAud)}</td>}
        </tr>
      ))}
    </>
  );
}
