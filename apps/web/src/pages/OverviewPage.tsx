import { useNavigate } from 'react-router-dom';
import {
  CheckSquare, Inbox, CircleCheck, Clock, DollarSign, AlertTriangle,
  Activity, RefreshCw, Download, ChevronRight, CircleX,
} from 'lucide-react';
import {
  useStats,
  useTasksSummary,
  useTasksBySpaceStatus,
  useTimeEntriesByUser,
  useTimeEntriesByClient,
  useTimeEntriesByDepartment,
  useWebhookEvents,
  useSyncHealth,
  useSprintPoints,
  useOverviewDeltas,
} from '../hooks/useReports';
import { MetricCard } from '../components/ui/MetricCard';
import { Delta } from '../components/ui/Delta';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { BarChart } from '../components/charts/BarChart';
import { DonutChart } from '../components/charts/DonutChart';
import { CostTrendCard } from '../components/charts/CostTrendCard';
import { CycleTimeCard } from '../components/charts/CycleTimeCard';
import { AnomaliesPanel } from '../components/AnomaliesPanel';
import { fmt } from '../lib/formatters';
import { useGlobalFilters } from '../hooks/useGlobalFilters';

// Backend returns dollars; fmt.money expects cents. AUD is the project currency
// (default in fmt.money), so no need to pass it explicitly.
function moneyAud(dollars: number) {
  return fmt.money(Math.round(dollars * 100));
}

// Status → color mapping matching design
const STATUS_COLORS: Record<string, string> = {
  open: '#94a3b8',
  'in progress': '#3b82f6',
  'in review': '#a855f7',
  blocked: '#ef4444',
  closed: '#10b981',
  archived: '#64748b',
};

const SPACE_COLORS = ['#7B68EE', '#FF02F0', '#49CCF9', '#10b981', '#f59e0b', '#ef4444'];

// HealthIndicator matches the design's inline component
function HealthIndicator({ status, label, value }: { status: 'healthy' | 'warning' | 'error'; label: string; value: string }) {
  const color = status === 'healthy' ? 'var(--green)' : status === 'warning' ? 'var(--amber)' : 'var(--red)';
  const bg = status === 'healthy' ? 'var(--pill-green-bg)' : status === 'warning' ? 'var(--pill-amber-bg)' : 'var(--pill-red-bg)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--muted-bg)' }}>
      <span style={{
        width: 8, height: 8, borderRadius: 999, background: color,
        boxShadow: `0 0 0 3px ${bg}`,
        animation: status === 'healthy' ? 'pulse 2s infinite' : 'none',
        flexShrink: 0,
      }} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      </div>
    </div>
  );
}

type TaskBySpaceRow = { spaceName: string; status: string; count: number };
type UserTimeRow    = { userName: string; totalHours: number; totalCostAud: number };
type ClientTimeRow  = { client: string; totalHours: number; totalCostAud: number };
type DeptTimeRow    = { department: string; totalHours: number; totalCostAud: number };
type SprintPointRow = { spaceName: string; status: string; totalPoints: number };
type WebhookRow     = { id: string; eventType: string; taskId: string | null; status: string; receivedAt: string };
type Stats          = {
  failedJobsLast24h: number;
  deadLetterPending: number;
  webhooksLast24h: number;
  missingRateEntries: number;
};
type TasksSummary   = {
  bySpace: { spaceId: string | null; spaceName: string | null; count: number }[];
  byStatus: { status: string | null; count: number }[];
  byStatusType: { statusType: string | null; count: number }[];
  total: number;
};

