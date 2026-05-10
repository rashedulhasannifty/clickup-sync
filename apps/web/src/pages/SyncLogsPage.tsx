import { useMemo, useState } from 'react';
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
import { useJobLogs, useWebhookEvents } from '../hooks/useReports';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { MetricCard } from '../components/ui/MetricCard';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { SyncRunDrawer } from '../components/SyncRunDrawer';
import type { JobLogItem } from '../components/SyncRunDrawer';
import { WebhookEventDrawer } from '../components/WebhookEventDrawer';
import type { WebhookItem } from '../components/WebhookEventDrawer';
import { fmt } from '../lib/formatters';

const WEBHOOK_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'processed', label: 'Processed' },
  { value: 'failed', label: 'Failed' },
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
  const [activeTab, setActiveTab] = useState('runs');
  const [selectedJob, setSelectedJob] = useState<JobLogItem | null>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookItem | null>(null);
  const [webhookSearch, setWebhookSearch] = useState('');
  const [webhookStatusFilter, setWebhookStatusFilter] = useState('all');
  const [webhookEventFilter, setWebhookEventFilter] = useState('all');

  const jobLogs = useJobLogs({ limit: 50 });
  const webhookEvents = useWebhookEvents({ limit: 50 });

  const jobItems: JobLogItem[] = Array.isArray(jobLogs.data?.items) ? (jobLogs.data!.items as JobLogItem[]) : [];
  const jobTotal = jobLogs.data?.total ?? 0;

  const completedJobs = jobItems.filter((j) => j.status === 'completed');
  const failedJobs = jobItems.filter((j) => j.status === 'failed');

  const latestSuccess = completedJobs
    .filter((j) => j.finishedAt !== null)
    .sort((a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime())[0];

  const latestFailure = failedJobs
    .filter((j) => j.finishedAt !== null)
    .sort((a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime())[0];

  const successRatePct =
    jobItems.length > 0 ? Math.round((jobItems.filter((j) => j.status === 'completed').length / jobItems.length) * 100) : null;

  const allWebhookItems: WebhookItem[] = Array.isArray(webhookEvents.data?.items)
    ? (webhookEvents.data!.items as WebhookItem[])
    : [];
  const webhookTotal = webhookEvents.data?.total ?? 0;

  const processedWebhooks = allWebhookItems.filter((w) => w.status === 'processed');
  const failedWebhooks = allWebhookItems.filter((w) => w.status === 'failed');

  const eventTypeOptions = useMemo(() => {
    const types = [...new Set(allWebhookItems.map((w) => w.eventType).filter(Boolean))];
    return [{ value: 'all', label: 'All events' }, ...types.map((e) => ({ value: e, label: e }))];
  }, [allWebhookItems]);

  const filteredWebhooks = allWebhookItems.filter((w) => {
    if (webhookStatusFilter !== 'all' && w.status !== webhookStatusFilter) return false;
    if (webhookEventFilter !== 'all' && w.eventType !== webhookEventFilter) return false;
    if (webhookSearch) {
      const q = webhookSearch.toLowerCase();
      const hay = `${w.eventType} ${w.taskId ?? ''} ${w.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const processedPct =
    allWebhookItems.length > 0
      ? Math.round((processedWebhooks.length / allWebhookItems.length) * 100)
      : 0;

  const latencySamples = allWebhookItems.map(webhookLatencyMs).filter((n): n is number => n != null);
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
    { value: 'webhooks', label: 'Webhook events', count: webhookTotal > 0 ? webhookTotal : undefined },
  ];

  const runsLoading = jobLogs.isLoading;
  const webhooksLoading = webhookEvents.isLoading;

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
            Trigger sync
          </Button>
        }
      />

      <Tabs items={tabItems} value={activeTab} onChange={setActiveTab} variant="underline" />

      {activeTab === 'runs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
            <MetricCard dense label="Avg duration" value="—" sublabel="last 10 runs" icon={<Clock size={13} />} />
          </div>

          {runsLoading ? (
            <Skeleton height={280} />
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
                      <td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                        No job logs
                      </td>
                    </tr>
                  ) : (
                    jobItems.map((r, i) => {
                      const errCount = r.errorMessage ? 1 : 0;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => setSelectedJob(r)}
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
                          <td
                            style={{
                              padding: '12px',
                              color: 'var(--text-muted)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {r.finishedAt ? fmt.dateTime(r.finishedAt) : '—'}
                          </td>
                          <td
                            style={{
                              padding: '12px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: 'var(--text)',
                            }}
                          >
                            —
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>—</td>
                          <td style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>—</td>
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
            </Card>
          )}
        </div>
      )}

      {activeTab === 'webhooks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <MetricCard
              dense
              label="Total events (24h)"
              value={webhooksLoading ? '—' : fmt.number(webhookTotal)}
              icon={<Activity size={13} />}
            />
            <MetricCard
              dense
              label="Processed"
              value={webhooksLoading ? '—' : fmt.number(processedWebhooks.length)}
              sublabel={allWebhookItems.length > 0 ? `${processedPct}%` : undefined}
              icon={<CircleCheck size={13} />}
            />
            <MetricCard
              dense
              label="Failed"
              value={webhooksLoading ? '—' : fmt.number(failedWebhooks.length)}
              sublabel="needs retry"
              icon={<AlertTriangle size={13} />}
            />
            <MetricCard
              dense
              label="Avg latency"
              value={webhooksLoading ? '—' : avgLatencyMs != null ? `${avgLatencyMs}ms` : '—'}
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
              />
            </div>
            <Select
              size="md"
              options={WEBHOOK_STATUS_OPTIONS}
              value={webhookStatusFilter}
              onChange={setWebhookStatusFilter}
            />
            <Select size="md" options={eventTypeOptions} value={webhookEventFilter} onChange={setWebhookEventFilter} />
            {failedWebhooks.length > 0 && (
              <Button size="md" variant="default" icon={<RefreshCw size={13} />} onClick={() => undefined}>
                Retry all failed
              </Button>
            )}
          </div>

          {webhooksLoading ? (
            <Skeleton height={280} />
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
                    <th style={{ textAlign: 'right', padding: '10px 12px' }}>Attempts</th>
                    <th style={{ width: 60, padding: '10px 16px' }} />
                  </tr>
                </thead>
                <tbody>
                  {filteredWebhooks.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                        No webhook events
                      </td>
                    </tr>
                  ) : (
                    filteredWebhooks.map((e, i) => {
                      const ok = e.status === 'processed';
                      const attempts = 1;
                      return (
                        <tr
                          key={e.id}
                          onClick={() => setSelectedWebhook(e)}
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
                          <td
                            style={{
                              padding: '10px 12px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: attempts > 1 ? 'var(--amber)' : 'var(--text-muted)',
                            }}
                          >
                            {attempts}
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
            </Card>
          )}
        </div>
      )}

      <SyncRunDrawer item={selectedJob} onClose={() => setSelectedJob(null)} />
      <WebhookEventDrawer item={selectedWebhook} onClose={() => setSelectedWebhook(null)} />
    </div>
  );
}
