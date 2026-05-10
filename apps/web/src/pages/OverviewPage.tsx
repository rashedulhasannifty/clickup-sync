import { useNavigate } from 'react-router-dom';
import {
  useStats,
  useTasksBySpaceStatus,
  useTimeEntriesByUser,
  useTimeEntriesByClient,
  useTimeEntriesByDepartment,
  useTimeEntriesBillableSummary,
  useWebhookEvents,
  useSyncHealth,
  useSprintPoints,
} from '../hooks/useReports';
import { MetricCard } from '../components/ui/MetricCard';
import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/ui/SectionHeader';
import { Skeleton } from '../components/ui/Skeleton';
import { Pill } from '../components/ui/Pill';
import { StatusBadge } from '../components/ui/StatusBadge';
import { PageHeader } from '../components/ui/PageHeader';
import { Callout } from '../components/ui/Callout';
import { DataTable } from '../components/ui/DataTable';
import type { Column } from '../components/ui/DataTable';
import { BarChart } from '../components/charts/BarChart';
import { DonutChart } from '../components/charts/DonutChart';
import { fmt } from '../lib/formatters';

// costAud from backend is already in dollars (divided by 100 server-side),
// but fmt.money() also divides by 100, so pass cents: value * 100
function moneyAud(dollars: number): string {
  return fmt.money(Math.round(dollars * 100));
}

type SyncStatus = 'Fresh' | 'Stale' | 'Unknown';

function SyncPulseDot({ status }: { status: SyncStatus }) {
  const color =
    status === 'Fresh' ? '#10b981' : status === 'Stale' ? '#f59e0b' : '#64748b';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        animation: status === 'Fresh' ? 'pulse 2s infinite' : undefined,
      }}
    />
  );
}

type WebhookEventRow = {
  id: string;
  eventType: string;
  taskId: string | null;
  status: string;
  receivedAt: string;
  processedAt: string | null;
};

