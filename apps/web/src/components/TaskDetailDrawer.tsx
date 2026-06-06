import { useState } from 'react';
import { fmt } from '../lib/formatters';
import { Drawer } from './ui/Drawer';
import { Tabs } from './ui/Tabs';
import { Button } from './ui/Button';
import { StatusBadge } from './ui/StatusBadge';
import { Pill } from './ui/Pill';
import { Avatar } from './ui/Avatar';
import { Skeleton } from './ui/Skeleton';
import { MetricCard } from './ui/MetricCard';
import { useTimeEntriesList } from '../hooks/useReports';
import { useSyncTask } from '../hooks/useAdmin';
import { useAuth } from '../hooks/useAuth';

export interface TaskItem {
  [key: string]: unknown;
  taskId: string;
  taskName: string;
  spaceId: string;
  spaceName: string;
  status: string;
  priority: string | null;
  parentTaskId: string | null;
  assigneesNames: string | null;
  assigneesEmails: string | null;
  updatedDate: string | null;
  syncedAt: string | null;
  sprintPoints: number | null;
  cost: number;
  client: string | null;
  department: string | null;
  isDeleted: boolean;
}

interface Props {
  taskId: string | null;
  task?: TaskItem | null;
  onClose: () => void;
}

type TabKey = 'overview' | 'time-entries' | 'raw' | 'sync-history';

const TAB_ITEMS: { value: TabKey; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'time-entries', label: 'Time Entries' },
  { value: 'raw', label: 'Raw' },
  { value: 'sync-history', label: 'Sync History' },
];

function priorityTone(p: string | null): 'red' | 'amber' | 'blue' | 'gray' {
  if (p === 'urgent') return 'red';
  if (p === 'high') return 'amber';
  if (p === 'normal') return 'blue';
  return 'gray';
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontSize: '0.7rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-faint)',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>{children}</span>
    </div>
  );
}

export function TaskDetailDrawer({ taskId, task, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const syncTask = useSyncTask();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');

  const { data: timeData, isLoading: timeLoading } = useTimeEntriesList(
    taskId ? { taskId, limit: 50 } : {},
  );

  const timeItems = (timeData as { items?: {
    timeEntryId: string;
    userName: string;
    startTime: string;
    endTime: string | null;
    durationHours: number;
    costAud: number;
    status: string;
  }[] } | undefined)?.items ?? [];

  const drawerTitle = task?.taskName ?? (taskId ? `Task ${taskId}` : 'Task Detail');

  function handleSync() {
    if (taskId) syncTask.mutate(taskId);
  }

  const headerActions = isAdmin ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Button
        variant="accent"
        size="sm"
        loading={syncTask.isPending}
        disabled={!taskId}
        onClick={handleSync}
      >
        Sync now
      </Button>
    </div>
  ) : null;

  return (
    <Drawer
      open={taskId !== null}
      onClose={onClose}
      title={drawerTitle}
      width={620}
      footer={headerActions}
    >
      {taskId && (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            <Tabs
              items={TAB_ITEMS}
              value={activeTab}
              onChange={setActiveTab}
              variant="underline"
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {/* ─── Overview Tab ─── */}
            {activeTab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {task ? (
                  <>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 16,
                      }}
                    >
                      <MetaRow label="Task ID">
                        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                          {task.taskId}
                        </span>
                      </MetaRow>
                      <MetaRow label="Space">
                        <Pill tone="blue">{task.spaceName}</Pill>
                      </MetaRow>
                      <MetaRow label="Status">
                        <StatusBadge status={task.status} />
                      </MetaRow>
                      <MetaRow label="Priority">
                        <Pill tone={priorityTone(task.priority)}>
                          {task.priority ?? '—'}
                        </Pill>
                      </MetaRow>
                      <MetaRow label="Client">{task.client ?? '—'}</MetaRow>
                      <MetaRow label="Department">{task.department ?? '—'}</MetaRow>
                      <MetaRow label="Sprint Points">
                        {task.sprintPoints !== null ? task.sprintPoints : '—'}
                      </MetaRow>
                      <MetaRow label="Cost">
                        <strong>{fmt.money(task.cost)}</strong>
                      </MetaRow>
                      <MetaRow label="Updated">
                        {task.updatedDate ? fmt.date(task.updatedDate) : '—'}
                      </MetaRow>
                      <MetaRow label="Synced">
                        {task.syncedAt ? fmt.relative(task.syncedAt) : '—'}
                      </MetaRow>
                    </div>

                    {/* KPI strip */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 10,
                        marginTop: 4,
                      }}
                    >
                      <MetricCard
                        dense
                        label="Total Cost"
                        value={fmt.money(task.cost)}
                      />
                      <MetricCard
                        dense
                        label="Sprint Points"
                        value={task.sprintPoints ?? '—'}
                      />
                    </div>

                    {task.isDeleted && (
                      <Pill tone="red">Deleted (soft)</Pill>
                    )}
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Skeleton height={18} />
                    <Skeleton height={18} width="80%" />
                    <Skeleton height={18} width="60%" />
                  </div>
                )}
              </div>
            )}

            {/* ─── Time Entries Tab ─── */}
            {activeTab === 'time-entries' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {timeLoading ? (
                  <>
                    <Skeleton height={56} radius="var(--radius)" />
                    <Skeleton height={56} radius="var(--radius)" />
                    <Skeleton height={56} radius="var(--radius)" />
                  </>
                ) : timeItems.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '32px 0',
                      color: 'var(--text-muted)',
                      fontSize: '0.875rem',
                    }}
                  >
                    No time entries for this task.
                  </div>
                ) : (
                  timeItems.map((entry) => (
                    <div
                      key={entry.timeEntryId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 14px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        background: 'var(--surface)',
                      }}
                    >
                      <Avatar name={entry.userName} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            margin: 0,
                            fontWeight: 600,
                            fontSize: '0.875rem',
                            color: 'var(--text)',
                          }}
                        >
                          {entry.userName}
                        </p>
                        <p
                          style={{
                            margin: 0,
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {fmt.dateTime(entry.startTime)}
                          {entry.endTime ? ` – ${fmt.dateTime(entry.endTime)}` : ''}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                          {fmt.hours(entry.durationHours)}
                        </span>
                        {entry.status === 'NO_RATE_FOUND' ? (
                          <Pill tone="amber">No rate</Pill>
                        ) : (
                          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                            {fmt.money(entry.costAud * 100)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ─── Raw Tab ─── */}
            {activeTab === 'raw' && (
              <pre
                style={{
                  margin: 0,
                  padding: '16px',
                  background: 'var(--surface-alt)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  color: 'var(--text-faint)',
                  overflowX: 'auto',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {task ? JSON.stringify(task, null, 2) : 'No task data available.'}
              </pre>
            )}

            {/* ─── Sync History Tab ─── */}
            {activeTab === 'sync-history' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {task?.syncedAt ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#10b981',
                        flexShrink: 0,
                        marginTop: 4,
                      }}
                    />
                    <div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: 'var(--text)',
                        }}
                      >
                        Last synced
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.8rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {fmt.relative(task.syncedAt)} &mdash;{' '}
                        {fmt.dateTime(task.syncedAt)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '32px 0',
                      color: 'var(--text-muted)',
                      fontSize: '0.875rem',
                    }}
                  >
                    This task has never been synced.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
