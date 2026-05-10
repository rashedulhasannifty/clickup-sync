// Page: Spaces / Workload — see distribution across ClickUp spaces

function ProgressBar({ value = 0, color = 'var(--accent)', height = 6 }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div style={{ width: '100%', height, background: 'var(--muted-bg)', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ width: `${v}%`, height: '100%', background: color, transition: 'width 200ms ease-out' }}/>
    </div>
  );
}

function SpacesPage({ navigate }) {
  const spaces = window.MOCK.SPACES;
  const [view, setView] = React.useState('grid'); // 'grid' | 'workload'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Spaces"
        description="ClickUp space allocation — what we sync, who owns it, and where the work and cost are concentrated."
        actions={
          <Tabs value={view} onChange={setView} variant="segmented" items={[
            { value: 'grid', label: 'Grid' },
            { value: 'workload', label: 'Workload' },
          ]}/>
        }
      />

      {view === 'grid' ? <SpaceGrid spaces={spaces} navigate={navigate}/> : <Workload spaces={spaces} navigate={navigate}/>}
    </div>
  );
}

function SpaceGrid({ spaces, navigate }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
      {spaces.map(s => <SpaceCard key={s.space_id} space={s} navigate={navigate}/>)}
    </div>
  );
}

function SpaceCard({ space, navigate }) {
  const totalHours = space.hours_logged;
  const billable = space.billable_hours;
  const billPct = totalHours > 0 ? Math.round(billable / totalHours * 100) : 0;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 14,
      display: 'flex', flexDirection: 'column', gap: 12,
      borderTop: `3px solid ${space.color}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: `${space.color}22`, color: space.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700,
        }}>{space.name.slice(0, 1)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {space.name}
            {space.archived && <Pill tone="gray" size="xs">archived</Pill>}
          </div>
          <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>{space.space_id}</div>
        </div>
        <Pill tone={space.synced ? 'green' : 'gray'} size="xs" icon={space.synced ? <Icons.CircleCheck size={10}/> : <Icons.X size={10}/>}>
          {space.synced ? 'synced' : 'paused'}
        </Pill>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        <Stat label="Tasks" value={fmt.number(space.task_count)}/>
        <Stat label="Open" value={fmt.number(space.open_count)}/>
        <Stat label="Members" value={fmt.number(space.member_count)}/>
        <Stat label="Hours" value={fmt.hours(totalHours)}/>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          <span>Billable {fmt.hours(billable)}</span>
          <span>{billPct}%</span>
        </div>
        <ProgressBar value={billPct} color={space.color}/>
      </div>

      <div style={{ display: 'flex', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border-soft)' }}>
        <Button size="sm" variant="default" style={{ flex: 1 }} onClick={() => navigate('/tasks')}>View tasks</Button>
        <Button size="sm" variant="ghost" icon={<Icons.Settings size={12}/>} onClick={() => navigate('/settings')}/>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ padding: 8, background: 'var(--muted-bg)', borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function Workload({ spaces, navigate }) {
  const total = spaces.reduce((s, sp) => s + sp.hours_logged, 0);
  const sorted = [...spaces].sort((a, b) => b.hours_logged - a.hours_logged);
  return (
    <Card padding={0}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Last 30 days</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(total)} <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>across {sorted.length} spaces</span></div>
        </div>
      </div>

      {/* Stacked bar */}
      <div style={{ padding: 16, borderBottom: '1px solid var(--border-soft)' }}>
        <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--muted-bg)' }}>
          {sorted.map(sp => (
            <div key={sp.space_id} style={{ width: `${sp.hours_logged / total * 100}%`, background: sp.color, transition: 'all 200ms' }}
              title={`${sp.name}: ${fmt.hours(sp.hours_logged)}`}/>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
          {sorted.map(sp => (
            <div key={sp.space_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: sp.color }}/>
              <span style={{ fontWeight: 500, color: 'var(--text)' }}>{sp.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(sp.hours_logged)} ({Math.round(sp.hours_logged / total * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--muted-bg)', textTransform: 'uppercase', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', fontWeight: 600 }}>
            <th style={{ textAlign: 'left', padding: '8px 16px' }}>Space</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Tasks</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Open</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Members</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Hours</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Billable</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Cost</th>
            <th style={{ width: 80, padding: '8px 16px' }}/>
          </tr>
        </thead>
        <tbody>
          {sorted.map((sp, i) => (
            <tr key={sp.space_id} style={{ borderTop: i ? '1px solid var(--border-soft)' : 0 }}>
              <td style={{ padding: '10px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: sp.color }}/>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{sp.name}</span>
                  {!sp.synced && <Pill tone="gray" size="xs">paused</Pill>}
                </div>
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.number(sp.task_count)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.number(sp.open_count)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.number(sp.member_count)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.hours(sp.hours_logged)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(sp.billable_hours)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.money(sp.cost_cents)}</td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                <Button size="sm" variant="ghost" onClick={() => navigate('/tasks')} icon={<Icons.ChevronRight size={12}/>}/>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

window.SpacesPage = SpacesPage;