export function OverviewPage() {
  const navigate = useNavigate();
  // `dateRangeLabel` mirrors the topbar selection ("last 24h", "last 30d", or
  // a custom-range pair). The time/cost cards' sublabels used to hardcode
  // "last 30d" regardless of what the user picked — values were correct but
  // the label lied. This drives them from the source of truth.
  const { dateRangeLabel, dateRange, customFrom, customTo } = useGlobalFilters();

  const deltasQ = useOverviewDeltas();
  const deltas = deltasQ.data;

  const stats          = useStats();
  const tasksSummary   = useTasksSummary();
  const tasksBySpace   = useTasksBySpaceStatus();
  const timeByUser     = useTimeEntriesByUser();
  const timeByClient   = useTimeEntriesByClient();
  const timeByDept     = useTimeEntriesByDepartment();
  const webhookEvents  = useWebhookEvents({ limit: 7 });
  const syncHealth     = useSyncHealth();
  const sprintPoints   = useSprintPoints();

  const sd      = stats.data as Stats | undefined;
  const summary = tasksSummary.data as TasksSummary | undefined;
  const rows = (tasksBySpace.data as TaskBySpaceRow[] | undefined) ?? [];

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

  // ── Chart data ───────────────────────────────────────────────────────────────

  // DonutChart: tasks by status (aggregate across spaces)
  const statusMap = new Map<string, number>();
  rows.forEach(r => statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + r.count));
  const tasksByStatusData = Array.from(statusMap.entries()).map(([status, count]) => ({
    label: status,
    value: count,
    color: STATUS_COLORS[status.toLowerCase()] ?? '#94a3b8',
  }));

  // BarChart: tasks by space. Source is `tasksSummary.bySpace` (which carries
  // both id + name) so unconfigured spaces with `space_name = NULL` still get
  // a sensible label instead of a blank row — same "Space {id}" fallback the
  // TopBar dropdown uses.
  const tasksBySpaceData = (summary?.bySpace ?? [])
    .map((r, i) => ({
      label: (r.spaceName?.trim()) || (r.spaceId ? `Space ${r.spaceId}` : 'Unnamed space'),
      value: r.count,
      color: SPACE_COLORS[i % SPACE_COLORS.length],
    }))
    .sort((a, b) => b.value - a.value);

  // BarChart: time by assignee (top 6). Full username — the old
  // `.split(' ')[0]` collapsed people whose names start with "Md." or
  // "Mohammad" into the same first token, making the chart unreadable.
  const timeByUserData = [...userRows]
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 6)
    .map((r, i) => ({ label: r.userName, value: r.totalHours, color: SPACE_COLORS[i % SPACE_COLORS.length] }));

  // BarChart: cost by assignee (top 6). Same source array as timeByUserData
  // but sorted/mapped by totalCostAud. Raw dollars are passed straight to
  // moneyAud() in the card body, matching the "Cost by department" tile.
  const costByUserData = [...userRows]
    .sort((a, b) => b.totalCostAud - a.totalCostAud)
    .slice(0, 6)
    .map((r, i) => ({ label: r.userName, value: r.totalCostAud, color: SPACE_COLORS[i % SPACE_COLORS.length] }));

  // BarChart: cost by department
  const deptRows = (timeByDept.data as DeptTimeRow[] | undefined) ?? [];
  const costByDeptData = [...deptRows]
    .sort((a, b) => b.totalCostAud - a.totalCostAud)
    .slice(0, 6)
    .map((r, i) => ({ label: r.department, value: r.totalCostAud, color: SPACE_COLORS[i % SPACE_COLORS.length] }));

  // BarChart: cost by client. Title says "spend"; values must be cost in cents
  // (formatted as money) — the old code mapped `totalHours` here, so the chart
  // ranked by cost but rendered hours, which is meaningless.
  const clientRows = (timeByClient.data as ClientTimeRow[] | undefined) ?? [];
  const costByClientData = [...clientRows]
    .sort((a, b) => b.totalCostAud - a.totalCostAud)
    .slice(0, 5)
    .map((r, i) => ({
      label: r.client,
      value: Math.round(r.totalCostAud * 100),
      color: SPACE_COLORS[i % SPACE_COLORS.length],
    }));

  // BarChart: sprint points
  const sprintMap = new Map<string, number>();
  ((sprintPoints.data as SprintPointRow[] | undefined) ?? []).forEach(r => {
    sprintMap.set(r.spaceName, (sprintMap.get(r.spaceName) ?? 0) + r.totalPoints);
  });
  const sprintData = Array.from(sprintMap.entries()).map(([label, value], i) => ({
    label, value, color: SPACE_COLORS[i % SPACE_COLORS.length],
  }));

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
      target: '/sync-logs',
    },
    deadLetters > 0 && {
      tone: 'amber' as const,
      icon: <Clock size={13} />,
      title: `${deadLetters} dead-letter jobs pending`,
      body: 'Unrecoverable jobs that need review',
      action: 'Review',
      target: '/sync-logs',
    },
  ].filter(Boolean) as { tone: 'amber' | 'red'; icon: React.ReactNode; title: string; body: string; action: string; target: string }[];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      <PageHeader
        title="Overview"
        description="System health, sync activity, and operational metrics for your ClickUp pipeline."
        actions={
          <>
            <Button variant="default" icon={<RefreshCw size={13} strokeWidth={1.75} />}
              onClick={() => window.location.reload()}>Refresh</Button>
            <Button variant="accent" icon={<Download size={13} strokeWidth={1.75} />}>Export</Button>
          </>
        }
      />

      {/* Surfaces the first failing dashboard query — otherwise the KPI cards
          all dash-render and look identical to "no data yet". */}
      <QueryError
        queries={[stats, tasksSummary, tasksBySpace, timeByUser, timeByClient, timeByDept, webhookEvents, syncHealth, sprintPoints]}
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
          <HealthIndicator status={deadLetters > 0 ? 'warning' : 'healthy'} label="Dead letters" value={`${deadLetters} pending`} />
          <HealthIndicator status={failedJobs > 0 ? 'error' : 'healthy'} label="Failed jobs (24h)" value={`${failedJobs} need retry`} />
          <HealthIndicator status={lastSyncAt ? 'healthy' : 'warning'} label="Last task update" value={lastSyncAt ? fmt.relative(lastSyncAt) : '—'} />
        </div>
      </Card>

      {/* Cost trend */}
      <CostTrendCard />

      {/* Cycle time */}
      <CycleTimeCard />

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <Card title="Tasks by status" subtitle={`${fmt.number(totalTasks)} total tasks tracked`} padding={16}>
          <DonutChart data={tasksByStatusData} size={140} thickness={14} centerLabel="Total" centerValue={totalTasks} />
        </Card>

        <Card title="Tasks by space" subtitle="Distribution across workspaces" padding={16}>
          <BarChart data={tasksBySpaceData} direction="horizontal" formatValue={fmt.number} />
        </Card>

        <Card title="Time tracked by assignee" subtitle={`Hours logged in ${dateRangeLabel}`} padding={16}>
          <BarChart data={timeByUserData} direction="horizontal" formatValue={fmt.hours} />
        </Card>

        <Card title="Cost by assignee" subtitle="Top 6 by calculated labor cost" padding={16}>
          <BarChart data={costByUserData} direction="horizontal" formatValue={(v) => moneyAud(v)} />
        </Card>

        <Card title="Cost by department" subtitle="Calculated labor cost" padding={16}>
          <BarChart data={costByDeptData} direction="horizontal" formatValue={v => moneyAud(v)} />
        </Card>

        <Card title="Cost by client" subtitle="Top 5 clients by spend" padding={16}>
          <BarChart data={costByClientData} direction="horizontal" formatValue={(v) => moneyAud(v / 100)} />
        </Card>
      </div>

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
                <tr><td colSpan={4} style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No recent events</td></tr>
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
              <div style={{ padding: 16 }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No active alerts.</p>
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

      {/* Sprint points */}
      {sprintData.length > 0 && (
        <Card title="Sprint points by space" subtitle="Work delivered across active sprints" padding={16}>
          <BarChart data={sprintData} direction="horizontal" formatValue={v => `${v} pts`} />
        </Card>
      )}
    </div>
  );
}
