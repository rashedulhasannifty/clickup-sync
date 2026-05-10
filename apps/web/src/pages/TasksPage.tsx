import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTasks } from '../hooks/useReports';
import { fmt } from '../lib/formatters';
import { PageHeader } from '../components/ui/PageHeader';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Pill } from '../components/ui/Pill';
import type { Column } from '../components/ui/DataTable';
import { DataTable } from '../components/ui/DataTable';
import { TaskDetailDrawer } from '../components/TaskDetailDrawer';
import type { TaskItem } from '../components/TaskDetailDrawer';

const PAGE_SIZE = 50;

const SPACE_OPTIONS = [
  { value: '', label: 'All Spaces' },
  { value: '3577824', label: 'Digital Marketing' },
  { value: '3589129', label: 'R&D Apps' },
  { value: '3525433', label: 'Projects' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'in progress', label: 'In Progress' },
  { value: 'open', label: 'Open' },
  { value: 'complete', label: 'Complete' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'parent', label: 'Parent Only' },
  { value: 'subtask', label: 'Subtask Only' },
];

function priorityTone(p: string | null): 'red' | 'amber' | 'blue' | 'gray' {
  if (p === 'urgent') return 'red';
  if (p === 'high') return 'amber';
  if (p === 'normal') return 'blue';
  return 'gray';
}

const selectStyle: React.CSSProperties = {
  padding: '6px 28px 6px 10px',
  fontSize: '0.875rem',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--surface)',
  color: 'var(--text)',
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat' as const,
  backgroundPosition: 'right 8px center',
};

export function TasksPage() {
  const { taskId: urlTaskId } = useParams<{ taskId?: string }>();

  const [page, setPage] = useState(1);
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [type, setType] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(urlTaskId ?? null);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);

  // Debounce search 300ms
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchRaw);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  // Open drawer from URL param on mount
  useEffect(() => {
    if (urlTaskId) {
      setSelectedTaskId(urlTaskId);
    }
  }, [urlTaskId]);

  const params: Record<string, string | number | undefined> = {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    search: search || undefined,
    status: status || undefined,
    priority: priority || undefined,
    type: (type as 'parent' | 'subtask' | '') || undefined,
    spaceId: spaceId || undefined,
  };

  const { data, isLoading } = useTasks(params);

  const items: TaskItem[] = (data as { items?: TaskItem[] } | undefined)?.items ?? [];
  const total: number = (data as { total?: number } | undefined)?.total ?? 0;

  const anyFilterActive =
    search !== '' || status !== '' || priority !== '' || type !== '' || spaceId !== '';

  function handleClear() {
    setSearchRaw('');
    setSearch('');
    setStatus('');
    setPriority('');
    setType('');
    setSpaceId('');
    setPage(1);
  }

  const columns: Column<TaskItem>[] = [
    {
      key: 'taskName',
      header: 'Task Name',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {row.parentTaskId !== null && (
            <span
              style={{
                color: 'var(--text-faint)',
                marginLeft: 12,
                fontSize: '0.9em',
              }}
            >
              ↳
            </span>
          )}
          <span
            style={{
              color: 'var(--text)',
              fontSize: '0.875rem',
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'inline-block',
            }}
            title={row.taskName}
          >
            {row.taskName}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'spaceName',
      header: 'Space',
      render: (row) => <Pill tone="blue">{row.spaceName}</Pill>,
    },
    {
      key: 'client',
      header: 'Client',
      render: (row) => <Pill tone="gray">{row.client ?? '—'}</Pill>,
    },
    {
      key: 'assigneesNames',
      header: 'Assignees',
      render: (row) => {
        if (!row.assigneesNames) return <span style={{ color: 'var(--text-faint)' }}>—</span>;
        const names = row.assigneesNames.split(',').map((n) => n.trim()).filter(Boolean);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {names.slice(0, 2).map((name, i) => (
              <span key={i} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {name}
                {i < Math.min(names.length, 2) - 1 ? ',' : ''}
              </span>
            ))}
            {names.length > 2 && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                +{names.length - 2}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (row) => (
        <Pill tone={priorityTone(row.priority)}>{row.priority ?? '—'}</Pill>
      ),
    },
    {
      key: 'cost',
      header: 'Cost',
      render: (row) => <strong>{fmt.money(row.cost)}</strong>,
      sortable: true,
    },
    {
      key: 'updatedDate',
      header: 'Updated',
      render: (row) => (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {row.updatedDate ? fmt.relative(row.updatedDate) : '—'}
        </span>
      ),
      sortable: true,
    },
  ];

  function handleRowClick(row: TaskItem) {
    setSelectedTaskId(row.taskId);
    setSelectedTask(row);
  }

  function handleClose() {
    setSelectedTaskId(null);
    setSelectedTask(null);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24 }}>
      <PageHeader title="Tasks" />

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ minWidth: 200, flex: '1 1 200px' }}>
          <Input
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder="Search tasks..."
          />
        </div>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          style={selectStyle}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value);
            setPage(1);
          }}
          style={selectStyle}
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          style={selectStyle}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={spaceId}
          onChange={(e) => {
            setSpaceId(e.target.value);
            setPage(1);
          }}
          style={selectStyle}
        >
          {SPACE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {anyFilterActive && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <DataTable<TaskItem>
        columns={columns}
        data={items}
        loading={isLoading}
        onRowClick={handleRowClick}
        emptyTitle="No tasks found"
        emptyBody="Try adjusting your filters."
        pageSize={PAGE_SIZE}
        total={total}
        page={page}
        onPageChange={setPage}
      />

      <TaskDetailDrawer
        taskId={selectedTaskId}
        task={selectedTask}
        onClose={handleClose}
      />
    </div>
  );
}
