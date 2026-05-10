import { useState } from 'react';
import { useJobLogs, useWebhookEvents, useDeadLetters } from '../hooks/useReports';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { MetricCard } from '../components/ui/MetricCard';
import { DataTable } from '../components/ui/DataTable';
import type { Column } from '../components/ui/DataTable';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Pill } from '../components/ui/Pill';
import { SyncRunDrawer } from '../components/SyncRunDrawer';
import type { JobLogItem } from '../components/SyncRunDrawer';
import { WebhookEventDrawer } from '../components/WebhookEventDrawer';
import type { WebhookItem } from '../components/WebhookEventDrawer';
import { fmt } from '../lib/formatters';

type JobRow = JobLogItem & { [key: string]: unknown };
type WebhookRow = WebhookItem & { [key: string]: unknown };

const TAB_ITEMS = [
  { key: 'runs', label: 'Sync Runs' },
  { key: 'webhooks', label: 'Webhook Events' },
];

const EVENT_TYPES = ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskTimeTrackedUpdated'];

export function SyncLogsPage() {
  const [activeTab, setActiveTab] = useState('runs');
  const [selectedJob, setSelectedJob] = useState<JobLogItem | null>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookItem | null>(null);
  const [webhookStatusFilter, setWebhookStatusFilter] = useState('');
  const [webhookEventFilter, setWebhookEventFilter] = useState('');

  const jobLogs = useJobLogs({ limit: 50 });
  const webhookEvents = useWebhookEvents({ limit: 50 });
  const deadLetters = useDeadLetters({ limit: 1 });

  // --- Sync Runs tab ---
  const jobItems: JobRow[] = (jobLogs.data?.items ?? []) as JobRow[];
  const jobTotal = jobLogs.data?.total ?? 0;

  const completedJobs = jobItems.filter((j) => j.status === 'completed');
  const failedJobs = jobItems.filter((j) => j.status === 'failed');

  const latestSuccess = completedJobs
    .filter((j) => j.finishedAt !== null)
    .sort((a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime())[0];

  const latestFailure = failedJobs
    .filter((j) => j.finishedAt !== null)
    .sort((a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime())[0];

  const successRate =
    jobItems.length > 0
      ? ((completedJobs.length / jobItems.length) * 100).toFixed(0) + '%'
      : '—';

  const jobColumns: Column<JobRow>[] = [
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'id',
      header: 'Job ID',
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-muted)]">{row.id.slice(0, 8)}</span>
      ),
    },
    {
      key: 'queueName',
      header: 'Queue',
      render: (row) => <Pill tone="blue">{row.queueName}</Pill>,
    },
    {
      key: 'jobName',
      header: 'Job Name',
      render: (row) => <Pill tone="gray">{row.jobName}</Pill>,
    },
    {
      key: 'finishedAt',
      header: 'Finished',
      render: (row) =>
        row.finishedAt ? (
          <span className="text-xs text-[var(--text-muted)]">{fmt.relative(row.finishedAt)}</span>
        ) : (
          <span className="text-[var(--text-faint)]">—</span>
        ),
    },
    {
      key: 'entityId',
      header: 'Entity',
      render: (row) => (
        <span className="text-xs font-mono text-[var(--text-muted)]">{row.entityId ?? '—'}</span>
      ),
    },
    {
      key: 'errorMessage',
      header: 'Error',
      render: (row) =>
        row.errorMessage ? (
          <span style={{ color: 'var(--red)', fontSize: 12 }}>
            {row.errorMessage.slice(0, 40)}
          </span>
        ) : null,
    },
  ];

  // --- Webhook Events tab ---
  const allWebhookItems: WebhookRow[] = (webhookEvents.data?.items ?? []) as WebhookRow[];
  const webhookTotal = webhookEvents.data?.total ?? 0;
  const deadLetterTotal = deadLetters.data?.total ?? 0;

  const processedWebhooks = allWebhookItems.filter((w) => w.status === 'processed');
  const failedWebhooks = allWebhookItems.filter((w) => w.status === 'failed');

  const filteredWebhooks = allWebhookItems.filter((w) => {
    if (webhookStatusFilter && w.status !== webhookStatusFilter) return false;
    if (webhookEventFilter && w.eventType !== webhookEventFilter) return false;
    return true;
  });

  const webhookColumns: Column<WebhookRow>[] = [
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'eventType',
      header: 'Event',
      render: (row) => <Pill tone="blue">{row.eventType}</Pill>,
    },
    {
      key: 'taskId',
      header: 'Task ID',
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-muted)]">{row.taskId ?? '—'}</span>
      ),
    },
    {
      key: 'receivedAt',
      header: 'Received',
      render: (row) => (
        <span className="text-xs text-[var(--text-muted)]">{fmt.relative(row.receivedAt)}</span>
      ),
    },
    {
      key: 'processedAt',
      header: 'Processed',
      render: (row) =>
        row.processedAt ? (
          <span className="text-xs text-[var(--text-muted)]">{fmt.relative(row.processedAt)}</span>
        ) : (
          <Pill tone="amber">Pending</Pill>
        ),
    },
  ];

  const selectClass =
    'bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-1.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] transition-colors';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sync Logs" />

      <Tabs items={TAB_ITEMS} active={activeTab} onChange={setActiveTab} variant="underline" />

      {activeTab === 'runs' && (
        <div className="flex flex-col gap-6">
          {/* KPIs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            <MetricCard
              label="Last Success"
              value={
                jobLogs.isLoading
                  ? '—'
                  : latestSuccess?.finishedAt
                    ? fmt.relative(latestSuccess.finishedAt)
                    : 'Never'
              }
              dense
            />
            <MetricCard
              label="Last Failure"
              value={
                jobLogs.isLoading
                  ? '—'
                  : latestFailure?.finishedAt
                    ? fmt.relative(latestFailure.finishedAt)
                    : 'None'
              }
              dense
            />
            <MetricCard
              label="Success Rate"
              value={jobLogs.isLoading ? '—' : successRate}
              dense
            />
            <MetricCard
              label="Total Logged"
              value={jobLogs.isLoading ? '—' : jobTotal}
              dense
            />
          </div>

          <DataTable<JobRow>
            columns={jobColumns}
            data={jobItems}
            onRowClick={(row) => setSelectedJob(row as JobLogItem)}
            emptyTitle="No job logs"
            pageSize={50}
          />
        </div>
      )}

      {activeTab === 'webhooks' && (
        <div className="flex flex-col gap-6">
          {/* KPIs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            <MetricCard
              label="Total (24h)"
              value={webhookEvents.isLoading ? '—' : webhookTotal}
              dense
            />
            <MetricCard
              label="Processed"
              value={webhookEvents.isLoading ? '—' : processedWebhooks.length}
              dense
            />
            <MetricCard
              label="Failed"
              value={webhookEvents.isLoading ? '—' : failedWebhooks.length}
              dense
            />
            <MetricCard
              label="Pending Dead Letters"
              value={deadLetters.isLoading ? '—' : deadLetterTotal}
              dense
            />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3">
            <select
              className={selectClass}
              value={webhookStatusFilter}
              onChange={(e) => setWebhookStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="processed">Processed</option>
              <option value="failed">Failed</option>
            </select>
            <select
              className={selectClass}
              value={webhookEventFilter}
              onChange={(e) => setWebhookEventFilter(e.target.value)}
            >
              <option value="">All event types</option>
              {EVENT_TYPES.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </div>

          <DataTable<WebhookRow>
            columns={webhookColumns}
            data={filteredWebhooks}
            onRowClick={(row) => setSelectedWebhook(row as WebhookItem)}
            emptyTitle="No webhook events"
            pageSize={50}
          />
        </div>
      )}

      <SyncRunDrawer item={selectedJob} onClose={() => setSelectedJob(null)} />
      <WebhookEventDrawer item={selectedWebhook} onClose={() => setSelectedWebhook(null)} />
    </div>
  );
}
