import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  CircleCheck,
  Clock,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useJobLogs, useWebhookEvents } from '../hooks/useReports';
import { useRetryFailedWebhooks, useDeadLetters, useRetryDeadLetter, useResolveDeadLetter, useRetryAllDeadLetters } from '../hooks/useAdmin';
import { useAuth } from '../hooks/useAuth';
import type { DeadLetterJob } from '../api/admin';
import { useToast } from '../components/ui/Toast';
import { QueryError } from '../components/ui/QueryError';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { MetricCard } from '../components/ui/MetricCard';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Pagination } from '../components/ui/Pagination';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { SyncRunDrawer } from '../components/SyncRunDrawer';
import type { JobLogItem } from '../components/SyncRunDrawer';
import { WebhookEventDrawer } from '../components/WebhookEventDrawer';
import type { WebhookItem } from '../components/WebhookEventDrawer';
import { fmt } from '../lib/formatters';
import { onActivate } from '../lib/a11y';

const WEBHOOK_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'processed', label: 'Processed' },
  { value: 'failed', label: 'Failed' },
];

const JOB_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'partial', label: 'Partial' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Pending' },
];

function JobStatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === 'completed' || s === 'success') {
    return (
      <Pill tone="green" size="xs" icon={<CircleCheck size={10} />}>
        success
      </Pill>
    );
  }
  if (s === 'failed') {
    return (
      <Pill tone="red" size="xs" icon={<X size={10} />}>
        failed
      </Pill>
    );
  }
  if (s === 'running' || s === 'pending') {
    return (
      <Pill tone="blue" size="xs" icon={<RefreshCw size={10} />}>
        {s}
      </Pill>
    );
  }
  return (
    <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} />}>
      {status}
    </Pill>
  );
}

