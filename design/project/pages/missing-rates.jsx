// Page: Missing Rates / Cost Issues — toggleable between cards (grouped) and triage queue

function MissingRatesPage({ navigate }) {
  const [view, setView] = React.useState('cards'); // 'cards' | 'queue'
  const [severityFilter, setSeverityFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const issues = window.MOCK.MISSING_RATE_ISSUES;

  const filtered = issues.filter(i => {
    if (severityFilter !== 'all' && i.severity !== severityFilter) return false;
    if (search && !i.assignee.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalEntries = filtered.reduce((s, i) => s + i.missing_count, 0);
  const totalHours = filtered.reduce((s, i) => s + i.affected_hours, 0);
  const totalCost = filtered.reduce((s, i) => s + i.estimated_missing_cost_cents, 0);

  if (issues.length === 0) {
    return (
      <div>
        <PageHeader title="Missing Rates" description="Operational queue for cost calculation problems."/>
        <Card>
          <EmptyState
            icon={<Icons.CircleCheck size={20}/>}
            title="All costs are calculated"
            body="No missing rate issues found. Time entries are being costed correctly."
          />
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Missing Rates"
        description="Operational queue for cost calculation problems. Resolve to enable accurate labor cost reporting."
        badge={<Pill tone="amber">{filtered.length} active</Pill>}
        actions={
          <>
            <Tabs value={view} onChange={setView} variant="segmented" items={[
              { value: 'cards', label: 'Grouped' },
              { value: 'queue', label: 'Triage queue' },
            ]}/>
          </>
        }
      />

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <MetricCard dense label="Affected assignees" value={fmt.number(filtered.length)} icon={<Icons.Users size={13}/>}/>
        <MetricCard dense label="Affected entries" value={fmt.number(totalEntries)} icon={<Icons.Clock size={13}/>}/>
        <MetricCard dense label="Affected hours" value={fmt.hours(totalHours)} icon={<Icons.Clock size={13}/>}/>
        <MetricCard dense label="Est. uncosted spend" value={fmt.money(totalCost)} sublabel="at $42/h placeholder" icon={<Icons.DollarSign size={13}/>}/>
      </div>

      {/* Filter row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}>
        <div style={{ flex: 1, minWidth: 200, maxWidth: 300 }}>
          <Input icon={<Icons.Search size={14}/>} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assignee…"/>
        </div>
        <Select size="md" value={severityFilter} onChange={setSeverityFilter} options={[
          { value: 'all', label: 'All severities' },
          { value: 'high', label: 'High severity' },
          { value: 'medium', label: 'Medium severity' },
          { value: 'low', label: 'Low severity' },
        ]}/>
        <span style={{ flex: 1 }}/>
        <Button size="md" variant="ghost" icon={<Icons.Download size={13}/>}>Export issues</Button>
      </div>

      {view === 'cards' ? <CardsView issues={filtered} navigate={navigate}/> : <QueueView issues={filtered} navigate={navigate}/>}
    </div>
  );
}

function CardsView({ issues, navigate }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
      {issues.map(issue => <MissingRateGroupCard key={issue.assignee.id} issue={issue} navigate={navigate}/>)}
    </div>
  );
}

function MissingRateGroupCard({ issue, navigate }) {
  const [expanded, setExpanded] = React.useState(false);
  const sevTone = issue.severity === 'high' ? 'red' : issue.severity === 'medium' ? 'amber' : 'gray';
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden',
      borderLeft: `3px solid ${issue.severity === 'high' ? 'var(--red)' : issue.severity === 'medium' ? 'var(--amber)' : 'var(--text-faint)'}`,
    }}>
      <div style={{ padding: 14, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Avatar user={issue.assignee} size={36}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{issue.assignee.name}</span>
            <Pill tone={sevTone} size="xs">{issue.severity}</Pill>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{issue.assignee.email}</div>
          <Pill tone="amber" size="xs" icon={<Icons.AlertTriangle size={10}/>}>{issue.issue_type}</Pill>
        </div>
      </div>

      <div style={{ padding: '0 14px 14px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <div style={{ padding: 10, background: 'var(--muted-bg)', borderRadius: 7 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entries</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{issue.missing_count}</div>
        </div>
        <div style={{ padding: 10, background: 'var(--muted-bg)', borderRadius: 7 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hours</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(issue.affected_hours)}</div>
        </div>
        <div style={{ padding: 10, background: 'var(--muted-bg)', borderRadius: 7, gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date range</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {fmt.shortDate(issue.first_date)} <Icons.ChevronRight size={11}/> {fmt.shortDate(issue.latest_date)}
          </div>
        </div>
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-soft)' }}>
        <button onClick={() => setExpanded(e => !e)} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'transparent', border: 0, padding: 0,
          fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 500,
        }}>
          {expanded ? <Icons.ChevronDown size={12}/> : <Icons.ChevronRight size={12}/>}
          {expanded ? 'Hide' : 'Show'} affected tasks ({issue.affected_tasks.length})
        </button>
        {expanded && (
          <ul style={{ listStyle: 'none', padding: '8px 0 0 16px', margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {issue.affected_tasks.map((t, i) => (
              <li key={i} style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--text-faint)', marginRight: 6 }}>·</span>{t}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 6, background: 'var(--muted-bg)' }}>
        <Button size="sm" variant="accent" icon={<Icons.Plus size={12}/>} style={{ flex: 1 }} onClick={() => navigate('/assignee-rates')}>Add rate</Button>
        <Button size="sm" variant="default" icon={<Icons.Clock size={12}/>} onClick={() => navigate('/time-entries')}>Entries</Button>
        <Button size="sm" variant="default" icon={<Icons.DollarSign size={12}/>} onClick={() => navigate('/assignee-rates')}>Rates</Button>
      </div>
    </div>
  );
}

function QueueView({ issues, navigate }) {
  // Sorted by severity then count
  const sorted = [...issues].sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2 };
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
    return b.missing_count - a.missing_count;
  });
  return (
    <Card padding={0}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sorted.map((issue, i) => (
          <div key={issue.assignee.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px', borderBottom: i < sorted.length - 1 ? '1px solid var(--border-soft)' : 0,
            transition: 'background 100ms',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{
              width: 6, alignSelf: 'stretch', borderRadius: 3,
              background: issue.severity === 'high' ? 'var(--red)' : issue.severity === 'medium' ? 'var(--amber)' : 'var(--text-faint)',
            }}/>
            <Avatar user={issue.assignee} size={32}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{issue.assignee.name}</span>
                <Pill tone="amber" size="xs">{issue.issue_type}</Pill>
                <Pill tone={issue.severity === 'high' ? 'red' : issue.severity === 'medium' ? 'amber' : 'gray'} size="xs">{issue.severity}</Pill>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {issue.assignee.email} · {fmt.shortDate(issue.first_date)} → {fmt.shortDate(issue.latest_date)}
              </div>
            </div>
            <div style={{ textAlign: 'right', minWidth: 110 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{issue.missing_count} entries</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(issue.affected_hours)} · ~{fmt.money(issue.estimated_missing_cost_cents)}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" variant="default" onClick={() => navigate('/time-entries')}>Entries</Button>
              <Button size="sm" variant="accent" icon={<Icons.Plus size={12}/>} onClick={() => navigate('/assignee-rates')}>Add rate</Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

window.MissingRatesPage = MissingRatesPage;
