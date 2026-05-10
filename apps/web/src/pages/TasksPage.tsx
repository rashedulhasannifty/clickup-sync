import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Search, Download, RefreshCw, X, CheckSquare, Copy, ExternalLink,
  CircleCheck,
} from 'lucide-react';
import { useTasks } from '../hooks/useReports';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { DataTable } from '../components/ui/DataTable';
import type { Column } from '../components/ui/DataTable';
import { StatusBadge } from '../components/ui/StatusBadge';
import { AvatarStack } from '../components/ui/Avatar';
import { Drawer } from '../components/ui/Drawer';
import { Tabs } from '../components/ui/Tabs';
import { fmt } from '../lib/formatters';

type Task = Record<string, unknown>;

const SPACE_COLOR_MAP: Record<string, string> = {
  'digital marketing': '#FF02F0',
  'r&d apps': '#7B68EE',
  'projects': '#49CCF9',
};

const DEPT_TONE_MAP: Record<string, 'blue' | 'purple' | 'green' | 'amber' | 'red' | 'gray'> = {
  engineering: 'blue',
  design: 'purple',
  marketing: 'purple',
  operations: 'green',
  product: 'amber',
  finance: 'gray',
  qa: 'red',
};

function getSpaceColor(spaceName: string): string {
  return SPACE_COLOR_MAP[spaceName?.toLowerCase()] ?? '#94a3b8';
}

function getDeptTone(dept: string): 'blue' | 'purple' | 'green' | 'amber' | 'red' | 'gray' {
  return DEPT_TONE_MAP[dept?.toLowerCase()] ?? 'gray';
}

function isOverdue(task: Task): boolean {
  const due = task.dueDate ?? task.due_date;
  if (!due) return false;
  const status = String(task.status ?? '').toLowerCase();
  if (status === 'closed' || status === 'complete' || status === 'completed') return false;
  return new Date(String(due)).getTime() < Date.now();
}

function isJustSynced(task: Task): boolean {
  const synced = task.syncedAt ?? task.synced_at;
  if (!synced) return false;
  return Date.now() - new Date(String(synced)).getTime() < 5 * 60 * 1000;
}

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'open', label: 'Open' },
  { value: 'in progress', label: 'In progress' },
  { value: 'in review', label: 'In review' },
  { value: 'closed', label: 'Closed' },
  { value: 'blocked', label: 'Blocked' },
];
const PRIORITY_OPTIONS = [
  { value: '', label: 'Any priority' },
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
  { value: '', label: 'All tasks' },
  { value: 'hide', label: 'Hide archived' },
];

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

