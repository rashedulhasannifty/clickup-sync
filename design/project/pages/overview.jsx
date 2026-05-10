// Page: Overview Dashboard

function HealthIndicator({ status, label, value }) {
  const tones = {
    healthy: { color: 'var(--green)', bg: 'var(--pill-green-bg)' },
    warning: { color: 'var(--amber)', bg: 'var(--pill-amber-bg)' },
    error: { color: 'var(--red)', bg: 'var(--pill-red-bg)' },
  };
  const t = tones[status] || tones.healthy;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', borderRadius: 8,
      background: 'var(--muted-bg)',
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 999,
        background: t.color,
        boxShadow: `0 0 0 3px ${t.bg}`,
        animation: status === 'healthy' ? 'pulse 2s infinite' : 'none',
        flexShrink: 0,
      }}/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      </div>
    </div>
  );
}

function OverviewPage({ navigate }) {
  const m = window.MOCK.OVERVIEW_METRICS;
  const tasksByStatus = window.MOCK.STATUSES.map(s => ({
    label: s.name,
    value: window.MOCK.TASKS.filter(t => t.status === s.name).length,
    color: s.color,
  }));
  const tasksBySpace = window.MOCK.SPACES.map(s => ({
    label: s.name,
    value: window.MOCK.TASKS.filter(t => t.space_id === s.id).length,
    color: s.color,
  }));
  const timeByAssignee = window.MOCK.ASSIGNEES.slice(0, 8).map(a => ({
    label: a.name.split(' ')[0],
    value: Math.round(window.MOCK.TIME_ENTRIES.filter(te => te.user_id === a.id).reduce((s, te) => s + te.duration_hours, 0) * 10) / 10,
    color: a.color,
  })).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  const costByDept = [...new Set(window.MOCK.TASKS.map(t => t.department))].map(d => ({
    label: d,
    value: Math.round(window.MOCK.TASKS.filter(t => t.department === d).reduce((s, t) => s + (t.cost || 0), 0) / 100),
  })).sort((a, b) => b.value - a.value).slice(0, 6);
  const costByClient = [...new Set(window.MOCK.TASKS.map(t => t.client))].map(c => ({
    label: c,
    value: Math.round(window.MOCK.TASKS.filter(t => t.client === c).reduce((s, t) => s + (t.cost || 0), 0) / 100),
  })).sort((a, b) => b.value - a.value).slice(0, 5);
  const sprintPoints = window.MOCK.SPRINTS.map(sp => ({
    label: sp,
    value: window.MOCK.TASKS.filter(t => t.sprint_name === sp).reduce((s, t) => s + (t.sprint_points || 0), 0),
  }));

  // Missing rates trend mock
  const missingTrend = Array.from({ length: 14 }, (_, i) => ({
    label: `${14 - i}d`,
    value: Math.max(0, Math.round(15 + Math.sin(i * 0.6) * 6 + (14 - i) * 0.4)),
  }));

  // Recent events
  const recent = window.MOCK.SYNC_LOGS.slice(0, 7);

  // Sparkline data
  const sparkData = Array.from({ length: 12 }, (_, i) => 20 + Math.sin(i * 0.7) * 8 + i * 2);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        title="Overview"
        description="System health, sync activity, and operational metrics for your ClickUp pipeline."
        actions={
          <>
            <Button variant="default" size="md" icon={<Icons.RefreshCw size={13}/>}>Refresh</Button>
            <Button variant="accent" size="md" icon={<Icons.Download size={13}/>}>Export</Button>
          </>
        }
      />

      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <MetricCard
          accent
          label="Total tasks"
          value={fmt.number(m.total_tasks)}
          delta="+8.2% vs last 30d"
          deltaTone="up"
          icon={<Icons.CheckSquare size={14}/>}
          sparkline={<Sparkline data={sparkData} color="var(--accent)"/>}
          onClick={() => navigate('/tasks')}
        />
        <MetricCard
          label="Open"
          value={fmt.number(m.open_tasks)}
          sublabel={`${Math.round(m.open_tasks / m.total_tasks * 100)}%`}
          delta={`${m.open_tasks - m.closed_tasks} more open than closed`}
          icon={<Icons.Inbox size={14}/>}
          onClick={() => navigate('/tasks')}
        />
        <MetricCard
          label="Closed"
          value={fmt.number(m.closed_tasks)}
          sublabel={`${Math.round(m.closed_tasks / m.total_tasks * 100)}%`}
          delta="+12 this week"
          deltaTone="up"
          icon={<Icons.CircleCheck size={14}/>}
        />
        <MetricCard
          label="Time tracked"
          value={fmt.hours(m.total_time_hours)}
          sublabel="last 30d"
          delta={`${window.MOCK.TIME_ENTRIES.length} entries`}
          icon={<Icons.Clock size={14}/>}
          onClick={() => navigate('/time-entries')}
        />
        <MetricCard
          label="Calculated cost"
          value={fmt.money(m.total_cost_cents)}
          sublabel="last 30d"
          delta="+4.1% vs last 30d"
          deltaTone="up"
          icon={<Icons.DollarSign size={14}/>}
        />
        <MetricCard
          label="Missing rates"
          value={fmt.number(m.missing_rate_count)}
          sublabel={`${window.MOCK.MISSING_RATE_ISSUES.length} assignees`}
          delta="needs review"
          deltaTone="down"
          icon={<Icons.AlertTriangle size={14}/>}
          onClick={() => navigate('/missing-rates')}
        />
      </div>

      {/* Sync health row */}
      <Card padding={0}>
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'var(--pill-green-bg)', color: 'var(--pill-green-text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icons.Activity size={14}/></span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Sync health</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Webhook ingestion, dedupe, and processing</div>
            </div>
          </div>
          <Pill tone="green" icon={<Icons.CircleCheck size={11}/>}>All systems operational</Pill>
        </div>
        <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <HealthIndicator status="healthy" label="Webhook endpoint" value="/clickup-sync"/>
          <HealthIndicator status="healthy" label="Latest event" value={recent[0]?.event_type || '—'}/>
          <HealthIndicator status="healthy" label="Successful events (24h)" value={`${m.successful_events} processed`}/>
          <HealthIndicator status="warning" label="Duplicate skipped" value={`${m.duplicate_event_count} fingerprints`}/>
          <HealthIndicator status={m.failed_event_count > 0 ? 'error' : 'healthy'} label="Failed events" value={`${m.failed_event_count} need retry`}/>
          <HealthIndicator status="healthy" label="Last task update" value={fmt.relative(m.last_sync_at)}/>
        </div>
      </Card>

      {/* Charts grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <Card title="Tasks by status" subtitle={`${m.total_tasks} total tasks tracked`} padding={16}>
          <DonutChart data={tasksByStatus} size={140} thickness={14} centerLabel="Total" centerValue={m.total_tasks}/>
        </Card>

        <Card title="Tasks by space" subtitle="Distribution across workspaces" padding={16}>
          <BarChart data={tasksBySpace} horizontal formatValue={fmt.number}/>
        </Card>

        <Card title="Time tracked by assignee" subtitle="Hours logged in last 30 days" padding={16}>
          <BarChart data={timeByAssignee.slice(0, 6)} horizontal formatValue={fmt.hours}/>
        </Card>

        <Card title="Cost by department" subtitle="Calculated labor cost" padding={16}>
          <BarChart data={costByDept} horizontal formatValue={(v) => fmt.money(v * 100)}/>
        </Card>

        <Card title="Cost by client" subtitle="Top 5 clients by spend" padding={16}>
          <BarChart data={costByClient} horizontal formatValue={(v) => fmt.money(v * 100)}/>
        </Card>

        <Card title="Missing rates trend" subtitle="Daily count, last 14 days" padding={16}>
          <LineChart data={missingTrend} height={140} color="var(--amber)"/>
        </Card>
      </div>

      {/* Activity + Alerts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 12 }}>
        <Card padding={0} title="Recent webhook activity" subtitle="Latest events processed by the sync pipeline" action={
          <Button size="sm" variant="ghost" iconRight={<Icons.ArrowUpRight size={12}/>} onClick={() => navigate('/sync-logs')}>View all</Button>
        }>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr style={{ background: 'var(--table-head-bg)' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Event</th>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Task</th>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Space</th>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Status</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e, i) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}
                  onClick={() => navigate('/sync-logs')}
                  onMouseEnter={ev => ev.currentTarget.style.background = 'var(--hover)'}
                  onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)' }}>
                    <Pill tone={
                      e.event_type === 'taskCreated' ? 'green'
                      : e.event_type === 'taskDeleted' ? 'red'
                      : e.event_type === 'taskTimeTrackedUpdated' ? 'purple'
                      : 'blue'
                    } size="xs">{e.event_type}</Pill>
                  </td>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                    {e.task_name}
                  </td>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}>{e.space_name}</td>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)' }}>
                    <Pill tone={e.processed_status === 'success' ? 'green' : e.processed_status === 'failed' ? 'red' : e.processed_status === 'skipped' ? 'amber' : 'blue'} size="xs">
                      {e.processed_status}
                    </Pill>
                  </td>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)', textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt.relative(e.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card padding={0} title="Alerts" subtitle="Items needing operator attention" action={
          <Pill tone="amber" size="xs">{window.MOCK.MISSING_RATE_ISSUES.length + m.failed_event_count}</Pill>
        }>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[
              { tone: 'amber', icon: <Icons.AlertTriangle size={13}/>, title: `${window.MOCK.MISSING_RATE_ISSUES.length} assignees missing rates`, body: `${m.missing_rate_count} time entries can't be costed`, action: 'Review queue', target: '/missing-rates' },
              { tone: 'red', icon: <Icons.CircleX size={13}/>, title: `${m.failed_event_count} failed webhook events`, body: 'ClickUp 429 rate limiting on backfill', action: 'Open sync logs', target: '/sync-logs' },
              { tone: 'amber', icon: <Icons.Clock size={13}/>, title: '6 tasks not synced in 7 days', body: 'May indicate webhook drift', action: 'Audit tasks', target: '/tasks' },
              { tone: 'amber', icon: <Icons.DollarSign size={13}/>, title: '1 overlapping rate range', body: 'Chisty Rahman rates 2024-11-01 → 2025-03-15', action: 'Resolve', target: '/assignee-rates' },
            ].map((a, i) => (
              <button key={i} onClick={() => navigate(a.target)} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 16px', borderBottom: i < 3 ? '1px solid var(--border-soft)' : 0,
                background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left',
                color: 'inherit',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                  background: `var(--pill-${a.tone}-bg)`, color: `var(--pill-${a.tone}-text)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{a.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.body}</div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  {a.action} <Icons.ChevronRight size={12}/>
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Sprint points + cost summary */}
      <Card title="Sprint points by sprint" subtitle="Work delivered across active sprints" padding={16}>
        <BarChart data={sprintPoints} horizontal formatValue={(v) => `${v} pts`}/>
      </Card>
    </div>
  );
}

window.OverviewPage = OverviewPage;
