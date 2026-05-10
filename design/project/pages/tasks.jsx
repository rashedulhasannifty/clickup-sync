// Page: Tasks Explorer + Detail Drawer

function TasksPage({ navigate, openTaskId, onCloseTask }) {
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [priorityFilter, setPriorityFilter] = React.useState('all');
  const [assigneeFilter, setAssigneeFilter] = React.useState('all');
  const [archivedFilter, setArchivedFilter] = React.useState('exclude');
  const [taskTypeFilter, setTaskTypeFilter] = React.useState('all');
  const filters = useFilters();

  const filtered = React.useMemo(() => {
    return window.MOCK.TASKS.filter(t => {
      if (filters.space !== 'all' && t.space_id !== filters.space) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (assigneeFilter !== 'all' && !t.assignees.some(a => a.id === assigneeFilter)) return false;
      if (archivedFilter === 'exclude' && t.archived) return false;
      if (archivedFilter === 'only' && !t.archived) return false;
      if (taskTypeFilter === 'parent' && t.parent_task_id) return false;
      if (taskTypeFilter === 'subtask' && !t.parent_task_id) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${t.task_name} ${t.task_id} ${t.client} ${t.department} ${t.assignees.map(a => a.name).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [search, statusFilter, priorityFilter, assigneeFilter, archivedFilter, taskTypeFilter, filters.space]);

  const openTask = openTaskId ? window.MOCK.TASKS.find(t => t.task_id === openTaskId) : null;

  const reset = () => {
    setSearch(''); setStatusFilter('all'); setPriorityFilter('all');
    setAssigneeFilter('all'); setArchivedFilter('exclude'); setTaskTypeFilter('all');
  };
  const hasFilters = search || statusFilter !== 'all' || priorityFilter !== 'all' || assigneeFilter !== 'all' || archivedFilter !== 'exclude' || taskTypeFilter !== 'all';

  const columns = [
    {
      key: 'task_name',
      header: 'Task',
      width: 360,
      cell: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, paddingLeft: r.parent_task_id ? 14 : 0 }}>
          {r.parent_task_id && <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--text-faint)', flexShrink: 0 }}/>}
          <span style={{ width: 4, height: 16, borderRadius: 2, background: r.status_color, flexShrink: 0 }}/>
          <span style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontWeight: 500, color: 'var(--text)',
          }}>{r.task_name}</span>
          {r.archived && <Pill tone="gray" size="xs">archived</Pill>}
          {(() => {
            const due = new Date(r.due_date).getTime();
            const overdue = due < Date.now() && r.status_type !== 'closed';
            return overdue ? <Pill tone="red" size="xs">overdue</Pill> : null;
          })()}
          {(Date.now() - new Date(r.synced_at).getTime()) < 30 * 60_000 && <Pill tone="green" size="xs">just synced</Pill>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', width: 120, cell: (r) => <StatusBadge status={r.status} color={r.status_color}/> },
    { key: 'space_name', header: 'Space', width: 130, cell: (r) => <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.space_name}</span> },
    { key: 'list_name', header: 'List', width: 110, cell: (r) => <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.list_name}</span> },
    { key: 'assignees', header: 'Assignees', width: 110, sortable: false, cell: (r) => <AvatarStack users={r.assignees} max={3}/> },
    { key: 'client', header: 'Client', width: 130, cell: (r) => <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.client}</span> },
    { key: 'department', header: 'Dept', width: 110, cell: (r) => <Pill tone="gray" size="xs">{r.department}</Pill> },
    { key: 'sprint_name', header: 'Sprint', width: 100, cell: (r) => <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.sprint_name}</span> },
    { key: 'sprint_points', header: 'Pts', width: 60, align: 'right', cell: (r) => r.sprint_points != null ? <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.sprint_points}</span> : <span style={{ color: 'var(--text-faint)' }}>—</span> },
    { key: 'time_estimate', header: 'Est', width: 70, align: 'right', cell: (r) => <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{fmt.shortHours(r.time_estimate)}</span> },
    { key: 'time_spent', header: 'Spent', width: 70, align: 'right', cell: (r) => {
      const over = r.time_spent > r.time_estimate;
      return <span style={{ fontVariantNumeric: 'tabular-nums', color: over ? 'var(--red)' : 'var(--text)', fontWeight: over ? 600 : 500 }}>{fmt.shortHours(r.time_spent)}</span>;
    } },
    { key: 'updated_date', header: 'Updated', width: 100, align: 'right', cell: (r) => <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>{fmt.relative(r.updated_date)}</span> },
    { key: 'synced_at', header: 'Synced', width: 100, align: 'right', cell: (r) => <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>{fmt.relative(r.synced_at)}</span> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Tasks"
        description="Audit synced ClickUp tasks and subtasks across all spaces."
        badge={<Pill tone="gray">{fmt.number(filtered.length)} of {fmt.number(window.MOCK.TASKS.length)}</Pill>}
        actions={
          <>
            <Button variant="default" size="md" icon={<Icons.Download size={13}/>}>Export CSV</Button>
            <Button variant="accent" size="md" icon={<Icons.RefreshCw size={13}/>}>Sync now</Button>
          </>
        }
      />

      {/* Filter bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}>
        <div style={{ flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Input icon={<Icons.Search size={14}/>} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search task name, ID, assignee, client…"/>
        </div>
        <Select size="md" value={statusFilter} onChange={setStatusFilter} options={[
          { value: 'all', label: 'Any status' },
          ...window.MOCK.STATUSES.map(s => ({ value: s.name, label: s.name })),
        ]}/>
        <Select size="md" value={priorityFilter} onChange={setPriorityFilter} options={[
          { value: 'all', label: 'Any priority' },
          ...window.MOCK.PRIORITIES.map(p => ({ value: p, label: p })),
        ]}/>
        <Select size="md" value={assigneeFilter} onChange={setAssigneeFilter} options={[
          { value: 'all', label: 'Any assignee' },
          ...window.MOCK.ASSIGNEES.map(a => ({ value: a.id, label: a.name })),
        ]}/>
        <Select size="md" value={taskTypeFilter} onChange={setTaskTypeFilter} options={[
          { value: 'all', label: 'Parent + subtasks' },
          { value: 'parent', label: 'Parent only' },
          { value: 'subtask', label: 'Subtasks only' },
        ]}/>
        <Select size="md" value={archivedFilter} onChange={setArchivedFilter} options={[
          { value: 'exclude', label: 'Hide archived' },
          { value: 'include', label: 'Include archived' },
          { value: 'only', label: 'Archived only' },
        ]}/>
        {hasFilters && <Button size="md" variant="ghost" onClick={reset} icon={<Icons.X size={13}/>}>Reset</Button>}
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        rowKey="task_id"
        onRowClick={(r) => navigate(`/tasks/${r.task_id}`)}
        stickyFirst
        emptyState={
          <EmptyState
            icon={<Icons.Inbox size={20}/>}
            title="No tasks match your filters"
            body="Try clearing filters or expanding the date range."
            action={<Button onClick={reset}>Clear all filters</Button>}
          />
        }
      />

      <TaskDetailDrawer task={openTask} onClose={onCloseTask} navigate={navigate}/>
    </div>
  );
}

function TaskDetailDrawer({ task, onClose, navigate }) {
  const [tab, setTab] = React.useState('overview');
  React.useEffect(() => { setTab('overview'); }, [task?.task_id]);
  const taskTimeEntries = React.useMemo(() =>
    task ? window.MOCK.TIME_ENTRIES.filter(te => te.task_id === task.task_id) : [],
  [task]);
  if (!task) return <Drawer open={false} onClose={onClose}/>;

  const totalHours = taskTimeEntries.reduce((s, te) => s + te.duration_hours, 0);
  const totalCost = taskTimeEntries.reduce((s, te) => s + (te.cost_cents || 0), 0);
  const missingCost = taskTimeEntries.filter(te => !te.cost_cents).length;

  return (
    <Drawer open={!!task} onClose={onClose} width={620}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' }}>
            <Icons.CheckSquare size={12}/>
            <span>{task.task_id}</span>
            <button style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }} title="Copy task ID">
              <Icons.Copy size={11}/>
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" variant="default" icon={<Icons.ExternalLink size={13}/>}>Open in ClickUp</Button>
            <button onClick={onClose} style={{ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icons.X size={14}/>
            </button>
          </div>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', margin: '4px 0 10px', lineHeight: 1.3, letterSpacing: '-0.01em' }}>{task.task_name}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge status={task.status} color={task.status_color}/>
          <Pill tone={task.priority === 'urgent' ? 'red' : task.priority === 'high' ? 'amber' : 'gray'}>{task.priority}</Pill>
          {task.archived && <Pill tone="gray">archived</Pill>}
          <span style={{ flex: 1 }}/>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Synced {fmt.relative(task.synced_at)}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: '0 20px', flexShrink: 0 }}>
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'overview', label: 'Overview' },
          { value: 'time', label: 'Time entries', count: taskTimeEntries.length },
          { value: 'raw', label: 'Raw fields' },
          { value: 'sync', label: 'Sync history' },
        ]}/>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {tab === 'overview' && <TaskOverviewTab task={task} totalHours={totalHours} totalCost={totalCost} missingCost={missingCost}/>}
        {tab === 'time' && <TaskTimeTab entries={taskTimeEntries}/>}
        {tab === 'raw' && <TaskRawTab task={task}/>}
        {tab === 'sync' && <TaskSyncTab task={task}/>}
      </div>
    </Drawer>
  );
}

function MetaGrid({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 20px' }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</span>
          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}</span>
        </div>
      ))}
    </div>
  );
}

function TaskOverviewTab({ task, totalHours, totalCost, missingCost }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Hierarchy & ownership</h3>
        <MetaGrid items={[
          ['Space', task.space_name],
          ['Folder', task.folder_name],
          ['List', task.list_name],
          ['Parent task', task.parent_task_id || '—'],
          ['Creator', task.creator_name],
          ['Executive', task.executive_name],
          ['Assignees', <AvatarStack users={task.assignees} max={5}/>],
          ['Watchers', '2 people'],
        ]}/>
      </div>

      <div>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Business</h3>
        <MetaGrid items={[
          ['Client', task.client],
          ['Department', task.department],
          ['Sprint', task.sprint_name],
          ['Sprint points', task.sprint_points],
          ['Estimation', fmt.money(task.estimation)],
          ['Cost', fmt.money(task.cost)],
        ]}/>
      </div>

      <div>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Time tracking</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div style={{ padding: 12, background: 'var(--muted-bg)', borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estimate</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(task.time_estimate)}</div>
          </div>
          <div style={{ padding: 12, background: 'var(--muted-bg)', borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Logged</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(totalHours)}</div>
          </div>
          <div style={{ padding: 12, background: 'var(--muted-bg)', borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cost</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt.money(totalCost)}</div>
          </div>
        </div>
        {missingCost > 0 && (
          <div style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 8,
            background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
            fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Icons.AlertTriangle size={14}/>
            <span><strong>{missingCost} entries</strong> missing rate calculation.</span>
          </div>
        )}
      </div>

      <div>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Dates</h3>
        <MetaGrid items={[
          ['Created', fmt.date(task.created_date)],
          ['Updated', fmt.date(task.updated_date)],
          ['Start', fmt.date(task.start_date)],
          ['Due', fmt.date(task.due_date)],
          ['Closed', task.closed_date ? fmt.date(task.closed_date) : '—'],
          ['Synced', fmt.dateTime(task.synced_at)],
        ]}/>
      </div>
    </div>
  );
}

function TaskTimeTab({ entries }) {
  if (entries.length === 0) {
    return <EmptyState icon={<Icons.Clock size={18}/>} title="No time entries yet" body="When users log time on this task, entries appear here."/>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(te => (
        <div key={te.time_entry_id} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          border: '1px solid var(--border)', borderRadius: 8,
        }}>
          <Avatar user={te.user} size={28}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{te.user_name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {fmt.shortDate(te.start_time)} · {fmt.time(te.start_time)} → {fmt.time(te.end_time)} · {te.billable ? 'billable' : 'non-billable'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{fmt.hours(te.duration_hours)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{te.cost_cents ? fmt.money(te.cost_cents) : <Pill tone="amber" size="xs">no rate</Pill>}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskRawTab({ task }) {
  return (
    <pre style={{
      fontSize: 11, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      background: 'var(--code-bg)', color: 'var(--text)',
      padding: 14, borderRadius: 8, overflow: 'auto', margin: 0,
      border: '1px solid var(--border)',
      lineHeight: 1.6,
    }}>
{JSON.stringify(task, (k, v) => k === 'assignees' ? v.map(a => a.name) : v, 2)}
    </pre>
  );
}

function TaskSyncTab({ task }) {
  const events = window.MOCK.SYNC_LOGS.filter(s => s.task_id === task.task_id).slice(0, 8);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
      <div style={{ position: 'absolute', left: 11, top: 8, bottom: 8, width: 1, background: 'var(--border)' }}/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, position: 'relative', zIndex: 1 }}>
        <span style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--pill-green-bg)', color: 'var(--pill-green-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icons.CircleCheck size={13}/></span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Sync count: <strong>{task.sync_count}</strong></div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Latest at {fmt.dateTime(task.synced_at)}</div>
        </div>
      </div>
      {events.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 36 }}>No events recorded for this task.</div>
      ) : events.map((e, i) => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingLeft: 0, paddingBottom: 14, position: 'relative', zIndex: 1 }}>
          <span style={{
            width: 24, height: 24, borderRadius: 999, flexShrink: 0,
            background: e.processed_status === 'success' ? 'var(--pill-green-bg)' : e.processed_status === 'failed' ? 'var(--pill-red-bg)' : 'var(--pill-amber-bg)',
            color: e.processed_status === 'success' ? 'var(--pill-green-text)' : e.processed_status === 'failed' ? 'var(--pill-red-text)' : 'var(--pill-amber-text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {e.processed_status === 'success' ? <Icons.CircleCheck size={13}/> : e.processed_status === 'failed' ? <Icons.CircleX size={13}/> : <Icons.RefreshCw size={13}/>}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text)' }}><strong>{e.event_type}</strong> · {e.action}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt.dateTime(e.created_at)}</div>
          </div>
          {e.already_seen && <Pill tone="amber" size="xs">duplicate</Pill>}
        </div>
      ))}
    </div>
  );
}

window.TasksPage = TasksPage;
