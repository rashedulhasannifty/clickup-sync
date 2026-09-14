import { useState, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, CheckSquare, Copy, ExternalLink, CircleCheck } from 'lucide-react';
import { useTaskAssigneeChargeability, useSetAssigneeChargeable } from '../../hooks/useReports';
import { useTaskHistory } from '../../hooks/useTaskHistory';
import { Pill } from '../ui/Pill';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { ClickupAvatar, ClickupAvatarStack } from '../ui/ClickupAvatar';
import { Drawer } from '../ui/Drawer';
import { Markdown } from '../ui/Markdown';
import { Tabs } from '../ui/Tabs';
import { Field } from '../ui/Field';
import { TaskTimeline, type TaskTimelineEvent } from './TaskTimeline';
import { fmt } from '../../lib/formatters';
import { reportsApi } from '../../api/reports';

export type Task = Record<string, unknown>;

/** A task's ClickUp "Sub-Project" labels (a task can carry several). */
export const subProjectsOf = (r: Task): string[] => (Array.isArray(r.subProjects) ? (r.subProjects as string[]) : []);

export function parseAssignees(r: Task): { name: string; email?: string }[] {
  const names = String(r.assigneesNames ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const emails = String(r.assigneesEmails ?? '').split(',').map((s) => s.trim());
  return names.map((name, i) => ({ name, email: emails[i] || undefined }));
}

function MetaGrid({ items }: { items: [string, ReactNode | unknown][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 20px' }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</span>
          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cell(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function cell(v: unknown): ReactNode {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return v as ReactNode;
}

export function TaskDetailDrawer({
  task, onClose, canEdit, onSetChargeable,
}: {
  task: Task | null;
  onClose: () => void;
  canEdit: boolean;
  /** Opens the shared confirmation modal to flip this task's chargeability. */
  onSetChargeable: (taskId: string, next: boolean) => void;
}) {
  const [tab, setTab] = useState('overview');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTab('overview');
    setCopied(false);
  }, [String(task?.taskId ?? task?.task_id ?? '')]);

  const taskIdForHistory = task ? String(task.taskId ?? task.task_id ?? '') : null;
  const history = useTaskHistory(taskIdForHistory || null);
  const { data: assigneeChargeData } = useTaskAssigneeChargeability(taskIdForHistory);
  const setAssigneeChargeable = useSetAssigneeChargeable();

  // Description is fetched on demand (not carried in the paged list/export
  // payload — see taskDescription() in tasks-report.service.ts).
  const descQuery = useQuery({
    queryKey: ['task-description', taskIdForHistory],
    queryFn: () => reportsApi.taskDescription(taskIdForHistory as string),
    enabled: !!taskIdForHistory,
  });

  const historyItems = history.data ?? [];
  const timelineEvents = historyItems.filter((it): it is TaskTimelineEvent => it.kind === 'event');
  const syncJobs = historyItems.filter((it) => it.kind === 'job');

  if (!task) return <Drawer open={false} onClose={onClose} />;

  const assignees = parseAssignees(task);
  const status = String(task.status ?? '');
  const priority = String(task.priority ?? '');
  const priorityTone = priority === 'urgent' ? 'red' : priority === 'high' ? 'amber' : 'gray';
  const archived = !!task.archived;
  // Prefer ClickUp's rich markdown source; fall back to the plain-text
  // description for rows synced before markdown was captured.
  const markdown = String(descQuery.data?.markdownDescription ?? '').trim();
  const description = String(descQuery.data?.description ?? '').trim();
  const descLoading = descQuery.isLoading;
  const taskId = String(task.taskId ?? task.task_id ?? '');
  const assigneeCharge = assigneeChargeData ?? [];
  // Same predicate the server applies for the table's pill
  // (`isPartiallyChargeable`), but computed from the drawer's own live rule
  // list so it survives the optimistic flag patch below: flipping the task
  // flag doesn't refetch this list, and rules are unaffected by that flip.
  // `a.rule` is the raw rule (null = none); `a.chargeable` is the resolved
  // answer, which equals the task flag when no rule exists and so would never
  // disagree on its own.
  const taskChargeable = task.isChargeable !== false;
  const taskPartiallyChargeable = assigneeCharge.some(
    (a) => a.rule !== null && a.rule !== taskChargeable,
  );
  // Prefer the stored ClickUp URL (handles custom domains / task custom ids);
  // fall back to the deterministic task URL when the row predates the `url` select.
  const clickupUrl = String(task.url ?? '') || `https://app.clickup.com/t/${taskId}`;
  const copyTaskId = () => {
    // Only show the "Copied!" confirmation once the write actually resolves —
    // clipboard access can be denied (insecure context, unfocused doc, blocked
    // permission); reporting success we didn't achieve would mislead. Swallow
    // the rejection so it isn't an unhandled promise.
    navigator.clipboard
      ?.writeText(taskId)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <Drawer open width={620} onClose={onClose}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)',
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          }}
          >
            <CheckSquare size={12} strokeWidth={1.75} />
            <span>{taskId}</span>
            <button type="button" title={copied ? 'Copied!' : 'Copy task ID'} onClick={copyTaskId} style={{ border: 0, background: 'transparent', color: copied ? 'var(--green, #10b981)' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}>
              {copied ? <CircleCheck size={11} strokeWidth={1.75} /> : <Copy size={11} strokeWidth={1.75} />}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" variant="default" icon={<ExternalLink size={13} strokeWidth={1.75} />} onClick={() => window.open(clickupUrl, '_blank', 'noopener,noreferrer')}>Open in ClickUp</Button>
            <button
              type="button"
              onClick={onClose}
              className="btn-3d"
              style={{
                width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', borderRadius: 6,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                ['--b-edge' as string]: 'var(--border-strong)',
                ['--b-glow' as string]: 'var(--btn-neutral-glow)',
                ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
              }}
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', margin: '4px 0 10px', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
          {String(task.taskName ?? task.task_name ?? '')}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge status={status} color={task.statusColor as string | undefined} />
          {priority && <Pill tone={priorityTone}>{priority}</Pill>}
          {archived && <Pill tone="gray" size="xs">archived</Pill>}
          <span style={{ flex: 1 }} />
          {task.syncedAt || task.synced_at
            ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Synced {fmt.relative(String(task.syncedAt ?? task.synced_at))}</span>
            : null}
        </div>
      </div>

      <div style={{ padding: '0 20px', flexShrink: 0 }}>
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'overview', label: 'Overview' },
          { value: 'timeline', label: 'Timeline' },
          { value: 'sync', label: 'Sync history' },
          { value: 'raw', label: 'Raw fields' },
        ]}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {(descLoading || markdown || description) && (
              <div>
                <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Description</h3>
                {descLoading
                  ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading description…</div>
                  : markdown
                    ? <Markdown>{markdown}</Markdown>
                    : <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{description}</p>}
              </div>
            )}
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Hierarchy & ownership</h3>
              <MetaGrid items={[
                ['Space', task.spaceName ?? task.space_name],
                ['List', task.listName ?? task.list_name],
                ['Parent task', task.parentTaskId ?? task.parent_task_id ?? '—'],
                ['Creator', task.creatorName ?? task.creator_name],
                ['Assignees', assignees.length > 0 ? <ClickupAvatarStack users={assignees} max={5} /> : '—'],
              ] as [string, ReactNode][]} />
            </div>
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Business</h3>
              <MetaGrid items={[
                ['Client', task.client],
                ['Sub-project', subProjectsOf(task).join(', ') || null],
                ['Department', task.department],
                ['Sprint', task.sprintName ?? task.sprint_name],
                ['Sprint points', task.sprintPoints ?? task.sprint_points],
              ] as [string, ReactNode][]} />
              <div style={{ marginTop: 12 }}>
                <Field label="Chargeable">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {taskPartiallyChargeable
                      ? <Pill tone="blue" size="xs">partial</Pill>
                      : task.isChargeable === false
                        ? <Pill tone="gray" size="xs">non-chargeable</Pill>
                        : <Pill tone="green" size="xs">chargeable</Pill>}
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => onSetChargeable(taskId, task.isChargeable === false)}>
                        {task.isChargeable === false ? 'Mark chargeable' : 'Mark non-chargeable'}
                      </Button>
                    )}
                  </span>
                </Field>
              </div>
              {assigneeCharge.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Field label="Per assignee">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {assigneeCharge.map((a) => (
                        <span key={a.userId} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <ClickupAvatar userId={a.userId} name={a.userName ?? ''} size={18} />
                          <span style={{ fontSize: 12 }}>{a.userName ?? a.userId}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt.duration(a.hours)}</span>
                          {a.chargeable
                            ? <Pill tone="green" size="xs">chargeable</Pill>
                            : <Pill tone="gray" size="xs">non-chargeable</Pill>}
                          {/* Where the answer came from — so "why is this zero?"
                              is answerable without opening the rules screen. */}
                          {a.source === 'assignee' && <Pill tone="gray" size="xs">rule</Pill>}
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAssigneeChargeable.mutate({ taskId, userId: a.userId, chargeable: !a.chargeable })}
                            >
                              {a.chargeable ? 'Mark non-chargeable' : 'Mark chargeable'}
                            </Button>
                          )}
                          {canEdit && a.rule !== null && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAssigneeChargeable.mutate({ taskId, userId: a.userId, chargeable: null })}
                            >
                              Clear rule
                            </Button>
                          )}
                        </span>
                      ))}
                    </div>
                  </Field>
                </div>
              )}
            </div>
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Dates</h3>
              <MetaGrid items={[
                ['Created', task.createdDate || task.created_date ? fmt.date(String(task.createdDate ?? task.created_date)) : '—'],
                ['Updated', task.updatedDate || task.updated_date ? fmt.date(String(task.updatedDate ?? task.updated_date)) : '—'],
                ['Due', task.dueDate || task.due_date ? fmt.date(String(task.dueDate ?? task.due_date)) : '—'],
                ['Synced', task.syncedAt || task.synced_at ? fmt.dateTime(String(task.syncedAt ?? task.synced_at)) : '—'],
              ] as [string, ReactNode][]} />
            </div>
          </div>
        )}
        {tab === 'timeline' && (
          <TaskTimeline events={timelineEvents} loading={history.isLoading} />
        )}
        {tab === 'raw' && (
          <pre style={{
            fontSize: 11, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            background: 'var(--code-bg)', color: 'var(--text)',
            padding: 14, borderRadius: 8, overflow: 'auto', margin: 0,
            border: '1px solid var(--border)', lineHeight: 1.6,
          }}
          >
            {JSON.stringify(task, null, 2)}
          </pre>
        )}
        {tab === 'sync' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--muted-bg)', borderRadius: 8 }}>
              <span style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--pill-green-bg)', color: 'var(--pill-green-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <CircleCheck size={13} strokeWidth={1.75} />
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Sync count: <strong>{String(task.syncCount ?? task.sync_count ?? '—')}</strong></div>
                {(task.syncedAt ?? task.synced_at) != null && String(task.syncedAt ?? task.synced_at) !== '' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Latest at {fmt.dateTime(String(task.syncedAt ?? task.synced_at))}</div>
                )}
              </div>
            </div>
            {history.isLoading ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading activity…</div>
            ) : syncJobs.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No recorded sync jobs yet. Field changes appear under the Timeline tab.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {syncJobs.map((it) => (
                  <div key={it.kind + it.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, background: 'var(--muted-bg)' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: it.kind === 'job' && it.error ? 'var(--red)' : 'var(--text-muted)', minWidth: 52 }}>
                      SYNC
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--text)' }}>
                        {it.kind === 'job' ? `${it.jobName} (${it.queueName}) · ${it.status}` : ''}
                      </div>
                      {it.kind === 'job' && it.error && (
                        <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, wordBreak: 'break-word' }}>{it.error}</div>
                      )}
                      {it.at && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{fmt.relative(it.at)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
