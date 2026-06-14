import { useNavigate } from 'react-router-dom';
import {
  CheckSquare, Inbox, CircleCheck, Clock, DollarSign, AlertTriangle,
  Activity, RefreshCw, Download, ChevronRight, CircleX, TrendingUp,
} from 'lucide-react';
import {
  useStats,
  useTasksSummary,
  useTimeEntriesByUser,
  useWebhookEvents,
  useSyncHealth,
  useOverviewDeltas,
} from '../hooks/useReports';
import { useBudgetStatus } from '../hooks/useBudgets';
import type { BudgetStatusRow } from '../api/budgets';
import { MetricCard } from '../components/ui/MetricCard';
import { Delta } from '../components/ui/Delta';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { AnomaliesPanel } from '../components/AnomaliesPanel';
import { fmt } from '../lib/formatters';
import { toCsv, downloadCsv, csvFilename } from '../lib/csv';
import { onActivate } from '../lib/a11y';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { useQueryClient } from '@tanstack/react-query';

// Backend returns dollars; fmt.money expects cents. USD is the project currency
// (default in fmt.money), so no need to pass it explicitly.
function moneyAud(dollars: number) {
  return fmt.money(Math.round(dollars * 100));
}

// HealthIndicator matches the design's inline component. When `onClick` is
// provided it renders as a button (a way to act on the metric, e.g. jump to the
// dead-letter queue) with a chevron affordance.
function HealthIndicator({ status, label, value, onClick }: { status: 'healthy' | 'warning' | 'error'; label: string; value: string; onClick?: () => void }) {
  const color = status === 'healthy' ? 'var(--green)' : status === 'warning' ? 'var(--amber)' : 'var(--red)';
  const bg = status === 'healthy' ? 'var(--pill-green-bg)' : status === 'warning' ? 'var(--pill-amber-bg)' : 'var(--pill-red-bg)';
  const inner = (
    <>
      <span style={{
        width: 8, height: 8, borderRadius: 999, background: color,
        boxShadow: `0 0 0 3px ${bg}`,
        animation: status === 'healthy' ? 'pulse 2s infinite' : 'none',
        flexShrink: 0,
      }} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      </div>
      {onClick && <ChevronRight size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />}
    </>
  );
  const base: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--muted-bg)' };
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{ ...base, width: '100%', textAlign: 'left', border: '1px solid var(--border)', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--muted-bg)')}
      >
        {inner}
      </button>
    );
  }
  return <div style={base}>{inner}</div>;
}

type UserTimeRow    = { userName: string; totalHours: number; totalCostAud: number };
type WebhookRow     = { id: string; eventType: string; taskId: string | null; status: string; receivedAt: string };
type Stats          = {
  failedJobsLast24h: number;
  deadLetterPending: number;
  webhooksLast24h: number;
  missingRateEntries: number;
};
type TasksSummary   = {
  byStatusType: { statusType: string | null; count: number }[];
  total: number;
};

