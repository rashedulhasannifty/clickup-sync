import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Search, Download, X, CheckSquare, Copy, ExternalLink,
  CircleCheck, Inbox,
} from 'lucide-react';
import { useTasks, useTasksAssignees, useTasksSummary, useClients, useLists, useFolders } from '../hooks/useReports';
import { useTaskHistory } from '../hooks/useTaskHistory';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { MultiSelect } from '../components/ui/MultiSelect';
import { DataTable } from '../components/ui/DataTable';
import type { Column } from '../components/ui/DataTable';
import { QueryError } from '../components/ui/QueryError';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ClickupAvatar, ClickupAvatarStack } from '../components/ui/ClickupAvatar';
import { Drawer } from '../components/ui/Drawer';
import { Markdown } from '../components/ui/Markdown';
import { Tabs } from '../components/ui/Tabs';
import { Field } from '../components/ui/Field';
import { TaskTimeline, type TaskTimelineEvent } from '../components/tasks/TaskTimeline';
import { ChargeableConfirmModal } from '../components/ChargeableConfirmModal';
import { fmt } from '../lib/formatters';
import { reportsApi } from '../api/reports';
import { exportXlsx, type XlsxColumn } from '../lib/xlsx';
import { SelectionBar, type SelectionStat } from '../components/SelectionBar';
import { useRowSelection } from '../hooks/useRowSelection';
import { useAuth } from '../hooks/useAuth';

type Task = Record<string, unknown>;

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'Parent + subtasks' },
  { value: 'parent', label: 'Parent only' },
  { value: 'subtask', label: 'Subtasks only' },
];

const ARCHIVED_OPTIONS = [
  { value: 'exclude', label: 'Hide archived' },
  { value: 'include', label: 'Include archived' },
  { value: 'only', label: 'Archived only' },
];

const SPRINT_STATUS_OPTIONS = [
  { value: 'all', label: 'All sprints' },
  { value: 'active', label: 'Active sprints' },
  { value: 'completed', label: 'Completed (archived) sprints' },
];

