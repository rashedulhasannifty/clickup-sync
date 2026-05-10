import { useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { useJobLogs, useWebhookEvents, useDeadLetters } from '../hooks/useReports';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { MetricCard } from '../components/ui/MetricCard';
import { Select } from '../components/ui/Select';
import { DataTable } from '../components/ui/DataTable';
import type { Column } from '../components/ui/DataTable';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { SyncRunDrawer } from '../components/SyncRunDrawer';
import type { JobLogItem } from '../components/SyncRunDrawer';
import { WebhookEventDrawer } from '../components/WebhookEventDrawer';
import type { WebhookItem } from '../components/WebhookEventDrawer';
import { fmt } from '../lib/formatters';

const WEBHOOK_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'processed', label: 'Processed' },
  { value: 'failed', label: 'Failed' },
];
const WEBHOOK_EVENT_OPTIONS = [
  { value: '', label: 'All event types' },
  ...['taskCreated', 'taskUpdated', 'taskDeleted', 'taskTimeTrackedUpdated'].map(et => ({ value: et, label: et })),
];

type JobRow = JobLogItem & { [key: string]: unknown };
type WebhookRow = WebhookItem & { [key: string]: unknown };


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

  const last24 = jobItems.slice(0, 24);
  const successRate = last24.length > 0
    ? Math.round(last24.filter(j => j.status === 'completed').length / last24.length * 100) + '%'
    : '—';
  const successRateSub = last24.length > 0 ? `last ${last24.length} runs` : undefined;

  const jobColumns: Column<JobRow>[] = [
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'id',
      header: 'Run',
      width: '100px',
      render: (row) => (
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{row.id.slice(0, 8)}</span>
      ),
    },
    {
      key: 'queueName',
      header: 'Trigger',
      width: '160px',
      render: (row) => <Pill tone="blue">{row.jobName || row.queueName}</Pill>,
    },
    {
      key: 'finishedAt',
      header: 'Started',
      render: (row) =>
        row.finishedAt ? (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt.dateTime(row.finishedAt)}</span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>—</span>
        ),
    },
    {
      key: 'duration',
      header: 'Duration',
      width: '90px',
      render: () => <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'tasks',
      header: 'Tasks',
      width: '70px',
      render: (row) => row.entityId
        ? <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>—</span>
        : <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'timeEntries',
      header: 'Time Entries',
      width: '100px',
      render: () => <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'errorMessage',
      header: 'Errors',
      render: (row) =>
        row.errorMessage ? (
          <span style={{ color: 'var(--red)', fontSize: 12 }}>
            {row.errorMessage.slice(0, 35)}
          </span>
        ) : <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'chevron',
      header: '',
      width: '36px',
      render: () => <ChevronRight size={14} style={{ color: 'var(--text-faint)' }} />,
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

  const tabItems = [
    { value: 'runs', label: 'Sync runs', count: jobTotal > 0 ? jobTotal : undefined },
    { value: 'webhooks', label: 'Webhook events', count: webhookTotal > 0 ? webhookTotal : undefined },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sync Logs"
        description="Pipeline observability — sync runs, webhook deliveries, and error trails."
        actions={
          <Button variant="default" icon={<RefreshCw size={13} />} onClick={() => { jobLogs.refetch?.(); webhookEvents.refetch?.(); }}>
            Trigger sync
          </Button>
        }
      />

      <Tabs items={tabItems} value={activeTab} onChange={setActiveTab} variant="underline" />

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
              sublabel={latestSuccess?.finishedAt ? fmt.dateTime(latestSuccess.finishedAt) : undefined}
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
              sublabel={latestFailure?.errorMessage ? latestFailure.errorMessage.slice(0, 30) + '…' : undefined}
              dense
            />
            <MetricCard
              label="Success Rate"
              value={jobLogs.isLoading ? '—' : successRate}
              sublabel={successRateSub}
              dense
            />
            <MetricCard
              label="Avg Duration"
              value="—"
              sublabel="last 10 runs"
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
            <Select
              options={WEBHOOK_STATUS_OPTIONS}
              value={webhookStatusFilter}
              onChange={setWebhookStatusFilter}
            />
            <Select
              options={WEBHOOK_EVENT_OPTIONS}
              value={webhookEventFilter}
              onChange={setWebhookEventFilter}
            />
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