function BudgetAlertCard() {
  const navigate = useNavigate();
  const budgetStatus = useBudgetStatus();
  const rows = (budgetStatus.data ?? []) as BudgetStatusRow[];

  const flagged = rows
    .filter((r) => r.status === 'over' || r.status === 'projected-over')
    .sort((a, b) => {
      // Sort by pctOfBudget desc, nulls last
      if (a.pctOfBudget == null && b.pctOfBudget == null) return 0;
      if (a.pctOfBudget == null) return 1;
      if (b.pctOfBudget == null) return -1;
      return b.pctOfBudget - a.pctOfBudget;
    });

  const top3 = flagged.slice(0, 3);

  const headlineValue = budgetStatus.isLoading ? '—' : `${flagged.length}`;
  const headlineLabel = flagged.length === 1 ? 'client over / projected over budget' : 'clients over / projected over budget';

  return (
    <Card
      padding={0}
      title="Budget alerts"
      subtitle="Clients over or projected over their monthly budget"
      action={
        flagged.length > 0
          ? <Pill tone="red">{flagged.length}</Pill>
          : undefined
      }
    >
      {budgetStatus.isLoading ? (
        <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : budgetStatus.isError ? (
        <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--red)' }}>
          Could not load budget status.
        </div>
      ) : flagged.length === 0 ? (
        <div style={{ padding: '20px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
            background: 'var(--pill-green-bg)', color: 'var(--pill-green-text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CircleCheck size={15} strokeWidth={2} />
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>All clients within budget</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No clients are over or projected over budget this month.</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Headline count */}
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border-soft)' }}>
            <span style={{
              width: 28, height: 28, borderRadius: 7, flexShrink: 0,
              background: 'var(--pill-red-bg)', color: 'var(--pill-red-text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <TrendingUp size={14} strokeWidth={1.75} />
            </span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
                {headlineValue}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{headlineLabel}</div>
            </div>
          </div>
          {/* Top 3 flagged clients */}
          {top3.map((r, i) => {
            const pct = r.pctOfBudget != null ? (r.pctOfBudget * 100).toFixed(1) : '—';
            const isOver = r.status === 'over';
            return (
              <button
                key={r.client}
                onClick={() => navigate('/budgets')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 16px',
                  borderBottom: i < top3.length - 1 ? '1px solid var(--border-soft)' : 0,
                  background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit',
                }}
                onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--hover)'}
                onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                  background: isOver ? 'var(--pill-red-bg)' : 'var(--pill-amber-bg)',
                  color: isOver ? 'var(--pill-red-text)' : 'var(--pill-amber-text)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <AlertTriangle size={13} strokeWidth={1.75} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.client}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    <Pill tone={isOver ? 'red' : 'amber'}>{isOver ? 'over' : 'projected over'}</Pill>
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: isOver ? 'var(--red)' : 'var(--amber)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {pct}% used
                </span>
                <ChevronRight size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function OverviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // `dateRangeLabel` mirrors the topbar selection ("last 24h", "last 30d", or
  // a custom-range pair). The time/cost cards' sublabels used to hardcode
  // "last 30d" regardless of what the user picked — values were correct but
  // the label lied. This drives them from the source of truth.
  const { dateRangeLabel, dateRange, customFrom, customTo } = useGlobalFilters();

  const deltasQ = useOverviewDeltas();
  const deltas = deltasQ.data;

  const stats          = useStats();
  const tasksSummary   = useTasksSummary();
  const timeByUser     = useTimeEntriesByUser();
  const webhookEvents  = useWebhookEvents({ limit: 7 });
  const syncHealth     = useSyncHealth();

  const sd      = stats.data as Stats | undefined;
  const summary = tasksSummary.data as TasksSummary | undefined;

  // ── KPI derivations ──────────────────────────────────────────────────────────
  // Open/closed use `status_type` (ClickUp's stable open/custom/done/closed
  // classification), not the per-list `status` string. The old `.toLowerCase()
  // === 'open' | 'closed'` check matched zero of the real values in this
  // workspace ('to do', 'Open', 'Closed', 'done', 'review', 'in progress', …)
  // so both counts were wrong.
  const totalTasks  = summary?.total ?? 0;
  const byStatusType = summary?.byStatusType ?? [];
  const closedTasks = byStatusType
    .filter((r) => r.statusType === 'closed' || r.statusType === 'done')
    .reduce((s, r) => s + r.count, 0);
  const openTasks = totalTasks - closedTasks;

  const userRows = (timeByUser.data as UserTimeRow[] | undefined) ?? [];
  const totalHours = userRows.reduce((s, r) => s + r.totalHours, 0);
  const totalCost  = userRows.reduce((s, r) => s + r.totalCostAud, 0);

  // Short range label for delta pills — derived from the topbar's dateRange.
  // For custom ranges, compute day count from the actual window.
  const rangeShort = (() => {
    if (dateRange === '24h')  return '24h';
    if (dateRange === '7d')   return '7d';
    if (dateRange === '30d')  return '30d';
    if (dateRange === '90d')  return '90d';
    if (dateRange === 'custom' && customFrom && customTo) {
      const days = Math.max(1, Math.round((new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400000));
      return `${days}d`;
    }
    return 'period';
  })();

  const missingRates  = sd?.missingRateEntries ?? 0;
  const failedJobs    = sd?.failedJobsLast24h ?? 0;
  const deadLetters   = sd?.deadLetterPending ?? 0;
  const webhooks24h   = sd?.webhooksLast24h ?? 0;

  // Sync health. Defensively coerce: if the API returns an error envelope /
  // HTML / unexpected shape, `syncHealth.data` may be a non-array truthy value
  // (and `?? []` only catches nullish), so `.every` would crash the whole page.
  // Same pattern as TopBar after 7f4b21f.
  const healthItems: { status: string; lastSuccessfulSyncAt?: string | null }[] =
    Array.isArray(syncHealth.data) ? syncHealth.data : [];
  const lastSyncAt  = healthItems[0]?.lastSuccessfulSyncAt ?? null;
  const allHealthy  = healthItems.length > 0 && healthItems.every((h) => h.status === 'Fresh');

  // Webhook events
  const webhookItems = (webhookEvents.data?.items ?? []) as WebhookRow[];
  const latestEvent  = webhookItems[0]?.eventType ?? '—';

  // Alerts
  const alerts = [
    missingRates > 0 && {
      tone: 'amber' as const,
      icon: <AlertTriangle size={13} />,
      title: `${missingRates} time entries missing rates`,
      body: "Can't be costed until rates are assigned",
      action: 'Review queue',
      target: '/missing-rates',
    },
    failedJobs > 0 && {
      tone: 'red' as const,
      icon: <CircleX size={13} />,
      title: `${failedJobs} failed jobs (24h)`,
      body: 'Check queue logs for details',
      action: 'Open sync logs',
      target: '/sync-logs?tab=runs&status=failed',
    },
    deadLetters > 0 && {
      tone: 'amber' as const,
      icon: <Clock size={13} />,
      title: `${deadLetters} dead-letter jobs pending`,
      body: 'Unrecoverable jobs that need review',
      action: 'Review',
      target: '/sync-logs?tab=dead-letters',
    },
  ].filter(Boolean) as { tone: 'amber' | 'red'; icon: React.ReactNode; title: string; body: string; action: string; target: string }[];

  // Export a human-readable snapshot of the dashboard KPIs as CSV. The page has
  // no single tabular dataset, so we flatten the headline metrics into
  // Metric,Value rows — enough to drop into a status report or spreadsheet.
  function handleExport() {
    // Guard against a non-ISO/invalid timestamp so the whole export can't throw.
    const lastSyncDate = lastSyncAt ? new Date(lastSyncAt) : null;
    const lastSyncIso = lastSyncDate && !Number.isNaN(lastSyncDate.getTime())
      ? lastSyncDate.toISOString()
      : '—';
    const rows = [
      { metric: 'Total tasks', value: totalTasks },
      { metric: 'Open tasks', value: openTasks },
      { metric: 'Closed tasks', value: closedTasks },
      { metric: `Time tracked (${dateRangeLabel})`, value: fmt.hours(totalHours) },
      { metric: `Calculated cost (${dateRangeLabel})`, value: moneyAud(totalCost) },
      { metric: 'Missing rates', value: missingRates },
      { metric: 'Webhooks (24h)', value: webhooks24h },
      { metric: 'Failed jobs (24h)', value: failedJobs },
      { metric: 'Dead-letter pending', value: deadLetters },
      { metric: 'Last successful sync', value: lastSyncIso },
    ];
    downloadCsv(
      csvFilename('overview-summary'),
      toCsv(rows, [
        { header: 'Metric', value: 'metric' },
        { header: 'Value', value: 'value' },
      ]),
    );
  }

  // Refetch the dashboard's queries in place instead of a full document reload —
  // keeps scroll position, theme, and avoids re-downloading the bundle.
  function handleRefresh() {
    void queryClient.invalidateQueries();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      <PageHeader
        title="Overview"
        description="System health, sync activity, and operational metrics for your ClickUp pipeline."
        actions={
          <>
            <Button variant="default" icon={<RefreshCw size={13} strokeWidth={1.75} />}
              onClick={handleRefresh}>Refresh</Button>
            <Button variant="accent" icon={<Download size={13} strokeWidth={1.75} />}
              onClick={handleExport}>Export</Button>
          </>
        }
      />

      {/* Surfaces the first failing dashboard query — otherwise the KPI cards
          all dash-render and look identical to "no data yet". */}
      <QueryError
        queries={[stats, tasksSummary, timeByUser, webhookEvents, syncHealth]}
        what="dashboard data"
      />

      {/* KPI Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <MetricCard
          accent
          label="Total tasks"
          value={tasksSummary.isLoading ? '—' : fmt.number(totalTasks)}
          sublabel="all spaces"
          icon={<CheckSquare size={14} strokeWidth={1.75} />}
          onClick={() => navigate('/tasks')}
        />
        <MetricCard
          label="Open"
          value={tasksSummary.isLoading ? '—' : fmt.number(openTasks)}
          sublabel={totalTasks ? `${Math.round(openTasks / totalTasks * 100)}%` : undefined}
          delta={openTasks > closedTasks ? `${openTasks - closedTasks} more open than closed` : undefined}
          icon={<Inbox size={14} strokeWidth={1.75} />}
          onClick={() => navigate('/tasks')}
        />
        <MetricCard
          label="Closed"
          value={tasksSummary.isLoading ? '—' : fmt.number(closedTasks)}
          sublabel={totalTasks ? `${Math.round(closedTasks / totalTasks * 100)}%` : undefined}
          icon={<CircleCheck size={14} strokeWidth={1.75} />}
        />
        <MetricCard
          label="Time tracked"
          value={timeByUser.isLoading ? '—' : fmt.hours(totalHours)}
          sublabel={dateRangeLabel}
          delta={deltas && <Delta current={deltas.current.totalHours} prior={deltas.prior.totalHours} rangeLabel={rangeShort} />}
          icon={<Clock size={14} strokeWidth={1.75} />}
          onClick={() => navigate('/time-entries')}
        />
        <MetricCard
          label="Calculated cost"
          value={timeByUser.isLoading ? '—' : moneyAud(totalCost)}
          sublabel={dateRangeLabel}
          delta={deltas && <Delta current={deltas.current.totalCostAud} prior={deltas.prior.totalCostAud} rangeLabel={rangeShort} />}
          icon={<DollarSign size={14} strokeWidth={1.75} />}
        />
        <MetricCard
          label="Missing rates"
          value={stats.isLoading ? '—' : fmt.number(missingRates)}
          sublabel={missingRates > 0 ? 'needs review' : undefined}
          delta={missingRates > 0 ? 'needs review' : undefined}
          deltaTone={missingRates > 0 ? 'down' : undefined}
          icon={<AlertTriangle size={14} strokeWidth={1.75} />}
          onClick={() => navigate('/missing-rates')}
        />
      </div>

      {/* Budget alerts */}
      <BudgetAlertCard />

      {/* Sync Health */}
      <Card padding={0}>
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'var(--pill-green-bg)', color: 'var(--pill-green-text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Activity size={14} strokeWidth={1.75} />
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Sync health</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Webhook ingestion, dedupe, and processing</div>
            </div>
          </div>
          <Pill
            tone={allHealthy ? 'green' : 'amber'}
            icon={<CircleCheck size={11} strokeWidth={2} />}
          >
            {allHealthy ? 'All systems operational' : 'Degraded'}
          </Pill>
        </div>
        <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <HealthIndicator status="healthy" label="Webhook endpoint" value="/webhooks/clickup" />
          <HealthIndicator status={latestEvent !== '—' ? 'healthy' : 'warning'} label="Latest event" value={latestEvent} />
          <HealthIndicator status="healthy" label="Successful events (24h)" value={`${webhooks24h} processed`} />
          <HealthIndicator
            status={deadLetters > 0 ? 'warning' : 'healthy'}
            label="Dead letters"
            value={deadLetters > 0 ? `${deadLetters} pending` : 'none'}
            onClick={() => navigate('/sync-logs?tab=dead-letters')}
          />
          <HealthIndicator
            status={failedJobs > 0 ? 'error' : 'healthy'}
            label="Failed jobs (24h)"
            value={failedJobs > 0 ? `${failedJobs} need retry` : 'none'}
            onClick={() => navigate('/sync-logs?tab=runs&status=failed')}
          />
          <HealthIndicator status={lastSyncAt ? 'healthy' : 'warning'} label="Last task update" value={lastSyncAt ? fmt.relative(lastSyncAt) : '—'} />
        </div>
      </Card>


      {/* Activity + Alerts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 12 }}>
        {/* Recent webhook events */}
        <Card
          padding={0}
          title="Recent webhook activity"
          subtitle="Latest events processed by the sync pipeline"
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate('/sync-logs')}>
              View all
            </Button>
          }
        >
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                {['Event', 'Task ID', 'Status', 'When'].map(h => (
                  <th key={h} style={{
                    padding: '8px 14px', textAlign: h === 'When' ? 'right' : 'left',
                    fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--muted-bg)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {webhookItems.length === 0 ? (
                <tr><td colSpan={4}>
                  <EmptyState
                    icon={<Activity size={20} />}
                    title="No recent events"
                    body="Webhook activity from ClickUp will show up here."
                  />
                </td></tr>
              ) : webhookItems.map((e) => {
                const tone = e.eventType === 'taskCreated' ? 'green'
                  : e.eventType === 'taskDeleted' ? 'red'
                  : e.eventType === 'taskTimeTrackedUpdated' ? 'purple' : 'blue';
                const sTone = e.status === 'processed' || e.status === 'success' ? 'green'
                  : e.status === 'failed' ? 'red'
                  : e.status === 'skipped' ? 'amber' : 'blue';
                return (
                  <tr
                    key={e.id}
                    onClick={() => navigate('/sync-logs')}
                    tabIndex={0}
                    onKeyDown={onActivate(() => navigate('/sync-logs'))}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-soft)' }}
                    onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'var(--hover)'}
                    onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)' }}>
                      <Pill tone={tone as 'green' | 'blue' | 'red' | 'purple'}>{e.eventType}</Pill>
                    </td>
                    <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                      {e.taskId ?? '—'}
                    </td>
                    <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)' }}>
                      <Pill tone={sTone as 'green' | 'red' | 'amber' | 'blue'}>{e.status}</Pill>
                    </td>
                    <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)', textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt.relative(e.receivedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {/* Alerts */}
          <Card
            padding={0}
            title="Alerts"
            subtitle="Items needing operator attention"
            action={alerts.length > 0 ? <Pill tone="amber">{alerts.length}</Pill> : undefined}
          >
            {alerts.length === 0 ? (
              <div style={{ padding: '20px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                  background: 'var(--pill-green-bg)', color: 'var(--pill-green-text)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CircleCheck size={15} strokeWidth={2} />
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>All clear</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No items need attention right now.</div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {alerts.map((a, i) => (
                  <button
                    key={i}
                    onClick={() => navigate(a.target)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '12px 16px',
                      borderBottom: i < alerts.length - 1 ? '1px solid var(--border-soft)' : 0,
                      background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <span style={{
                      width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                      background: `var(--pill-${a.tone}-bg)`, color: `var(--pill-${a.tone}-text)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{a.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{a.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.body}</div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      {a.action} <ChevronRight size={12} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>
          <AnomaliesPanel />
        </div>
      </div>
    </div>
  );
}