function parseAssignees(r: Task): { name: string; email?: string }[] {
  const names = String(r.assigneesNames ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const emails = String(r.assigneesEmails ?? '').split(',').map((s) => s.trim());
  return names.map((name, i) => ({ name, email: emails[i] || undefined }));
}

function statusColor(r: Task): string {
  const c = r.statusColor ?? r.status_color;
  if (c && String(c)) return String(c);
  return '#94a3b8';
}

function isOverdue(task: Task): boolean {
  const due = task.dueDate ?? task.due_date;
  if (!due) return false;
  const statusType = String(task.statusType ?? task.status_type ?? '').toLowerCase();
  if (statusType === 'closed') return false;
  const status = String(task.status ?? '').toLowerCase();
  if (status === 'closed' || status === 'complete' || status === 'completed') return false;
  return new Date(String(due)).getTime() < Date.now();
}

function isJustSynced(task: Task): boolean {
  const synced = task.syncedAt ?? task.synced_at;
  if (!synced) return false;
  return Date.now() - new Date(String(synced)).getTime() < 30 * 60 * 1000;
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

function TaskDetailDrawer({
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
                ['Department', task.department],
                ['Sprint', task.sprintName ?? task.sprint_name],
                ['Sprint points', task.sprintPoints ?? task.sprint_points],
              ] as [string, ReactNode][]} />
              <div style={{ marginTop: 12 }}>
                <Field label="Chargeable">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {task.isChargeable === false
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

export function TasksPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const { space, fromDate, toDate } = useGlobalFilters();
  const { data: assigneesData } = useTasksAssignees();
  const { data: summary } = useTasksSummary();
  const { data: listsData } = useLists(space !== 'all' ? space : undefined);
  const { data: foldersData } = useFolders(space !== 'all' ? space : undefined);

  // Debounced search: typing fires `searchRaw` immediately, but the request
  // (and `page=1` reset) only fire after 300ms of quiet, matching TimeEntriesPage.
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [listFilter, setListFilter] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState<string[]>([]);
  const [archivedFilter, setArchivedFilter] = useState('include');
  const [sprintStatus, setSprintStatus] = useState('all');
  const [taskIdsFilter, setTaskIdsFilter] = useState<string[]>([]);
  const isDeepLink = taskIdsFilter.length > 0;
  // Scoped with exactly the filters `taskParams` below sends, so the task count
  // in each dropdown label can't contradict the rows on screen. (The global
  // space/date pickers are the usual culprit: a client with 30 tasks in
  // Projects reads as "(30)" while the R&D Apps table shows nothing.) The
  // deep-link path bypasses space/date there, so it bypasses them here too.
  const { data: clientsData } = useClients({
    spaceId: isDeepLink ? undefined : (space !== 'all' ? space : undefined),
    from: isDeepLink ? undefined : (fromDate || undefined),
    to: isDeepLink ? undefined : (toDate || undefined),
    archived: archivedFilter,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  // Detail drawer selection is local state (like TimeEntriesPage), NOT a URL
  // route. Driving it through `/tasks/:taskId` remounted the page on row click
  // — wiping page/pageSize/filters and leaving the drawer unable to find the
  // clicked row when it lived past page 1 / row 50.
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  // Backs the single confirmation dialog shared by the bulk action and the
  // drawer toggle — `clearSelectionOnApply` only clears the row selection for
  // the bulk path; the drawer's own single-task toggle leaves it alone.
  const [chargeableTarget, setChargeableTarget] = useState<{ taskIds: string[]; chargeable: boolean; clearSelectionOnApply: boolean } | null>(null);
  // Mirror the DataTable's column show/hide state here so CSV export can drop
  // the same hidden columns (keys match the `columns` defs below).
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);

  // Apply ?taskIds= from deep-links (e.g. Missing Rates "Show more" button).
  // Snapshot once on mount and strip the query so back-navigation doesn't
  // re-apply, and so the in-page filter state is the source of truth. We also
  // keep `archivedFilter` on 'include' (the default) so an archived
  // affected-task isn't silently hidden.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const raw = searchParams.get('taskIds');
    if (!raw) return;
    const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTaskIdsFilter(ids);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArchivedFilter('include');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchRaw);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  // A ClickUp list belongs to a single space, so a selection made under one
  // space is meaningless after the topbar space changes — clear it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListFilter([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFolderFilter([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [space]);

  // Source the dropdown from /reports/tasks/assignees, not from
  // time-entries-by-user — otherwise assignees with zero logged hours (e.g.
  // expense-only tasks like Hello Ahmad's) silently disappear from the filter
  // even though their tasks are in the DB.
  const assigneeOptions = useMemo(() => {
    const rows = (Array.isArray(assigneesData) ? assigneesData : []) as { name: string; taskCount?: number }[];
    const seen = new Set<string>();
    // These rows carry only a name (no ClickUp id/email), so the avatar resolves
    // by username — falling back to initials when there's no directory match.
    const opts: { value: string; label: string; icon?: ReactNode }[] = [];
    for (const r of rows) {
      if (!r.name || seen.has(r.name)) continue;
      seen.add(r.name);
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      opts.push({ value: r.name, label: `${r.name}${count}`, icon: <ClickupAvatar name={r.name} size={18} /> });
    }
    return opts;
  }, [assigneesData]);

  const clientOptions = useMemo(() => {
    const rows = (Array.isArray(clientsData) ? clientsData : []) as { client: string; taskCount?: number }[];
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.client) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      seen.add(r.client);
      opts.push({ value: r.client, label: `${r.client}${count}` });
    }
    // Now that the options are scoped, a selected client can drop out of the
    // list entirely (pick a client, then switch space). Keep it as a "(0)"
    // option so the selection stays visible and, more importantly, clearable.
    for (const c of clientFilter) {
      if (!seen.has(c)) opts.push({ value: c, label: `${c} (0)` });
    }
    return opts;
  }, [clientsData, clientFilter]);

  const listOptions = useMemo(() => {
    const rows = (Array.isArray(listsData) ? listsData : []) as { listId: string; listName: string; spaceName?: string | null; taskCount?: number }[];
    const showSpace = space === 'all';
    const opts: { value: string; label: string }[] = [];
    for (const r of rows) {
      if (!r.listId) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      const label = showSpace && r.spaceName ? `${r.spaceName} · ${r.listName}${count}` : `${r.listName}${count}`;
      opts.push({ value: r.listId, label });
    }
    return opts;
  }, [listsData, space]);

  const folderOptions = useMemo(() => {
    const rows = (Array.isArray(foldersData) ? foldersData : []) as { folderId: string; folderName: string; spaceName?: string | null; taskCount?: number }[];
    const showSpace = space === 'all';
    const opts: { value: string; label: string }[] = [];
    for (const r of rows) {
      if (!r.folderId) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      const label = showSpace && r.spaceName ? `${r.spaceName} · ${r.folderName}${count}` : `${r.folderName}${count}`;
      opts.push({ value: r.folderId, label });
    }
    return opts;
  }, [foldersData, space]);

  // Drive status dropdown from actual stored statuses so picking one always matches.
  // ClickUp statuses are list-configured strings — a hardcoded list misses real values
  // (e.g. "to do", "complete") and includes ones that never appear (e.g. "open").
  const statusOptions = useMemo(() => {
    const rows = (summary?.byStatus ?? []) as { status: string | null; count: number }[];
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const s = (r.status ?? '').trim();
      if (!s || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      opts.push({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) });
    }
    return opts;
  }, [summary]);

  const taskParams = useMemo(() => ({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    // Topbar space and date range are intentionally bypassed when a taskIds
    // deep link is active. The user clicked through with an explicit task set
    // (e.g. from Missing Rates); layering an unrelated `updated_date` window
    // on top would silently drop tasks they expected to see.
    spaceId: isDeepLink ? undefined : (space !== 'all' ? space : undefined),
    // Multi-select filters go over the wire comma-separated; an empty selection
    // omits the param entirely, which the backend reads as "no constraint".
    status: statusFilter.length ? statusFilter.join(',') : undefined,
    priority: priorityFilter.length ? priorityFilter.join(',') : undefined,
    type: typeFilter || undefined,
    search: search || undefined,
    assigneeId: assigneeFilter.length ? assigneeFilter.join(',') : undefined,
    client: clientFilter.length ? clientFilter.join(',') : undefined,
    listId: listFilter.length ? listFilter.join(',') : undefined,
    folderId: folderFilter.length ? folderFilter.join(',') : undefined,
    archived: archivedFilter,
    sprintStatus: sprintStatus !== 'all' ? sprintStatus : undefined,
    taskIds: isDeepLink ? taskIdsFilter.join(',') : undefined,
    // Global topbar date range filters by task `updated_date`.
    from: isDeepLink ? undefined : (fromDate || undefined),
    to: isDeepLink ? undefined : (toDate || undefined),
  }), [page, pageSize, isDeepLink, space, statusFilter, priorityFilter, typeFilter, search, assigneeFilter, clientFilter, listFilter, folderFilter, archivedFilter, sprintStatus, taskIdsFilter, fromDate, toDate]);

  const tasksQuery = useTasks(taskParams as Record<string, string | number | undefined>);
  const { data, isLoading } = tasksQuery;

  const items: Task[] = (data?.items ?? []) as Task[];
  const total: number = data?.total ?? 0;

  // Scoped to the FILTERS, not the page — a selection can be built across pages,
  // but a filter change drops it rather than totalling rows the table no longer
  // shows. See useRowSelection for why this is a tag rather than an effect.
  const selectionScope = useMemo(
    () => JSON.stringify({ ...taskParams, limit: undefined, offset: undefined }),
    [taskParams],
  );
  const selection = useRowSelection<Task>(selectionScope);

  // Tasks carry both camelCase and snake_case spellings depending on the query
  // path, exactly as the columns and the export below do.
  const selectionStats: SelectionStat[] = useMemo(() => {
    const num = (row: Task, ...keys: string[]) => {
      for (const k of keys) {
        const v = row[k];
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      }
      return 0;
    };
    const rows = selection.selectedRows;
    const sum = (...keys: string[]) => rows.reduce((n, r) => n + num(r, ...keys), 0);
    const points = sum('sprintPoints', 'sprint_points');
    return [
      { label: 'estimated', value: fmt.hours(sum('timeEstimateHours', 'time_estimate_hours')) },
      { label: 'spent', value: fmt.hours(sum('timeSpentHours', 'time_spent_hours')) },
      ...(points > 0 ? [{ label: 'points', value: fmt.number(points) }] : []),
    ];
  }, [selection.selectedRows]);

  const hasFilters = !!(
    searchRaw || search || statusFilter.length || priorityFilter.length || typeFilter
    || assigneeFilter.length || clientFilter.length || listFilter.length || folderFilter.length
    || archivedFilter !== 'include' || sprintStatus !== 'all' || taskIdsFilter.length > 0
  );

  function reset() {
    setSearchRaw('');
    setSearch('');
    setStatusFilter([]);
    setPriorityFilter([]);
    setTypeFilter('');
    setAssigneeFilter([]);
    setClientFilter([]);
    setListFilter([]);
    setFolderFilter([]);
    setArchivedFilter('include');
    setSprintStatus('all');
    setTaskIdsFilter([]);
    setPage(1);
  }


  // CSV export pulls the full filtered set in one request (not just the current
  // page of 50). Backend `safeLimit` caps at 5000 — enough for the present
  // data volume; if any single space ever exceeds that, the export silently
  // truncates and we'd need to paginate here.
  const exportExcel = useMutation({
    mutationFn: async () => {
      // A selection exports itself: the rows are already in hand, so there's
      // nothing to re-fetch and no chance of the export drifting from the table.
      const items = selection.count > 0
        ? selection.selectedRows
        : (await reportsApi.tasks({ ...taskParams, limit: 5000, offset: 0 })).items;
      // `key` ties a column to its DataTable column so columns hidden via the
      // table's "Columns" menu are dropped here too. Columns with no `key` are
      // export-only (not hideable in the table) and always export.
      const cols: XlsxColumn<Task>[] = [
        { header: 'Task ID',       value: (r) => r.taskId ?? r.task_id },
        { header: 'Task name',     value: (r) => r.taskName ?? r.task_name, key: 'task_name', width: 42 },
        { header: 'Parent task',   value: (r) => r.parentTaskId ?? r.parent_task_id },
        { header: 'Space',         value: (r) => r.spaceName ?? r.space_name, key: 'space_name' },
        { header: 'List',          value: (r) => r.listName ?? r.list_name, key: 'list_name' },
        { header: 'Status',        value: 'status', key: 'status' },
        { header: 'Chargeable',    value: (r) => (r.isChargeable === false ? 'No' : 'Yes'), key: 'chargeable' },
        { header: 'Status type',   value: (r) => r.statusType ?? r.status_type },
        { header: 'Priority',      value: 'priority' },
        { header: 'Assignees',     value: 'assigneesNames', key: 'assignees', width: 30 },
        { header: 'Assignee emails', value: 'assigneesEmails', key: 'assignees', width: 30 },
        { header: 'Client',        value: 'client', key: 'client' },
        { header: 'Department',    value: 'department', key: 'department' },
        { header: 'Sprint',        value: (r) => r.sprintName ?? r.sprint_name, key: 'sprint_name' },
        { header: 'Sprint points', value: (r) => r.sprintPoints ?? r.sprint_points, key: 'sprint_points', type: 'integer' },
        { header: 'Est. hours',    value: (r) => r.timeEstimateHours ?? r.time_estimate_hours, key: 'time_estimate', type: 'number' },
        { header: 'Spent hours',   value: (r) => r.timeSpentHours ?? r.time_spent_hours, key: 'time_spent', type: 'number' },
        { header: 'Created',       value: (r) => r.createdDate ?? r.created_date, type: 'date' },
        { header: 'Updated',       value: (r) => r.updatedDate ?? r.updated_date, key: 'updated_date', type: 'date' },
        { header: 'Due',           value: (r) => r.dueDate ?? r.due_date, type: 'date' },
        { header: 'Closed',        value: (r) => r.closedDate ?? r.closed_date, type: 'date' },
        { header: 'Archived',      value: 'archived' },
        { header: 'Synced',        value: (r) => r.syncedAt ?? r.synced_at, key: 'synced_at', type: 'date' },
      ];
      const visibleCols = cols.filter((c) => !c.key || !hiddenCols.includes(c.key));
      await exportXlsx({ filename: 'tasks', sheetName: 'Tasks', rows: items as Task[], columns: visibleCols });
      return { rows: items.length };
    },
  });

  const columns: Column<Task>[] = useMemo(() => [
    {
      key: 'task_name',
      header: 'Task',
      width: 360,
      render: (r) => {
        const bar = statusColor(r);
        const overdue = isOverdue(r);
        const justSynced = isJustSynced(r);
        const isSubtask = !!(r.parentTaskId || r.parent_task_id);
        const arch = !!r.archived;
        // maxWidth bounds the flex row so a long name truncates instead of
        // widening the column. 336 = column width 360 − cell padding (12+12).
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: 336, overflow: 'hidden', paddingLeft: isSubtask ? 14 : 0 }}>
            {isSubtask && (
              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--text-faint)', flexShrink: 0 }} />
            )}
            <span style={{ width: 4, height: 16, borderRadius: 2, background: bar, flexShrink: 0 }} />
            <span
              title={String(r.taskName ?? r.task_name ?? '')}
              style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontWeight: 500, color: 'var(--text)',
              }}
            >
              {String(r.taskName ?? r.task_name ?? '')}
            </span>
            {arch && <Pill tone="gray" size="xs">archived</Pill>}
            {overdue && <Pill tone="red" size="xs">overdue</Pill>}
            {justSynced && !overdue && <Pill tone="green" size="xs">just synced</Pill>}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (r) => <StatusBadge status={String(r.status ?? '')} color={r.statusColor as string | undefined} />,
    },
    {
      key: 'chargeable',
      header: 'Charge',
      width: 120,
      render: (row) => (
        row.isChargeable === false
          ? <Pill tone="gray" size="xs">non-chargeable</Pill>
          : <Pill tone="green" size="xs">chargeable</Pill>
      ),
    },
    {
      key: 'space_name',
      header: 'Space',
      width: 130,
      render: (r) => {
        const spaceName = String(r.spaceName ?? r.space_name ?? '');
        return spaceName
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{spaceName}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'list_name',
      header: 'List',
      width: 110,
      render: (r) => {
        const listName = String(r.listName ?? r.list_name ?? '');
        return listName
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{listName}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'assignees',
      header: 'Assignees',
      width: 110,
      sortable: false,
      render: (r) => {
        const users = parseAssignees(r);
        return users.length > 0 ? <ClickupAvatarStack users={users} max={3} /> : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'client',
      header: 'Client',
      width: 130,
      render: (r) => {
        const client = String(r.client ?? '');
        return client
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{client}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'department',
      header: 'Dept',
      width: 110,
      render: (r) => {
        const dept = String(r.department ?? '');
        return dept ? <Pill tone="gray" size="xs">{dept}</Pill> : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'sprint_name',
      header: 'Sprint',
      width: 100,
      render: (r) => {
        const sn = String(r.sprintName ?? r.sprint_name ?? '');
        return sn
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sn}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'sprint_points',
      header: 'Pts',
      width: 60,
      align: 'right',
      render: (r) => {
        const pts = r.sprintPoints ?? r.sprint_points;
        return pts != null
          ? <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{String(pts)}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'time_estimate',
      header: 'Est',
      width: 70,
      align: 'right',
      render: (r) => {
        const h = r.timeEstimateHours ?? r.time_estimate_hours;
        if (h == null || Number.isNaN(Number(h))) return <span style={{ color: 'var(--text-faint)' }}>—</span>;
        return <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{fmt.shortHours(Number(h))}</span>;
      },
    },
    {
      key: 'time_spent',
      header: 'Spent',
      width: 70,
      align: 'right',
      render: (r) => {
        const spent = r.timeSpentHours ?? r.time_spent_hours;
        const est = r.timeEstimateHours ?? r.time_estimate_hours;
        if (spent == null || Number.isNaN(Number(spent))) {
          return <span style={{ color: 'var(--text-faint)' }}>—</span>;
        }
        const over = est != null && !Number.isNaN(Number(est)) && Number(spent) > Number(est);
        return (
          <span style={{
            fontVariantNumeric: 'tabular-nums',
            color: over ? 'var(--red)' : 'var(--text)',
            fontWeight: over ? 600 : 500,
          }}
          >
            {fmt.shortHours(Number(spent))}
          </span>
        );
      },
    },
    {
      key: 'updated_date',
      header: 'Updated',
      width: 100,
      align: 'right',
      render: (r) => {
        const d = r.updatedDate ?? r.updated_date;
        return d
          ? <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>{fmt.relative(String(d))}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'synced_at',
      header: 'Synced',
      width: 100,
      align: 'right',
      render: (r) => {
        const d = r.syncedAt ?? r.synced_at;
        return d
          ? <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>{fmt.relative(String(d))}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
  ], []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Tasks"
        description="Audit synced ClickUp tasks and subtasks across all spaces."
        badge={<Pill tone="gray">{fmt.number(total)}</Pill>}
        actions={
          <Button
            variant="subtle"
            size="md"
            icon={<Download size={13} strokeWidth={1.75} />}
            loading={exportExcel.isPending}
            disabled={exportExcel.isPending || isLoading}
            onClick={() => exportExcel.mutate()}
          >
            {selection.count > 0 ? `Export selected (${selection.count})` : 'Export Excel'}
          </Button>
        }
      />

      {taskIdsFilter.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'var(--amber-bg, var(--muted-bg))',
            border: '1px solid var(--amber, var(--border))',
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          <Pill tone="amber" size="xs">deep link</Pill>
          <span style={{ color: 'var(--text)' }}>
            Filtered to {taskIdsFilter.length} specific task{taskIdsFilter.length === 1 ? '' : 's'} from Missing Rates.
            <span style={{ color: 'var(--text-muted)' }}> Topbar space &amp; date range are bypassed. Archived tasks are included.</span>
          </span>
          <span style={{ flex: 1 }} />
          <Button
            size="sm"
            variant="ghost"
            icon={<X size={12} strokeWidth={1.75} />}
            onClick={() => { setTaskIdsFilter([]); setPage(1); }}
          >
            Clear
          </Button>
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}
      >
        <div style={{ flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Input
            icon={<Search size={14} strokeWidth={1.75} />}
            value={searchRaw}
            onChange={e => setSearchRaw(e.target.value)}
            placeholder="Search task name, ID, assignee, client…"
            aria-label="Search tasks"
          />
        </div>
        <MultiSelect ariaLabel="Filter by status" size="md" allLabel="Any status" value={statusFilter} onChange={v => { setStatusFilter(v); setPage(1); }} options={statusOptions} />
        <MultiSelect ariaLabel="Filter by priority" size="md" allLabel="Any priority" value={priorityFilter} onChange={v => { setPriorityFilter(v); setPage(1); }} options={PRIORITY_OPTIONS} />
        <MultiSelect ariaLabel="Filter by assignee" size="md" allLabel="Any assignee" value={assigneeFilter} onChange={v => { setAssigneeFilter(v); setPage(1); }} options={assigneeOptions} />
        <MultiSelect ariaLabel="Filter by client" size="md" allLabel="Any client" value={clientFilter} onChange={v => { setClientFilter(v); setPage(1); }} options={clientOptions} />
        <MultiSelect ariaLabel="Filter by folder" size="md" allLabel="Any folder" value={folderFilter} onChange={v => { setFolderFilter(v); setPage(1); }} options={folderOptions} />
        <MultiSelect ariaLabel="Filter by list" size="md" allLabel="Any list" value={listFilter} onChange={v => { setListFilter(v); setPage(1); }} options={listOptions} />
        <Select ariaLabel="Filter by type" size="md" value={typeFilter} onChange={v => { setTypeFilter(v); setPage(1); }} options={TYPE_OPTIONS} />
        <Select ariaLabel="Filter by archived state" size="md" value={archivedFilter} onChange={v => { setArchivedFilter(v); setPage(1); }} options={ARCHIVED_OPTIONS} />
        <Select ariaLabel="Filter by sprint status" size="md" value={sprintStatus} onChange={v => { setSprintStatus(v); setPage(1); }} options={SPRINT_STATUS_OPTIONS} />
        {hasFilters && (
          <Button size="md" variant="ghost" icon={<X size={13} strokeWidth={1.75} />} onClick={reset}>Reset</Button>
        )}
      </div>

      <SelectionBar
        count={selection.count}
        noun="task"
        stats={selectionStats}
        onClear={selection.clear}
        actions={canEdit ? (
          <>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => setChargeableTarget({
                taskIds: selection.selectedRows.map((r) => String(r.taskId ?? r.task_id ?? '')),
                chargeable: true,
                clearSelectionOnApply: true,
              })}
            >
              Mark chargeable
            </Button>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => setChargeableTarget({
                taskIds: selection.selectedRows.map((r) => String(r.taskId ?? r.task_id ?? '')),
                chargeable: false,
                clearSelectionOnApply: true,
              })}
            >
              Mark non-chargeable
            </Button>
          </>
        ) : undefined}
      />

      <QueryError query={tasksQuery} what="tasks" />

      <DataTable
        layout="design"
        stickyFirstColumn
        rowKey="taskId"
        columns={columns}
        data={items}
        loading={isLoading}
        emptyTitle="No tasks match your filters"
        emptyBody="Try clearing filters or expanding the date range."
        emptyIcon={<Inbox size={20} strokeWidth={1.75} />}
        emptyAction={<Button variant="default" size="md" onClick={reset}>Clear all filters</Button>}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={p => setPage(p)}
        onPageSizeChange={n => { setPageSize(n); setPage(1); }}
        pageSizeOptions={[10, 25, 50, 100]}
        onRowClick={(r) => setSelectedTask(r)}
        initialSort={{ key: 'updated_date', dir: 'desc' }}
        hiddenColumns={hiddenCols}
        onHiddenColumnsChange={setHiddenCols}
        selectedKeys={selection.selectedKeys}
        onToggleRow={selection.toggleRow}
        onTogglePage={selection.togglePage}
      />

      <TaskDetailDrawer
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        canEdit={canEdit}
        onSetChargeable={(taskId, next) => setChargeableTarget({ taskIds: [taskId], chargeable: next, clearSelectionOnApply: false })}
      />

      {chargeableTarget && (
        <ChargeableConfirmModal
          taskIds={chargeableTarget.taskIds}
          chargeable={chargeableTarget.chargeable}
          onClose={(changed) => {
            const { taskIds, chargeable, clearSelectionOnApply } = chargeableTarget;
            setChargeableTarget(null);
            if (!changed) return;
            if (clearSelectionOnApply) selection.clear();
            // The drawer's snapshot of the task predates the change — patch it
            // in place so a still-open drawer doesn't show a stale flag/button.
            setSelectedTask((prev) => {
              if (!prev) return prev;
              const id = String(prev.taskId ?? prev.task_id ?? '');
              return taskIds.includes(id) ? { ...prev, isChargeable: chargeable } : prev;
            });
          }}
        />
      )}
    </div>
  );
}
