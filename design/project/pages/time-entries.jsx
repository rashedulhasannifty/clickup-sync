// Page: Time Entries

function TimeEntriesPage({ navigate }) {
  const [search, setSearch] = React.useState('');
  const [assigneeFilter, setAssigneeFilter] = React.useState('all');
  const [billableFilter, setBillableFilter] = React.useState('all');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [missingOnly, setMissingOnly] = React.useState(false);
  const [openEntry, setOpenEntry] = React.useState(null);
  const filters = useFilters();

  const filtered = React.useMemo(() => {
    return window.MOCK.TIME_ENTRIES.filter(e => {
      if (filters.space !== 'all' && e.space_id !== filters.space) return false;
      if (assigneeFilter !== 'all' && e.user_id !== assigneeFilter) return false;
      if (billableFilter === 'billable' && !e.billable) return false;
      if (billableFilter === 'non' && e.billable) return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (missingOnly && e.status !== 'NO_RATE_FOUND') return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${e.task_name} ${e.user_name} ${e.task_id}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [search, assigneeFilter, billableFilter, statusFilter, missingOnly, filters.space]);

  // KPI strip
  const totalHours = filtered.reduce((s, e) => s + e.duration_hours, 0);
  const billableHours = filtered.filter(e => e.billable).reduce((s, e) => s + e.duration_hours, 0);
  const nonBillableHours = totalHours - billableHours;
  const totalCost = filtered.reduce((s, e) => s + (e.cost_cents || 0), 0);
  const ratedEntries = filtered.filter(e => e.cost_cents);
  const avgRate = ratedEntries.length ? ratedEntries.reduce((s, e) => s + (e.hourly_rate_cents || 0), 0) / ratedEntries.length : 0;
  const missingCount = filtered.filter(e => e.status === 'NO_RATE_FOUND').length;
  const calculatedCount = filtered.filter(e => e.status === 'COST_CALCULATED').length;

  const reset = () => { setSearch(''); setAssigneeFilter('all'); setBillableFilter('all'); setStatusFilter('all'); setMissingOnly(false); };
  const hasFilters = search || assigneeFilter !== 'all' || billableFilter !== 'all' || statusFilter !== 'all' || missingOnly;

  const columns = [
    { key: 'time_entry_id', header: 'ID', width: 100, cell: (r) =>
      <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>{r.time_entry_id}</span> },
    { key: 'task_name', header: 'Task', width: 280, cell: (r) =>
      <span style={{ fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 280 }}>{r.task_name}</span> },
    { key: 'user_name', header: 'Assignee', width: 180, cell: (r) =>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Avatar user={r.user} size={22}/>
        <span style={{ fontSize: 13 }}>{r.user_name}</span>
      </span> },
    { key: 'start_time', header: 'Start', width: 130, cell: (r) =>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>{fmt.dateTime(r.start_time)}</span> },
    { key: 'duration_hours', header: 'Duration', width: 80, align: 'right', cell: (r) =>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.hours(r.duration_hours)}</span> },
    { key: 'billable', header: 'Bill', width: 70, sortAccessor: (r) => r.billable ? 1 : 0, cell: (r) =>
      r.billable ? <Pill tone="green" size="xs">billable</Pill> : <Pill tone="gray" size="xs">non</Pill> },
    { key: 'hourly_rate_cents', header: 'Rate', width: 80, align: 'right', cell: (r) =>
      r.hourly_rate_cents ? <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>{fmt.money(r.hourly_rate_cents, r.currency)}/h</span> : <span style={{ color: 'var(--text-faint)' }}>—</span> },
    { key: 'cost_cents', header: 'Cost', width: 90, align: 'right', cell: (r) =>
      r.cost_cents ? <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.money(r.cost_cents, r.currency)}</span> : <span style={{ color: 'var(--text-faint)' }}>—</span> },
    { key: 'status', header: 'Status', width: 130, cell: (r) =>
      r.status === 'COST_CALCULATED'
        ? <Pill tone="green" size="xs" icon={<Icons.CircleCheck size={10}/>}>cost calculated</Pill>
        : <Pill tone="amber" size="xs" icon={<Icons.AlertTriangle size={10}/>}>no rate found</Pill> },
    { key: 'synced_at', header: 'Synced', width: 90, align: 'right', cell: (r) =>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>{fmt.relative(r.synced_at)}</span> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Time Entries"
        description="Audit time tracking and verify calculated labor costs."
        actions={
          <>
            <Button size="md" variant="default" icon={<Icons.Download size={13}/>}>Export CSV</Button>
            <Button size="md" variant="accent" icon={<Icons.RefreshCw size={13}/>}>Recalculate costs</Button>
          </>
        }
      />

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <MetricCard dense label="Total hours" value={fmt.hours(totalHours)} sublabel={`${filtered.length} entries`} icon={<Icons.Clock size={13}/>}/>
        <MetricCard dense label="Billable" value={fmt.hours(billableHours)} sublabel={`${Math.round(billableHours / Math.max(totalHours, 0.01) * 100)}%`} icon={<Icons.DollarSign size={13}/>}/>
        <MetricCard dense label="Non-billable" value={fmt.hours(nonBillableHours)} icon={<Icons.Clock size={13}/>}/>
        <MetricCard dense label="Total cost" value={fmt.money(totalCost)} sublabel={`avg ${fmt.money(Math.round(avgRate))}/h`} icon={<Icons.DollarSign size={13}/>}/>
        <MetricCard dense label="With cost" value={fmt.number(calculatedCount)} sublabel="calculated" icon={<Icons.CircleCheck size={13}/>}/>
        <MetricCard dense label="Missing rates" value={fmt.number(missingCount)} sublabel="need review" icon={<Icons.AlertTriangle size={13}/>}
          onClick={() => navigate('/missing-rates')}/>
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}>
        <div style={{ flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Input icon={<Icons.Search size={14}/>} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search task, assignee…"/>
        </div>
        <Select size="md" value={assigneeFilter} onChange={setAssigneeFilter} options={[
          { value: 'all', label: 'Any assignee' },
          ...window.MOCK.ASSIGNEES.map(a => ({ value: a.id, label: a.name })),
        ]}/>
        <Select size="md" value={billableFilter} onChange={setBillableFilter} options={[
          { value: 'all', label: 'Billable + non' },
          { value: 'billable', label: 'Billable only' },
          { value: 'non', label: 'Non-billable only' },
        ]}/>
        <Select size="md" value={statusFilter} onChange={setStatusFilter} options={[
          { value: 'all', label: 'Any status' },
          { value: 'COST_CALCULATED', label: 'Cost calculated' },
          { value: 'NO_RATE_FOUND', label: 'No rate found' },
        ]}/>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Switch checked={missingOnly} onChange={setMissingOnly}/>
          <span>Missing rate only</span>
        </label>
        {hasFilters && <Button size="md" variant="ghost" onClick={reset} icon={<Icons.X size={13}/>}>Reset</Button>}
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        rowKey="time_entry_id"
        onRowClick={(r) => setOpenEntry(r)}
        emptyState={
          <EmptyState
            icon={<Icons.Clock size={20}/>}
            title="No time entries found for this filter set"
            body="Try widening filters or check that ClickUp is sending tracked time updates."
            action={hasFilters && <Button onClick={reset}>Clear all filters</Button>}
          />
        }
      />

      <TimeEntryDrawer entry={openEntry} onClose={() => setOpenEntry(null)} navigate={navigate}/>
    </div>
  );
}

function TimeEntryDrawer({ entry, onClose, navigate }) {
  if (!entry) return <Drawer open={false} onClose={onClose}/>;
  return (
    <Drawer open={!!entry} onClose={onClose} width={520}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)', marginBottom: 4 }}>
            {entry.time_entry_id}
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0, color: 'var(--text)', lineHeight: 1.3 }}>{entry.task_name}</h2>
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            {entry.status === 'COST_CALCULATED'
              ? <Pill tone="green" icon={<Icons.CircleCheck size={11}/>}>Cost calculated</Pill>
              : <Pill tone="amber" icon={<Icons.AlertTriangle size={11}/>}>No rate found</Pill>}
            {entry.billable ? <Pill tone="blue">Billable</Pill> : <Pill tone="gray">Non-billable</Pill>}
          </div>
        </div>
        <button onClick={onClose} style={{ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icons.X size={14}/>
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--muted-bg)', borderRadius: 8 }}>
          <Avatar user={entry.user} size={36}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{entry.user_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{entry.user_email}</div>
          </div>
          <Button size="sm" variant="default" icon={<Icons.Eye size={12}/>} onClick={() => navigate('/assignee-rates')}>Rates</Button>
        </div>

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Time</h3>
          <MetaGrid items={[
            ['Start', fmt.dateTime(entry.start_time)],
            ['End', fmt.dateTime(entry.end_time)],
            ['Duration', fmt.hours(entry.duration_hours)],
            ['Billable', entry.billable ? 'Yes' : 'No'],
          ]}/>
        </div>

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Cost calculation</h3>
          {entry.cost_cents ? (
            <div style={{ padding: 12, background: 'var(--pill-green-bg)', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--pill-green-text)', fontWeight: 600 }}>Calculated</span>
                <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>rate: {entry.rate_id}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 6 }}>
                {fmt.hours(entry.duration_hours)} × {fmt.money(entry.hourly_rate_cents, entry.currency)} = <strong style={{ fontSize: 16 }}>{fmt.money(entry.cost_cents, entry.currency)}</strong>
              </div>
            </div>
          ) : (
            <div style={{ padding: 12, background: 'var(--pill-amber-bg)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--pill-amber-text)', fontWeight: 600, marginBottom: 4 }}>NO_RATE_FOUND</div>
              <div style={{ fontSize: 12, color: 'var(--text)' }}>
                No active assignee rate covers this entry's start date ({fmt.shortDate(entry.start_time)}).
              </div>
              <Button size="sm" variant="default" style={{ marginTop: 10 }} icon={<Icons.Plus size={12}/>} onClick={() => navigate('/assignee-rates')}>Add rate for {entry.user_name.split(' ')[0]}</Button>
            </div>
          )}
        </div>

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Description</h3>
          <div style={{ fontSize: 13, color: 'var(--text)', padding: 10, background: 'var(--muted-bg)', borderRadius: 6, minHeight: 40 }}>
            {entry.description || <span style={{ color: 'var(--text-faint)' }}>No description</span>}
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Sync</h3>
          <MetaGrid items={[
            ['Synced at', fmt.dateTime(entry.synced_at)],
            ['Task ID', entry.task_id],
          ]}/>
        </div>
      </div>
    </Drawer>
  );
}

window.TimeEntriesPage = TimeEntriesPage;
