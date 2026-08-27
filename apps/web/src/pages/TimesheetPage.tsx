import { useMemo, useState, useCallback, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Download, AlertTriangle, Clock3, ChevronDown, ChevronRight } from 'lucide-react';
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
import { ClickupAvatar } from '../components/ui/ClickupAvatar';
import { Pill } from '../components/ui/Pill';
import { Skeleton } from '../components/ui/Skeleton';
import { fmt } from '../lib/formatters';

// The ledger's date column. Kept in one place so the day-header date block and
// the task-row indent line up to the same grid.
const DATE_COL = 56;
// Dhaka is a fixed UTC+6 offset (no DST), so this literal is always correct for
// turning a Dhaka calendar day into the instant window the Time Entries deep
// link expects.
const DHAKA_OFFSET = '+06:00';

// Scoped interaction + motion CSS. Inlined so the page is self-contained; every
// hook into the theme uses tokens, and motion is disabled under reduced-motion.
const STYLE = `
.ts-day { animation: ts-rise 280ms cubic-bezier(0.16,1,0.3,1) both; }
.ts-task { transition: background 100ms; cursor: pointer; }
.ts-task:hover { background: var(--hover); }
.ts-task:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.ts-go { opacity: 0; transition: opacity 100ms; color: var(--text-faint); display: flex; }
.ts-task:hover .ts-go, .ts-task:focus-visible .ts-go { opacity: 1; }
.ts-week { width: 100%; text-align: left; border: 0; background: var(--surface-alt); cursor: pointer; transition: background 100ms; }
.ts-week:hover { background: var(--muted-bg); }
.ts-week:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.ts-bar-fill { transition: width 420ms cubic-bezier(0.16,1,0.3,1); }
@keyframes ts-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .ts-day { animation: none; }
  .ts-bar-fill { transition: none; }
}
`;

// 'Jun 22' from a 'YYYY-MM-DD' Dhaka calendar date. Formatted in UTC so the
// already-bucketed date string never shifts under the viewer's local zone.
function monthDay(date: string): { mon: string; day: string } {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    mon: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d),
    day: String(d.getUTCDate()),
  };
}

