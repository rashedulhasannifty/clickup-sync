// Page: Assignee Rates — manage cost rates with add/edit modal

function AssigneeRatesPage() {
  const [search, setSearch] = React.useState('');
  const [activeOnly, setActiveOnly] = React.useState(false);
  const [editing, setEditing] = React.useState(null); // rate object or 'new'

  const rates = window.MOCK.RATES;
  const filtered = rates.filter(r => {
    if (activeOnly && !r.is_active) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${r.user.name} ${r.user.email}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Group by assignee
  const grouped = React.useMemo(() => {
    const byUser = new Map();
    filtered.forEach(r => {
      if (!byUser.has(r.user.id)) byUser.set(r.user.id, { user: r.user, rates: [] });
      byUser.get(r.user.id).rates.push(r);
    });
    // sort rates within group by start desc
    byUser.forEach(g => g.rates.sort((a, b) => b.effective_from.localeCompare(a.effective_from)));
    return [...byUser.values()].sort((a, b) => a.user.name.localeCompare(b.user.name));
  }, [filtered]);

  const totalActive = rates.filter(r => r.is_active).length;
  const totalUsers = new Set(rates.map(r => r.user.id)).size;
  const avgRate = rates.filter(r => r.is_active).reduce((s, r) => s + r.hourly_rate_cents, 0) / Math.max(totalActive, 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Assignee Rates"
        description="Hourly cost rates by assignee. Used to compute labor cost for tracked time."
        actions={
          <>
            <Button size="md" variant="default" icon={<Icons.Download size={13}/>}>Export</Button>
            <Button size="md" variant="accent" icon={<Icons.Plus size={13}/>} onClick={() => setEditing('new')}>New rate</Button>
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <MetricCard dense label="Active rates" value={fmt.number(totalActive)} icon={<Icons.DollarSign size={13}/>}/>
        <MetricCard dense label="Covered assignees" value={fmt.number(totalUsers)} icon={<Icons.Users size={13}/>}/>
        <MetricCard dense label="Avg active rate" value={`${fmt.money(Math.round(avgRate))}/h`} icon={<Icons.DollarSign size={13}/>}/>
        <MetricCard dense label="Without rate" value={fmt.number(window.MOCK.MISSING_RATE_ISSUES.length)} sublabel="see Missing Rates" icon={<Icons.AlertTriangle size={13}/>}/>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}>
        <div style={{ flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Input icon={<Icons.Search size={14}/>} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assignee…"/>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Switch checked={activeOnly} onChange={setActiveOnly}/>
          <span>Active rates only</span>
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {grouped.map(g => <AssigneeRatesCard key={g.user.id} user={g.user} rates={g.rates} onEdit={setEditing}/>)}
        {grouped.length === 0 && (
          <Card>
            <EmptyState
              icon={<Icons.DollarSign size={20}/>}
              title="No rates match your filters"
              body="Adjust filters or create a new rate to get started."
              action={<Button onClick={() => setEditing('new')} icon={<Icons.Plus size={12}/>}>New rate</Button>}
            />
          </Card>
        )}
      </div>

      {editing && <RateModal rate={editing === 'new' ? null : editing} onClose={() => setEditing(null)}/>}
    </div>
  );
}

function AssigneeRatesCard({ user, rates, onEdit }) {
  const active = rates.find(r => r.is_active);
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar user={user} size={36}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{user.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{user.email}</div>
        </div>
        {active ? (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Current rate</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt.money(active.hourly_rate_cents, active.currency)}<span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>/h</span></div>
          </div>
        ) : <Pill tone="amber">No active rate</Pill>}
        <Button size="sm" variant="default" icon={<Icons.Plus size={12}/>} onClick={() => onEdit({ user, isNew: true })}>New rate</Button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--muted-bg)', textTransform: 'uppercase', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', fontWeight: 600 }}>
            <th style={{ textAlign: 'left', padding: '8px 16px' }}>From</th>
            <th style={{ textAlign: 'left', padding: '8px 12px' }}>To</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Rate</th>
            <th style={{ textAlign: 'left', padding: '8px 12px' }}>Status</th>
            <th style={{ textAlign: 'left', padding: '8px 12px' }}>Updated</th>
            <th style={{ width: 60, padding: '8px 16px' }}/>
          </tr>
        </thead>
        <tbody>
          {rates.map((r, i) => (
            <tr key={r.id} style={{ borderTop: i ? '1px solid var(--border-soft)' : 0 }}>
              <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{fmt.shortDate(r.effective_from)}</td>
              <td style={{ padding: '10px 12px', fontVariantNumeric: 'tabular-nums', color: r.effective_to ? 'var(--text)' : 'var(--text-faint)' }}>
                {r.effective_to ? fmt.shortDate(r.effective_to) : '— ongoing'}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text)' }}>
                {fmt.money(r.hourly_rate_cents, r.currency)}
              </td>
              <td style={{ padding: '10px 12px' }}>
                {r.is_active
                  ? <Pill tone="green" size="xs" icon={<Icons.CircleCheck size={10}/>}>active</Pill>
                  : <Pill tone="gray" size="xs">historical</Pill>}
              </td>
              <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt.relative(r.updated_at)}
              </td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                <Button size="sm" variant="ghost" icon={<Icons.Edit size={12}/>} onClick={() => onEdit(r)}/>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function RateModal({ rate, onClose }) {
  const isNew = !rate || rate.isNew;
  const [user, setUser] = React.useState(rate?.user?.id || rate?.user_id || window.MOCK.ASSIGNEES[0].id);
  const [amount, setAmount] = React.useState(rate?.hourly_rate_cents ? rate.hourly_rate_cents / 100 : 50);
  const [currency, setCurrency] = React.useState(rate?.currency || 'USD');
  const [from, setFrom] = React.useState(rate?.effective_from || '2025-01-01');
  const [to, setTo] = React.useState(rate?.effective_to || '');

  const overlap = !isNew && (rate?.is_active === false); // placeholder

  return (
    <Modal onClose={onClose} title={isNew ? 'New rate' : 'Edit rate'} subtitle={isNew ? 'Add a new effective rate for an assignee.' : 'Update an existing rate.'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Assignee">
          <Select size="md" value={user} onChange={setUser} options={window.MOCK.ASSIGNEES.map(a => ({ value: a.id, label: `${a.name} · ${a.email}` }))}/>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
          <Field label="Hourly rate">
            <Input value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} type="number" step={0.5} icon={<Icons.DollarSign size={14}/>}/>
          </Field>
          <Field label="Currency">
            <Select size="md" value={currency} onChange={setCurrency} options={[
              { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }, { value: 'GBP', label: 'GBP' },
            ]}/>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Effective from" hint="Inclusive">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)}/>
          </Field>
          <Field label="Effective to" hint="Leave blank for ongoing">
            <Input type="date" value={to} onChange={e => setTo(e.target.value)}/>
          </Field>
        </div>

        <Callout tone="blue" icon={<Icons.Info size={13}/>}>
          Rates use closed-open intervals: <code style={{ fontFamily: 'ui-monospace, monospace' }}>[from, to)</code>. The cost calculator picks the rate whose interval contains the time entry's start time.
        </Callout>

        {overlap && (
          <Callout tone="amber" icon={<Icons.AlertTriangle size={13}/>}>
            This rate's window overlaps with another active rate for {rate?.user?.name}. Resolve the overlap before saving.
          </Callout>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        {!isNew && <Button variant="ghost" style={{ marginRight: 'auto', color: 'var(--red)' }} icon={<Icons.Trash size={13}/>}>Delete</Button>}
        <Button variant="default" onClick={onClose}>Cancel</Button>
        <Button variant="accent" icon={<Icons.Check size={13}/>} onClick={onClose}>{isNew ? 'Create rate' : 'Save changes'}</Button>
      </div>
    </Modal>
  );
}

window.AssigneeRatesPage = AssigneeRatesPage;