function webhookLatencyMs(w: WebhookItem): number | null {
  if (!w.processedAt) return null;
  const ms = new Date(w.processedAt).getTime() - new Date(w.receivedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return ms;
}

function webhookLatencyLabel(w: WebhookItem): string {
  const ms = webhookLatencyMs(w);
  return ms == null ? '—' : `${ms}ms`;
}

export function SyncLogsPage() {
  const [searchParams] = useSearchParams();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');

  // Allow deep-linking to a specific tab (Overview's Dead-letters / Failed-jobs
  // health tiles link here). Dead-letters is admin-only.
  const initialTab = (() => {
    const t = searchParams.get('tab');
    if (t === 'webhooks' || t === 'runs') return t;
    if (t === 'dead-letters' && isAdmin) return t;
    return 'runs';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedJob, setSelectedJob] = useState<JobLogItem | null>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookItem | null>(null);
  const [webhookSearch, setWebhookSearch] = useState('');
  const [webhookStatusFilter, setWebhookStatusFilter] = useState('all');
  const [webhookEventFilter, setWebhookEventFilter] = useState('all');
  const [jobStatusFilter, setJobStatusFilter] = useState(() =>
    searchParams.get('status') === 'failed' ? 'failed' : 'all',
  );
  const [runsPage, setRunsPage] = useState(1);
  const [runsPageSize, setRunsPageSize] = useState(50);
  const [webhooksPage, setWebhooksPage] = useState(1);
  const [webhooksPageSize, setWebhooksPageSize] = useState(50);
  // Debounce the free-text search so server-side filtering doesn't fire a
  // request on every keystroke.
  const [debouncedWebhookSearch, setDebouncedWebhookSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedWebhookSearch(webhookSearch.trim());
      setWebhooksPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [webhookSearch]);

  const deadLetters = useDeadLetters(isAdmin);
  const retryDeadLetter = useRetryDeadLetter();
  const resolveDeadLetter = useResolveDeadLetter();
  const retryAllDeadLetters = useRetryAllDeadLetters();
  const dlItems: DeadLetterJob[] = Array.isArray(deadLetters.data?.items) ? deadLetters.data!.items : [];
  const dlTotal = deadLetters.data?.total ?? 0;
  // Backend re-queues at most this many pending jobs per "Retry all" click
  // (src/admin/admin-dead-letters.controller.ts → findPending(1000, 0)). Keep in
  // sync with that limit so the button label doesn't over-promise.
  const RETRY_ALL_CAP = 1000;

  const jobLogs = useJobLogs({
    limit: runsPageSize,
    offset: (runsPage - 1) * runsPageSize,
    status: jobStatusFilter !== 'all' ? jobStatusFilter : undefined,
  });
  // "Last success" / "Last failure" cards source their values from these
  // status-scoped queries, not from the 50-row slice above. If the DB has
  // 50+ runs more recent than the most recent failure, the failure would
  // never appear in the slice and the card would read "Never" — which
  // contradicted Overview's "Failed jobs (24h): N need retry" KPI.
  const lastSuccessQuery = useJobLogs({ status: 'completed', limit: 1 });
  const lastFailureQuery = useJobLogs({ status: 'failed', limit: 1 });
  const webhookEvents = useWebhookEvents({
    limit: webhooksPageSize,
    offset: (webhooksPage - 1) * webhooksPageSize,
    status: webhookStatusFilter !== 'all' ? webhookStatusFilter : undefined,
    eventType: webhookEventFilter !== 'all' ? webhookEventFilter : undefined,
    search: debouncedWebhookSearch || undefined,
  });
  // Unfiltered recent sample for the health metric cards + the "total events"
  // count and tab badge, so the table's status/event/search filter doesn't
  // skew the at-a-glance numbers (mirrors the last-success/last-failure split).
  const webhookStats = useWebhookEvents({ limit: 200 });
  const retryFailedWebhooks = useRetryFailedWebhooks();

  // Retry/resolve feedback surfaces as a toast (top-right, auto-dismiss).
  const toast = useToast();
  function showBanner(msg: string, tone: 'blue' | 'green' | 'red' = 'blue') {
    toast.show(msg, tone);
  }

  const jobItems: JobLogItem[] = Array.isArray(jobLogs.data?.items) ? (jobLogs.data!.items as JobLogItem[]) : [];
  const jobTotal = jobLogs.data?.total ?? 0;

  // Sourced from status-filtered queries above so "Last failure" / "Last
  // success" reflect the absolute most-recent row in the DB, not whatever
  // happens to fall inside the most-recent 50.
  const latestSuccess = (lastSuccessQuery.data?.items?.[0] as JobLogItem | undefined) ?? undefined;
  const latestFailure = (lastFailureQuery.data?.items?.[0] as JobLogItem | undefined) ?? undefined;

  const successRatePct =
    jobItems.length > 0 ? Math.round((jobItems.filter((j) => j.status === 'completed').length / jobItems.length) * 100) : null;

  // Server-filtered + paginated slice that fills the table.
  const allWebhookItems: WebhookItem[] = Array.isArray(webhookEvents.data?.items)
    ? (webhookEvents.data!.items as WebhookItem[])
    : [];
  const webhookTotal = webhookEvents.data?.total ?? 0; // filtered total → pager

  // Unfiltered recent sample + total drive the health cards and tab badge.
  const statItems: WebhookItem[] = Array.isArray(webhookStats.data?.items)
    ? (webhookStats.data!.items as WebhookItem[])
    : [];
  const webhookStatsTotal = webhookStats.data?.total ?? 0;

  const processedWebhooks = statItems.filter((w) => w.status === 'processed');
  const failedWebhooks = statItems.filter((w) => w.status === 'failed');

  // Event-type options come from the server's distinct list (computed over ALL
  // events, not the current page) so the dropdown stays stable under filtering.
  const serverEventTypes: string[] = Array.isArray(webhookStats.data?.eventTypes)
    ? (webhookStats.data!.eventTypes as string[])
    : [];
  const eventTypeOptions = useMemo(
    () => [{ value: 'all', label: 'All events' }, ...serverEventTypes.map((e) => ({ value: e, label: e }))],
    [serverEventTypes],
  );

  const processedPct =
    statItems.length > 0
      ? Math.round((processedWebhooks.length / statItems.length) * 100)
      : 0;

  const latencySamples = statItems.map(webhookLatencyMs).filter((n): n is number => n != null);
  const avgLatencyMs =
    latencySamples.length > 0
      ? Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length)
      : null;
  const sortedLat = [...latencySamples].sort((a, b) => a - b);
  const p95LatencyMs =
    sortedLat.length > 0
      ? sortedLat[Math.min(sortedLat.length - 1, Math.max(0, Math.ceil(0.95 * sortedLat.length) - 1))]
      : null;

  const tabItems = [
    { value: 'runs', label: 'Sync runs', count: jobTotal > 0 ? jobTotal : undefined },
    // Filtered total (matches the Sync-runs badge convention — the badge counts
    // what the table is currently showing). The unfiltered total lives on the
    // "Total events" health card instead.
    { value: 'webhooks', label: 'Webhook events', count: webhookTotal > 0 ? webhookTotal : undefined },
    // Dead-letter management is admin-only (the API 403s for members).
    ...(isAdmin
      ? [{ value: 'dead-letters', label: 'Dead letters', count: dlTotal > 0 ? dlTotal : undefined }]
      : []),
  ];

  const runsLoading = jobLogs.isLoading;
  const webhooksLoading = webhookEvents.isLoading;
  const webhookStatsLoading = webhookStats.isLoading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Sync Logs"
        description="Pipeline observability — sync runs, webhook deliveries, and error trails."
        actions={
          <Button
            size="md"
            variant="default"
            icon={<RefreshCw size={13} />}
            onClick={() => {
              jobLogs.refetch?.();
              webhookEvents.refetch?.();
            }}
          >
            Refresh
          </Button>
        }
      />


      <Tabs items={tabItems} value={activeTab} onChange={setActiveTab} variant="segmented" />

      {activeTab === 'runs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <QueryError query={jobLogs} what="sync runs" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <MetricCard
              dense
              label="Last success"
              value={runsLoading ? '—' : latestSuccess?.finishedAt ? fmt.relative(latestSuccess.finishedAt) : '—'}
              sublabel={latestSuccess?.finishedAt ? fmt.dateTime(latestSuccess.finishedAt) : undefined}
              icon={<CircleCheck size={13} />}
            />
            <MetricCard
              dense
              label="Last failure"
              value={runsLoading ? '—' : latestFailure?.finishedAt ? fmt.relative(latestFailure.finishedAt) : 'Never'}
              sublabel={
                latestFailure?.errorMessage
                  ? `${latestFailure.errorMessage.slice(0, 30)}${latestFailure.errorMessage.length > 30 ? '…' : ''}`
                  : undefined
              }
              icon={<AlertTriangle size={13} />}
            />
            <MetricCard
              dense
              label="Success rate"
              value={runsLoading ? '—' : successRatePct != null ? `${successRatePct}%` : '—'}
              sublabel={jobItems.length > 0 ? `last ${jobItems.length} runs` : undefined}
              icon={<Activity size={13} />}
            />
            <MetricCard
              dense
              label="Avg duration"
              value={(() => {
                const samples = jobItems
                  .filter((j) => j.durationMs != null)
                  .slice(0, 10)
                  .map((j) => j.durationMs!);
                if (samples.length === 0) return '—';
                const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
                return avg < 1000 ? `${avg}ms` : `${(avg / 1000).toFixed(1)}s`;
              })()}
              sublabel="last 10 runs"
              icon={<Clock size={13} />}
            />
          </div>

          {/* Status filter — picking "Failed" shows the failed-jobs view with a
              Recovered column indicating whether a later success for the same
              (queue, entity) exists. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: 10,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Status</span>
            <Select ariaLabel="Filter runs by status" size="md" options={JOB_STATUS_OPTIONS} value={jobStatusFilter} onChange={(v) => { setJobStatusFilter(v); setRunsPage(1); }} />
            <span style={{ flex: 1 }} />
            {jobStatusFilter === 'failed' && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Showing {jobTotal} failed{' '}
                {(() => {
                  const recovered = jobItems.filter((j) => j.recovered === true).length;
                  const stillFailing = jobItems.filter((j) => j.recovered === false).length;
                  return `· ${recovered} recovered · ${stillFailing} still failing in this page`;
                })()}
              </span>
            )}
          </div>

          {runsLoading ? (
            <TableSkeleton />
          ) : (
            <Card padding={0}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr
                    style={{
                      background: 'var(--muted-bg)',
                      textTransform: 'uppercase',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      letterSpacing: '0.05em',
                      fontWeight: 600,
                    }}
                  >
                    <th style={{ textAlign: 'left', padding: '10px 16px', width: 90 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px' }}>Run</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px' }}>Trigger</th>
                    {jobStatusFilter === 'failed' && (
                      <th style={{ textAlign: 'left', padding: '10px 12px', width: 130 }}>Recovered?</th>
                    )}
                    <th style={{ textAlign: 'left', padding: '10px 12px' }}>Started</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px' }}>Duration</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px' }}>Tasks</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px' }}>Time entries</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px' }}>Errors</th>
                    <th style={{ width: 60, padding: '10px 16px' }} />
                  </tr>
                </thead>
                <tbody>
                  {jobItems.length === 0 ? (
                    <tr>
                      <td colSpan={jobStatusFilter === 'failed' ? 10 : 9}>
                        <EmptyState
                          icon={<RefreshCw size={20} />}
                          title={jobStatusFilter === 'failed' ? 'No failed runs' : 'No sync runs yet'}
                          body={jobStatusFilter === 'failed'
                            ? 'Nothing has failed in this view — runs appear here when a job errors.'
                            : 'Scheduled and manual sync runs will appear here.'}
                        />
                      </td>
                    </tr>
                  ) : (
                    jobItems.map((r, i) => {
                      const errCount = r.errorMessage ? 1 : 0;
                      return (
                        <tr
                          key={r.id}
                          className="row-3d"
                          onClick={() => setSelectedJob(r)}
                          tabIndex={0}
                          onKeyDown={onActivate(() => setSelectedJob(r))}
                          style={{
                            borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined,
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--hover)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <td style={{ padding: '12px 16px' }}>
                            <JobStatusPill status={r.status} />
                          </td>
                          <td
                            style={{
                              padding: '12px',
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: 11,
                              color: 'var(--text)',
                              wordBreak: 'break-all',
                            }}
                          >
                            {r.id}
                          </td>
                          <td style={{ padding: '12px' }}>
                            <Pill tone="gray" size="xs">
                              {r.jobName || r.queueName}
                            </Pill>
                          </td>
                          {jobStatusFilter === 'failed' && (
                            <td style={{ padding: '12px' }}>
                              {r.recovered === true ? (
                                <Pill tone="green" size="xs" icon={<CircleCheck size={10} />}>
                                  Recovered
                                </Pill>
                              ) : r.recovered === false ? (
                                <Pill tone="red" size="xs" icon={<AlertTriangle size={10} />}>
                                  Still failing
                                </Pill>
                              ) : (
                                <span style={{ color: 'var(--text-faint)' }}>—</span>
                              )}
                            </td>
                          )}
                          <td
                            style={{
                              padding: '12px',
                              color: 'var(--text-muted)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {r.startedAt ? fmt.dateTime(r.startedAt) : '—'}
                          </td>
                          <td
                            style={{
                              padding: '12px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: 'var(--text)',
                            }}
                          >
                            {r.durationMs == null
                              ? '—'
                              : r.durationMs < 1000
                                ? `${r.durationMs}ms`
                                : `${(r.durationMs / 1000).toFixed(1)}s`}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {r.tasksSynced ?? '—'}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {r.timeEntriesSynced ?? '—'}
                          </td>
                          <td
                            style={{
                              padding: '12px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: errCount > 0 ? 'var(--red)' : 'var(--text-muted)',
                            }}
                          >
                            {errCount}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-faint)' }}>
                            <ChevronRight size={14} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <Pagination
                page={runsPage}
                pageSize={runsPageSize}
                total={jobTotal}
                onPageChange={setRunsPage}
                onPageSizeChange={(s) => { setRunsPageSize(s); setRunsPage(1); }}
              />
            </Card>
          )}
        </div>
      )}

      {activeTab === 'webhooks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <QueryError query={webhookEvents} what="webhook events" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <MetricCard
              dense
              label="Total events (24h)"
              value={webhookStatsLoading ? '—' : fmt.number(webhookStatsTotal)}
              icon={<Activity size={13} />}
            />
            <MetricCard
              dense
              label="Processed"
              value={webhookStatsLoading ? '—' : fmt.number(processedWebhooks.length)}
              sublabel={statItems.length > 0 ? `${processedPct}%` : undefined}
              icon={<CircleCheck size={13} />}
            />
            <MetricCard
              dense
              label="Failed"
              value={webhookStatsLoading ? '—' : fmt.number(failedWebhooks.length)}
              sublabel="needs retry"
              icon={<AlertTriangle size={13} />}
            />
            <MetricCard
              dense
              label="Avg latency"
              value={webhookStatsLoading ? '—' : avgLatencyMs != null ? `${avgLatencyMs}ms` : '—'}
              sublabel={p95LatencyMs != null ? `p95: ${p95LatencyMs}ms` : 'p95: —'}
              icon={<Clock size={13} />}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              padding: 10,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
              <Input
                icon={<Search size={14} />}
                value={webhookSearch}
                onChange={(e) => setWebhookSearch(e.target.value)}
                placeholder="Search event ID, task…"
                aria-label="Search webhook events"
              />
            </div>
            <Select
              ariaLabel="Filter webhooks by status"
              size="md"
              options={WEBHOOK_STATUS_OPTIONS}
              value={webhookStatusFilter}
              onChange={(v) => { setWebhookStatusFilter(v); setWebhooksPage(1); }}
            />
            <Select ariaLabel="Filter webhooks by event type" size="md" options={eventTypeOptions} value={webhookEventFilter} onChange={(v) => { setWebhookEventFilter(v); setWebhooksPage(1); }} />
            {failedWebhooks.length > 0 && (
              <Button
                size="md"
                variant="caution"
                icon={<RefreshCw size={13} />}
                loading={retryFailedWebhooks.isPending}
                onClick={() =>
                  retryFailedWebhooks.mutate(undefined, {
                    onSuccess: (res) => {
                      showBanner(
                        `Re-queued ${res.requeued} failed webhook${res.requeued === 1 ? '' : 's'} — they'll move out of the failed list as workers pick them up.`,
                        'green',
                      );
                    },
                    onError: (err) => {
                      showBanner(`Retry failed: ${(err as Error).message}`, 'red');
                    },
                  })
                }
              >
                Retry all failed
              </Button>
            )}
          </div>

          {webhooksLoading ? (
            <TableSkeleton />
          ) : (
            <Card padding={0}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr
                    style={{
                      background: 'var(--muted-bg)',
                      textTransform: 'uppercase',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      letterSpacing: '0.05em',
                      fontWeight: 600,
                    }}
                  >
                    <th style={{ textAlign: 'left', padding: '10px 16px', width: 80 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px' }}>Event</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px' }}>Task</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px' }}>Received</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px' }}>Latency</th>
                    <th style={{ width: 60, padding: '10px 16px' }} />
                  </tr>
                </thead>
                <tbody>
                  {allWebhookItems.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          icon={<Activity size={20} />}
                          title="No webhook events"
                          body={
                            webhookStatusFilter !== 'all' || webhookEventFilter !== 'all' || debouncedWebhookSearch
                              ? 'No webhook events match these filters.'
                              : 'Incoming ClickUp webhook deliveries will appear here.'
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    allWebhookItems.map((e, i) => {
                      const ok = e.status === 'processed';
                      return (
                        <tr
                          key={e.id}
                          className="row-3d"
                          onClick={() => setSelectedWebhook(e)}
                          tabIndex={0}
                          onKeyDown={onActivate(() => setSelectedWebhook(e))}
                          style={{
                            borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined,
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(ev) => {
                            ev.currentTarget.style.background = 'var(--hover)';
                          }}
                          onMouseLeave={(ev) => {
                            ev.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <td style={{ padding: '10px 16px' }}>
                            {ok ? (
                              <Pill tone="green" size="xs" icon={<CircleCheck size={10} />}>
                                OK
                              </Pill>
                            ) : (
                              <Pill tone="red" size="xs" icon={<X size={10} />}>
                                fail
                              </Pill>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <Pill tone="blue" size="xs">
                              {e.eventType}
                            </Pill>
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: 11,
                              color: 'var(--text)',
                            }}
                          >
                            {e.taskId ?? '—'}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              color: 'var(--text-muted)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {fmt.dateTime(e.receivedAt)}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {webhookLatencyLabel(e)}
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-faint)' }}>
                            <ChevronRight size={14} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <Pagination
                page={webhooksPage}
                pageSize={webhooksPageSize}
                total={webhookTotal}
                onPageChange={setWebhooksPage}
                onPageSizeChange={(s) => { setWebhooksPageSize(s); setWebhooksPage(1); }}
              />
            </Card>
          )}
        </div>
      )}

      {activeTab === 'dead-letters' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <QueryError query={deadLetters} what="dead-letter jobs" />
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, flex: 1, minWidth: 240 }}>
              Jobs that exhausted every retry and fell off their queue.{' '}
              <strong>Retry</strong> re-queues a job onto its original queue;{' '}
              <strong>Resolve</strong> marks it won&rsquo;t-fix and removes it without re-running. The pending count drops as you clear them.
            </p>
            {dlItems.length > 0 && (
              <Button
                size="sm"
                variant="caution"
                icon={<RefreshCw size={12} />}
                loading={retryAllDeadLetters.isPending}
                disabled={retryDeadLetter.isPending || resolveDeadLetter.isPending}
                onClick={() =>
                  retryAllDeadLetters.mutate(undefined, {
                    onSuccess: (r) => showBanner(`Re-queued ${r.requeued} dead-letter job${r.requeued === 1 ? '' : 's'}.`, 'green'),
                    onError: (err) => showBanner(`Retry all failed: ${(err as Error).message}`, 'red'),
                  })
                }
              >
                Retry all ({dlTotal > RETRY_ALL_CAP ? `${RETRY_ALL_CAP} of ${dlTotal}` : dlTotal})
              </Button>
            )}
          </div>
          {deadLetters.isLoading ? (
            <TableSkeleton />
          ) : dlItems.length === 0 ? (
            <Card padding={0}>
              <EmptyState
                icon={<CircleCheck size={20} />}
                title="No dead letters"
                body="Nothing is stuck — every job has succeeded or is still retrying."
              />
            </Card>
          ) : (
            <Card padding={0}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr
                    style={{
                      background: 'var(--muted-bg)',
                      textTransform: 'uppercase',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      letterSpacing: '0.05em',
                      fontWeight: 600,
                    }}
                  >
                    <th style={{ textAlign: 'left', padding: '10px 16px' }}>Job</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px' }}>Entity</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px' }}>Error</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', width: 70 }}>Attempts</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', width: 120 }}>Failed</th>
                    <th style={{ padding: '10px 16px', width: 180 }} />
                  </tr>
                </thead>
                <tbody>
                  {dlItems.map((d, i) => {
                    const retrying = retryDeadLetter.isPending && retryDeadLetter.variables === d.id;
                    const resolving = resolveDeadLetter.isPending && resolveDeadLetter.variables === d.id;
                    const busy = retrying || resolving || retryAllDeadLetters.isPending;
                    return (
                      <tr key={d.id} style={{ borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined }}>
                        <td style={{ padding: '10px 16px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{d.jobName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.queueName}</div>
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                          {[d.entityType, d.entityId].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td
                          style={{ padding: '10px 12px', color: 'var(--text)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={d.errorMessage ?? undefined}
                        >
                          {d.errorMessage ?? '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                          {d.attemptsMade ?? '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                          {fmt.relative(d.failedAt)}
                        </td>
                        <td style={{ padding: '8px 16px' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <Button
                              size="sm"
                              variant="caution"
                              icon={<RefreshCw size={12} />}
                              loading={retrying}
                              disabled={busy}
                              onClick={() =>
                                retryDeadLetter.mutate(d.id, {
                                  onSuccess: () => showBanner(`Re-queued ${d.jobName} onto ${d.queueName}.`, 'green'),
                                  onError: (err) => showBanner(`Retry failed: ${(err as Error).message}`, 'red'),
                                })
                              }
                            >
                              Retry
                            </Button>
                            <Button
                              size="sm"
                              variant="success"
                              loading={resolving}
                              disabled={busy}
                              onClick={() =>
                                resolveDeadLetter.mutate(d.id, {
                                  onSuccess: () => showBanner(`Marked ${d.jobName} resolved.`, 'green'),
                                  onError: (err) => showBanner(`Resolve failed: ${(err as Error).message}`, 'red'),
                                })
                              }
                            >
                              Resolve
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      <SyncRunDrawer item={selectedJob} onClose={() => setSelectedJob(null)} />
      <WebhookEventDrawer item={selectedWebhook} onClose={() => setSelectedWebhook(null)} />
    </div>
  );
}