// Monday ('YYYY-MM-DD') of the ISO week containing `date`.
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const diff = (d.getUTCDay() + 6) % 7; // days since Monday (Sun=0 → 6)
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function weekLabel(mondayIso: string): string {
  const start = new Date(`${mondayIso}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const f = (d: Date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  return `${f(start)} – ${f(end)}`;
}

interface Week {
  key: string;
  label: string;
  days: TimesheetDay[];
  hours: number;
  cost: number | null;
  missingRateCount: number;
}

// Group the flat day list into Monday-start weeks with subtotals. Week cost is
// null only when no day that week had a valid-cost entry — same rule the backend
// applies per task/day/total, so a missing rate never reads as a real $0.
function groupWeeks(days: TimesheetDay[]): Week[] {
  const map = new Map<string, TimesheetDay[]>();
  for (const d of days) {
    const k = mondayOf(d.date);
    const list = map.get(k);
    if (list) list.push(d);
    else map.set(k, [d]);
  }
  return [...map.keys()].sort().map((k) => {
    const wdays = map.get(k)!;
    const hasValidCost = wdays.some((d) => d.subtotalCostAud != null);
    return {
      key: k,
      label: weekLabel(k),
      days: wdays,
      hours: wdays.reduce((s, d) => s + d.subtotalHours, 0),
      cost: hasValidCost ? wdays.reduce((s, d) => s + (d.subtotalCostAud ?? 0), 0) : null,
      missingRateCount: wdays.reduce((s, d) => s + d.missingRateCount, 0),
    };
  });
}

export function TimesheetPage() {
  const navigate = useNavigate();
  const { fromDate, toDate, dateRangeLabel } = useGlobalFilters();
  const { data: assignees } = useTimeEntriesAssignees();
  const [userId, setUserId] = useState('');
  const [showCost, setShowCost] = useState(true);

  const assigneeOptions = useMemo(() => {
    const opts: { value: string; label: string; icon?: ReactNode }[] = [];
    for (const a of assignees ?? []) {
      if (!a.id) continue;
      opts.push({
        value: a.id,
        label: a.name ?? a.id,
        icon: <ClickupAvatar userId={a.id} email={a.email} name={a.name} size={18} />,
      });
    }
    return opts;
  }, [assignees]);

  const selected = useMemo(
    () => assignees?.find((a) => a.id === userId) ?? null,
    [assignees, userId],
  );
  const assigneeName = selected?.name ?? userId;

  const query = useTimesheet({ userId, from: fromDate || undefined, to: toDate || undefined });
  const sheet = query.data;
  const loading = query.isLoading && !!userId;

  const exportExcel = useMutation({
    mutationFn: async () => {
      if (!sheet) return;
      await exportTimesheetXlsx({ assigneeName: sheet.userName ?? assigneeName ?? 'assignee', sheet, includeCost: showCost });
    },
  });

  // Open the underlying time entries for a Dhaka day (optionally one task) by
  // deep-linking into the Time Entries page — it already renders entry-level
  // detail (start, duration, description, chargeable) and a drawer.
  const openEntries = useCallback((date: string, taskLabel?: string | null) => {
    const start = new Date(`${date}T00:00:00${DHAKA_OFFSET}`);
    const end = new Date(start.getTime() + 86_400_000 - 1);
    // The timesheet is cross-space, so bypass any active top-bar space filter on
    // the Time Entries page (spaceScope=all) to show every entry for that day.
    const params = new URLSearchParams({ userId, from: start.toISOString(), to: end.toISOString(), spaceScope: 'all' });
    if (taskLabel) params.set('search', taskLabel);
    navigate(`/time-entries?${params.toString()}`);
  }, [navigate, userId]);

  const weeks = useMemo(() => groupWeeks(sheet?.days ?? []), [sheet]);
  // Busiest day in the window — the denominator for the per-day effort bars.
  const maxDayHours = useMemo(
    () => (sheet?.days ?? []).reduce((m, d) => Math.max(m, d.subtotalHours), 0),
    [sheet],
  );
  const daysLogged = useMemo(
    () => (sheet?.days ?? []).filter((d) => d.subtotalHours > 0).length,
    [sheet],
  );
  const avgPerLoggedDay = daysLogged > 0 ? (sheet?.totalHours ?? 0) / daysLogged : 0;
  const hasNoTime = !!sheet && sheet.totalHours === 0;

  const money = (v: number | null): ReactNode =>
    v == null
      ? <span style={{ color: 'var(--text-faint)' }}>—</span>
      : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt.money(v * 100)}</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{STYLE}</style>

      <PageHeader
        title="Timesheet"
        description="A day-by-day breakdown of one teammate's tracked time."
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

      {/* Toolbar: who + window + cost visibility */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}>
        <Select ariaLabel="Select teammate" size="md" searchable placeholder="Select a teammate…" searchPlaceholder="Search teammates…" options={assigneeOptions} value={userId} onChange={setUserId} />
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
          color: 'var(--text-muted)', padding: '4px 8px', background: 'var(--muted-bg)', borderRadius: 6,
        }}>
          <CalendarClock size={13} strokeWidth={1.75} />
          {dateRangeLabel}
        </span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
          <Switch ariaLabel="Show cost column" checked={showCost} onChange={setShowCost} />
          <span>Show cost</span>
        </label>
      </div>

      {!userId ? (
        <EmptyState
          icon={<CalendarClock size={22} strokeWidth={1.75} />}
          title="Pick a teammate to begin"
          body="Choose someone to see their day-by-day tracked time. Set the window with the date range in the top bar."
        />
      ) : (
        <>
          <QueryError query={query} what="timesheet" />

          {/* Identity strip — who you're looking at, and the window */}
          <div className="card-3d" style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          }}>
            <ClickupAvatar userId={selected?.id} email={selected?.email} name={assigneeName} size={40} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>{assigneeName}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {dateRangeLabel}{selected?.email ? ` · ${selected.email}` : ''}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <MetricCard dense label="Total hours" value={fmt.hours(sheet?.totalHours ?? 0)} loading={loading} icon={<Clock3 size={13} strokeWidth={1.75} />} />
            <MetricCard dense label="Days logged" value={fmt.number(daysLogged)} sublabel={loading ? undefined : `${fmt.hours(avgPerLoggedDay)}/day avg`} loading={loading} />
            {showCost && (
              <MetricCard dense label="Total cost" value={sheet?.totalCostAud == null ? '—' : fmt.money(sheet.totalCostAud * 100)} loading={loading} />
            )}
            {!!sheet?.missingRateCount && (
              <MetricCard dense label="Missing rates" value={fmt.number(sheet.missingRateCount)} sublabel="no rate set" icon={<AlertTriangle size={13} strokeWidth={1.75} />} />
            )}
          </div>

          {loading ? (
            <LedgerSkeleton showCost={showCost} />
          ) : (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              {/* Column header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px',
                background: 'var(--table-head-bg)', borderBottom: '1px solid var(--border)',
                fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                <span style={{ width: DATE_COL }}>Day</span>
                <span style={{ flex: 1 }}>Tasks</span>
                <span style={{ width: 80, textAlign: 'right' }}>Hours</span>
                {showCost && <span style={{ width: 96, textAlign: 'right' }}>Cost</span>}
              </div>

              {hasNoTime ? (
                <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                  No tracked time for {assigneeName} in this window. Try widening the date range in the top bar.
                </div>
              ) : (
                weeks.map((week) => (
                  <WeekGroup
                    key={week.key}
                    week={week}
                    showCost={showCost}
                    maxHours={maxDayHours}
                    renderMoney={money}
                    onOpenEntries={openEntries}
                  />
                ))
              )}

              {/* Grand total */}
              {sheet && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  borderTop: '2px solid var(--border-strong)', background: 'var(--surface-alt)',
                }}>
                  <span style={{ width: DATE_COL, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ width: 80, textAlign: 'right', fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{fmt.hours(sheet.totalHours)}</span>
                  {showCost && <span style={{ width: 96, textAlign: 'right', fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{money(sheet.totalCostAud)}</span>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WeekGroup({
  week,
  showCost,
  maxHours,
  renderMoney,
  onOpenEntries,
}: {
  week: Week;
  showCost: boolean;
  maxHours: number;
  renderMoney: (v: number | null) => ReactNode;
  onOpenEntries: (date: string, taskLabel?: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button
        type="button"
        className="ts-week"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px' }}
      >
        <Chevron size={15} strokeWidth={2} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em' }}>{week.label}</span>
        {week.missingRateCount > 0 && (
          <Pill tone="amber" size="xs" icon={<AlertTriangle size={9} strokeWidth={2.25} />}>{week.missingRateCount} no rate</Pill>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ width: 80, textAlign: 'right', fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(week.hours)}</span>
        {showCost && <span style={{ width: 96, textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{renderMoney(week.cost)}</span>}
      </button>

      {!collapsed && week.days.map((day) => (
        <DayGroup key={day.date} day={day} showCost={showCost} maxHours={maxHours} renderMoney={renderMoney} onOpenEntries={onOpenEntries} />
      ))}
    </div>
  );
}

function DayGroup({
  day,
  showCost,
  maxHours,
  renderMoney,
  onOpenEntries,
}: {
  day: TimesheetDay;
  showCost: boolean;
  maxHours: number;
  renderMoney: (v: number | null) => ReactNode;
  onOpenEntries: (date: string, taskLabel?: string | null) => void;
}) {
  const { mon, day: dayNum } = monthDay(day.date);
  const empty = day.tasks.length === 0;
  const pct = maxHours > 0 ? Math.round((day.subtotalHours / maxHours) * 100) : 0;
  // Weekends and empty days recede; worked weekdays carry the accent bar.
  const barColor = day.isWeekend ? 'var(--text-faint)' : 'var(--accent)';

  return (
    <div className="ts-day" style={{ borderTop: '1px solid var(--border-soft)' }}>
      {/* Day header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        background: empty ? 'transparent' : 'var(--surface)',
      }}>
        {/* Date block */}
        <div style={{ width: DATE_COL, display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: empty ? 'var(--text-faint)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{dayNum}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>{mon}</span>
        </div>

        {/* Weekday + effort bar */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: empty ? 'var(--text-muted)' : 'var(--text)' }}>{day.weekday}</span>
            {day.isWeekend && <Pill tone="gray" size="xs">weekend</Pill>}
            {day.missingRateCount > 0 && (
              <Pill tone="amber" size="xs" icon={<AlertTriangle size={9} strokeWidth={2.25} />}>
                {day.missingRateCount} no rate
              </Pill>
            )}
            {empty && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No time logged</span>}
          </div>
          {!empty && (
            <div aria-hidden style={{ height: 5, width: '100%', maxWidth: 360, background: 'var(--muted-bg)', borderRadius: 999, overflow: 'hidden' }}>
              <div className="ts-bar-fill" style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 999 }} />
            </div>
          )}
        </div>

        {/* Subtotals */}
        <span style={{ width: 80, textAlign: 'right', fontSize: 14, fontWeight: 700, color: empty ? 'var(--text-faint)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {empty ? '—' : fmt.hours(day.subtotalHours)}
        </span>
        {showCost && (
          <span style={{ width: 96, textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {empty ? <span style={{ color: 'var(--text-faint)' }}>—</span> : renderMoney(day.subtotalCostAud)}
          </span>
        )}
      </div>

      {/* Task rows — click to open the underlying entries */}
      {day.tasks.map((t) => {
        const label = t.taskName ?? t.taskId;
        return (
          <div
            key={t.taskId}
            className="ts-task"
            role="button"
            tabIndex={0}
            aria-label={`View time entries for ${label} on ${day.weekday} ${mon} ${dayNum}`}
            onClick={() => onOpenEntries(day.date, label)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenEntries(day.date, label); } }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 16px' }}
          >
            <span style={{ width: DATE_COL }} />
            <span style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
              paddingLeft: 14, borderLeft: '2px solid var(--border)',
            }}>
              <span title={label} style={{
                fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {label}
              </span>
              {t.costAud == null && (
                <span title="No rate set for this teammate on this date" style={{ flexShrink: 0 }}>
                  <Pill tone="amber" size="xs">no rate</Pill>
                </span>
              )}
              <span className="ts-go" aria-hidden style={{ flexShrink: 0 }}><ChevronRight size={13} strokeWidth={2} /></span>
            </span>
            <span style={{ width: 80, textAlign: 'right', fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(t.hours)}</span>
            {showCost && (
              <span style={{ width: 96, textAlign: 'right', fontSize: 13, color: 'var(--text-muted)' }}>{renderMoney(t.costAud)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LedgerSkeleton({ showCost }: { showCost: boolean }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? '1px solid var(--border-soft)' : undefined }}>
          <div style={{ width: DATE_COL, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Skeleton width={22} height={16} />
            <Skeleton width={20} height={8} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Skeleton width={72} height={11} />
            <Skeleton width={`${40 + ((i * 13) % 45)}%`} height={5} radius="999px" />
          </div>
          <Skeleton width={44} height={13} />
          {showCost && <Skeleton width={56} height={13} />}
        </div>
      ))}
    </div>
  );
}