function TaskDetailDrawer({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const [tab, setTab] = useState('overview');

  if (!task) return <Drawer open={false} onClose={onClose} />;

  const assignees = (task.assignees as { name: string; color?: string }[] | undefined) ?? [];
  const status = String(task.status ?? '');
  const priority = String(task.priority ?? '');
  const priorityTone = priority === 'urgent' ? 'red' : priority === 'high' ? 'amber' : 'gray';

  return (
    <Drawer open={true} onClose={onClose} width={620}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
            <CheckSquare size={12} />
            <span>{String(task.taskId ?? task.task_id ?? '')}</span>
            <button style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}>
              <Copy size={11} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" variant="default" icon={<ExternalLink size={13} />}>Open in ClickUp</Button>
            <button onClick={onClose} style={{ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={14} />
            </button>
          </div>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', margin: '4px 0 10px', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
          {String(task.taskName ?? task.task_name ?? '')}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge status={status} color={task.statusColor as string | undefined} />
          {priority && <Pill tone={priorityTone}>{priority}</Pill>}
          <span style={{ flex: 1 }} />
          {task.syncedAt || task.synced_at
            ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Synced {fmt.relative(String(task.syncedAt ?? task.synced_at))}</span>
            : null}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: '0 20px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'overview', label: 'Overview' },
          { value: 'raw', label: 'Raw fields' },
          { value: 'sync', label: 'Sync history' },
        ]} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Hierarchy & ownership</h3>
              <MetaGrid items={[
                ['Space', task.spaceName ?? task.space_name],
                ['List', task.listName ?? task.list_name],
                ['Parent task', task.parentTaskId ?? task.parent_task_id ?? '—'],
                ['Creator', task.creatorName ?? task.creator_name],
                ['Assignees', assignees.length > 0 ? <AvatarStack users={assignees} max={5} /> : '—'],
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
        {tab === 'raw' && (
          <pre style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', background: 'var(--muted-bg)', color: 'var(--text)', padding: 14, borderRadius: 8, overflow: 'auto', margin: 0, border: '1px solid var(--border)', lineHeight: 1.6 }}>
            {JSON.stringify(task, null, 2)}
          </pre>
        )}
        {tab === 'sync' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--muted-bg)', borderRadius: 8 }}>
              <span style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--pill-green-bg)', color: 'var(--pill-green-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <CircleCheck size={13} />
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Sync count: <strong>{String(task.syncCount ?? task.sync_count ?? '—')}</strong></div>
                {(task.syncedAt ?? task.synced_at) != null && String(task.syncedAt ?? task.synced_at) !== '' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Latest at {fmt.dateTime(String(task.syncedAt ?? task.synced_at))}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

const ASSIGNEE_OPTIONS = [
  { value: '', label: 'Any assignee' },
];

export function TasksPage() {
  const navigate = useNavigate();
  const { taskId } = useParams();
  const { space } = useGlobalFilters();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [hideArchived, setHideArchived] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useTasks({
    page,
    limit: 50,
    spaceId: space !== 'all' ? space : undefined,
    status: statusFilter || undefined,
    priority: priorityFilter || undefined,
    type: typeFilter || undefined,
    search: search || undefined,
  });

  const items: Task[] = (data?.items ?? data ?? []) as Task[];
  const total: number = data?.total ?? items.length;

  const openTask = taskId ? (items.find((t) => String(t.taskId ?? t.task_id) === taskId) ?? null) : null;

  const hasFilters = !!(search || statusFilter || priorityFilter || typeFilter || assigneeFilter || hideArchived);
  function reset() {
    setSearch(''); setStatusFilter(''); setPriorityFilter(''); setTypeFilter('');
    setAssigneeFilter(''); setHideArchived(''); setPage(1);
  }

  const columns: Column<Task>[] = [
    {
      key: 'task_name',
      header: 'Task',
      width: '340px',
      render: (r) => {
        const spaceName = String(r.spaceName ?? r.space_name ?? '');
        const barColor = getSpaceColor(spaceName);
        const overdue = isOverdue(r);
        const justSynced = isJustSynced(r);
        const isSubtask = !!(r.parentTaskId || r.parent_task_id);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 999, background: barColor, flexShrink: 0 }} />
            {isSubtask && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--text-faint)', flexShrink: 0, marginLeft: 6 }} />}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, fontSize: 13 }}>
              {String(r.taskName ?? r.task_name ?? '')}
            </span>
            {overdue && <span style={{ flexShrink: 0 }}><Pill tone="red">Overdue</Pill></span>}
            {justSynced && !overdue && <span style={{ flexShrink: 0 }}><Pill tone="green">Synced</Pill></span>}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (r) => <StatusBadge status={String(r.status ?? '')} color={r.statusColor as string | undefined} />,
    },
    {
      key: 'space_name',
      header: 'Space',
      width: '110px',
      render: (r) => {
        const spaceName = String(r.spaceName ?? r.space_name ?? '');
        return spaceName
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{spaceName}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'list_name',
      header: 'List',
      width: '110px',
      render: (r) => {
        const listName = String(r.listName ?? r.list_name ?? '');
        return listName
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{listName}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'assignees',
      header: 'Assignees',
      width: '90px',
      render: (r) => {
        const users = (r.assignees as { name: string; color?: string }[] | undefined) ?? [];
        return users.length > 0 ? <AvatarStack users={users} max={3} /> : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'client',
      header: 'Client',
      width: '110px',
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
      width: '100px',
      render: (r) => {
        const dept = String(r.department ?? '');
        return dept
          ? <Pill tone={getDeptTone(dept)}>{dept}</Pill>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'estimation',
      header: 'Est',
      width: '70px',
      render: (r) => {
        const est = r.estimation;
        return est != null && est !== ''
          ? <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{String(est)}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'spent',
      header: 'Spent',
      width: '70px',
      render: () => <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'updated_date',
      header: 'UP',
      width: '80px',
      render: (r) => {
        const d = r.updatedDate ?? r.updated_date;
        return d
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt.relative(String(d))}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
    {
      key: 'sprint_points',
      header: 'SP',
      width: '50px',
      render: (r) => {
        const pts = r.sprintPoints ?? r.sprint_points;
        return pts != null
          ? <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 13 }}>{String(pts)}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>;
      },
    },
  ];

  const titleText = total > 0
    ? <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>Tasks <span style={{ fontSize: '0.75em', fontWeight: 500, color: 'var(--text-muted)' }}>{items.length}/{total}</span></span>
    : 'Tasks';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title={titleText}
        description="Audit synced ClickUp tasks and subtasks across all spaces."
        actions={
          <>
            <Button variant="default" size="md" icon={<Download size={13} />}>Export CSV</Button>
            <Button variant="accent" size="md" icon={<RefreshCw size={13} />}>Sync now</Button>
          </>
        }
      />

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div style={{ flex: 1, minWidth: 200, maxWidth: 300 }}>
          <Input icon={<Search size={14} />} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search task name, ID…" />
        </div>
        <Select value={typeFilter} onChange={setTypeFilter} options={TYPE_OPTIONS} />
        <Select value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
        <Select value={priorityFilter} onChange={setPriorityFilter} options={PRIORITY_OPTIONS} />
        <Select value={assigneeFilter} onChange={setAssigneeFilter} options={ASSIGNEE_OPTIONS} />
        <Select value={hideArchived} onChange={setHideArchived} options={ARCHIVED_OPTIONS} />
        {hasFilters && (
          <Button size="md" variant="ghost" icon={<X size={13} />} onClick={reset}>Reset</Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={items}
        loading={isLoading}
        emptyTitle="No tasks match your filters"
        emptyBody="Try clearing filters or expanding the date range."
        total={total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        onRowClick={(r) => navigate(`/tasks/${String(r.taskId ?? r.task_id)}`)}
      />

      <TaskDetailDrawer task={openTask} onClose={() => navigate('/tasks')} />
    </div>
  );
}