const webhookColumns: Column<WebhookEventRow>[] = [
  {
    key: 'eventType',
    header: 'Event',
    render: (row) => {
      const tone =
        row.eventType === 'taskDeleted'
          ? ('red' as const)
          : row.eventType === 'taskCreated'
            ? ('green' as const)
            : ('blue' as const);
      return <Pill tone={tone}>{row.eventType}</Pill>;
    },
  },
  {
    key: 'taskId',
    header: 'Task ID',
    render: (row) => (
      <span className="font-mono text-xs text-[var(--text-muted)]">
        {row.taskId ?? '—'}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'receivedAt',
    header: 'Received',
    render: (row) => (
      <span className="text-xs text-[var(--text-muted)]">
        {fmt.relative(row.receivedAt)}
      </span>
    ),
  },
];

export function OverviewPage() {
  const navigate = useNavigate();
  const stats = useStats();
  const tasksBySpaceStatus = useTasksBySpaceStatus();
  const timeByUser = useTimeEntriesByUser();
  const timeByClient = useTimeEntriesByClient();
  const timeByDept = useTimeEntriesByDepartment();
  const billable = useTimeEntriesBillableSummary();
  const webhookEvents = useWebhookEvents({ limit: 7 });
  const syncHealth = useSyncHealth();
  const sprintPoints = useSprintPoints();

  const statsData = stats.data;
  const billableData = billable.data;

  const failedJobs = statsData?.failedJobsLast24h ?? 0;
  const deadLetters = statsData?.deadLetterPending ?? 0;
  const webhooks24h = statsData?.webhooksLast24h ?? 0;
  const missingRates = statsData?.missingRateEntries ?? 0;
  const billableHours = billableData?.billableHours ?? 0;
  const nonBillableHours = billableData?.nonBillableHours ?? 0;
  const billableCost = billableData?.billableCostAud ?? 0;

  // Build tasks-by-space-status bar data
  const taskBarData = (tasksBySpaceStatus.data ?? []).map((r) => ({
    label: `${r.spaceName} · ${r.status}`,
    value: r.count,
  }));

  // Top 8 users by hours
  const userBarData = [...(timeByUser.data ?? [])]
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 8)
    .map((r) => ({ label: r.userName, value: r.totalHours }));

  const clientBarData = (timeByClient.data ?? []).map((r) => ({
    label: r.client,
    value: r.totalHours,
  }));

  const deptBarData = (timeByDept.data ?? []).map((r) => ({
    label: r.department,
    value: r.totalHours,
  }));

  const donutData = billableData
    ? [
        { label: 'Billable', value: billableData.billableHours, color: '#7B68EE' },
        { label: 'Non-billable', value: billableData.nonBillableHours, color: '#64748b' },
      ]
    : [];

  const sprintBarData = (sprintPoints.data ?? []).map((r) => ({
    label: `${r.spaceName} · ${r.status}`,
    value: r.totalPoints,
  }));

  const webhookItems = webhookEvents.data?.items ?? [];

  const staleSpaces = (syncHealth.data ?? []).filter((s) => s.status === 'Stale');
  const hasAlerts = staleSpaces.length > 0 || deadLetters > 0 || missingRates > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Overview" />

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
        }}
      >
        <MetricCard
          label="Failed Jobs (24h)"
          value={stats.isLoading ? '—' : fmt.number(failedJobs)}
          accent={failedJobs > 0}
        />
        <MetricCard
          label="Dead Letters"
          value={stats.isLoading ? '—' : fmt.number(deadLetters)}
          accent={deadLetters > 0}
        />
        <MetricCard
          label="Webhooks (24h)"
          value={stats.isLoading ? '—' : fmt.number(webhooks24h)}
        />
        <MetricCard
          label="Missing Rates"
          value={stats.isLoading ? '—' : fmt.number(missingRates)}
          accent={missingRates > 0}
          onClick={() => navigate('/missing-rates')}
        />
        <MetricCard
          label="Billable Hours"
          value={billable.isLoading ? '—' : fmt.hours(billableHours)}
          sub={`Non-billable: ${fmt.hours(nonBillableHours)}`}
        />
        <MetricCard
          label="Billable Cost"
          value={billable.isLoading ? '—' : moneyAud(billableCost)}
        />
      </div>

      {/* Sync Health Card */}
      <Card>
        <SectionHeader title="Sync Health" />
        {syncHealth.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton height={24} />
            <Skeleton height={24} />
            <Skeleton height={24} />
          </div>
        ) : (syncHealth.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No sync data available.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(syncHealth.data ?? []).map((s) => (
              <div key={s.scopeId} className="flex items-center gap-3">
                <SyncPulseDot status={s.status as SyncStatus} />
                <span className="text-sm text-[var(--text)] flex-1">{s.spaceName}</span>
                <span className="text-xs text-[var(--text-muted)]">
                  {s.ageMinutes != null ? `${s.ageMinutes} min ago` : 'Unknown'}
                </span>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Charts Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        {/* Tasks by Space + Status */}
        <Card>
          <SectionHeader title="Tasks by Space & Status" />
          {tasksBySpaceStatus.isLoading ? (
            <Skeleton height={200} />
          ) : (
            <BarChart data={taskBarData} direction="horizontal" height={200} />
          )}
        </Card>

        {/* Time by User */}
        <Card>
          <SectionHeader title="Time by User (top 8)" />
          {timeByUser.isLoading ? (
            <Skeleton height={200} />
          ) : (
            <BarChart
              data={userBarData}
              direction="horizontal"
              height={200}
              formatValue={(v) => fmt.hours(v)}
            />
          )}
        </Card>

        {/* Time by Client */}
        <Card>
          <SectionHeader title="Time by Client" />
          {timeByClient.isLoading ? (
            <Skeleton height={200} />
          ) : (
            <BarChart
              data={clientBarData}
              direction="horizontal"
              height={200}
              formatValue={(v) => fmt.hours(v)}
            />
          )}
        </Card>

        {/* Time by Department */}
        <Card>
          <SectionHeader title="Time by Department" />
          {timeByDept.isLoading ? (
            <Skeleton height={200} />
          ) : (
            <BarChart
              data={deptBarData}
              direction="horizontal"
              height={200}
              formatValue={(v) => fmt.hours(v)}
            />
          )}
        </Card>

        {/* Billable vs Non-billable */}
        <Card>
          <SectionHeader title="Billable vs Non-billable" />
          {billable.isLoading ? (
            <Skeleton height={200} />
          ) : (
            <DonutChart data={donutData} size={160} />
          )}
        </Card>

        {/* Sprint Points */}
        <Card>
          <SectionHeader title="Sprint Points by Space & Status" />
          {sprintPoints.isLoading ? (
            <Skeleton height={200} />
          ) : (
            <BarChart data={sprintBarData} direction="vertical" height={200} />
          )}
        </Card>
      </div>

      {/* Bottom Row: Webhooks + Alerts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
        }}
      >
        {/* Recent Webhook Events */}
        <Card>
          <SectionHeader title="Recent Webhook Events" />
          {webhookEvents.isLoading ? (
            <Skeleton height={160} />
          ) : (
            <DataTable<WebhookEventRow>
              columns={webhookColumns}
              data={webhookItems}
              pageSize={7}
              emptyTitle="No recent events"
            />
          )}
        </Card>

        {/* Alerts */}
        <Card>
          <SectionHeader title="Alerts" />
          {!hasAlerts ? (
            <p className="text-sm text-[var(--text-muted)]">No active alerts.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {staleSpaces.map((s) => (
                <Callout key={s.scopeId} tone="warning">
                  Stale sync: <strong>{s.spaceName}</strong>{' '}
                  {s.ageMinutes != null ? `(${s.ageMinutes} min ago)` : ''}
                </Callout>
              ))}
              {deadLetters > 0 && (
                <Callout tone="error">
                  {deadLetters} dead letter{deadLetters !== 1 ? 's' : ''} pending in the queue.
                </Callout>
              )}
              {missingRates > 0 && (
                <Callout tone="warning">
                  {missingRates} time{missingRates !== 1 ? ' entries' : ' entry'} with missing
                  assignee rates.
                </Callout>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
