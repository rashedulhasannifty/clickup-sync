// Page: Sync Logs / Webhooks — observability for the sync pipeline

function SyncLogsPage() {
  const [tab, setTab] = React.useState('runs'); // 'runs' | 'webhooks'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Sync Logs"
        description="Pipeline observability — sync runs, webhook deliveries, and error trails."
        actions={
          <>
            <Button size="md" variant="default" icon={<Icons.RefreshCw size={13}/>}>Trigger sync</Button>
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'runs', label: 'Sync runs', count: window.MOCK.SYNC_RUNS.length },
        { value: 'webhooks', label: 'Webhook events', count: window.MOCK.WEBHOOK_EVENTS.length },
      ]}/>
      {tab === 'runs' ? <SyncRunsTab/> : <WebhooksTab/>}
    </div>
  );
}

function SyncRunsTab() {
  const runs = window.MOCK.SYNC_RUNS;
  const [openRun, setOpenRun] = React.useState(null);

  const lastSuccess = runs.find(r => r.status === 'success');
  const lastFailure = runs.find(r => r.status === 'failed');
  const successRate = Math.round(runs.filter(r => r.status === 'success').length / runs.length * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <MetricCard dense label="Last success" value={lastSuccess ? fmt.relative(lastSuccess.started_at) : '—'} sublabel={lastSuccess ? fmt.dateTime(lastSuccess.started_at) : ''} icon={<Icons.CircleCheck size={13}/>}/>
        <MetricCard dense label="Last failure" value={lastFailure ? fmt.relative(lastFailure.started_at) : 'Never'} sublabel={lastFailure ? lastFailure.error_message?.slice(0, 30) + '…' : ''} icon={<Icons.AlertTriangle size={13}/>}/>
        <MetricCard dense label="Success rate" value={`${successRate}%`} sublabel={`last ${runs.length} runs`} icon={<Icons.Activity size={13}/>}/>
        <MetricCard dense label="Avg duration" value="2.4s" sublabel="last 10 runs" icon={<Icons.Clock size={13}/>}/>
      </div>

      <Card padding={0}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--muted-bg)', textTransform: 'uppercase', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', fontWeight: 600 }}>
              <th style={{ textAlign: 'left', padding: '10px 16px', width: 90 }}>Status</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>Run</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>Trigger</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>Started</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>Duration</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>Tasks</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>Time entries</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>Errors</th>
              <th style={{ width: 60, padding: '10px 16px' }}/>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.id} onClick={() => setOpenRun(r)} style={{
                borderTop: i ? '1px solid var(--border-soft)' : 0,
                cursor: 'pointer',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <td style={{ padding: '12px 16px' }}>
                  {r.status === 'success' && <Pill tone="green" size="xs" icon={<Icons.CircleCheck size={10}/>}>success</Pill>}
                  {r.status === 'partial' && <Pill tone="amber" size="xs" icon={<Icons.AlertTriangle size={10}/>}>partial</Pill>}
                  {r.status === 'failed' && <Pill tone="red" size="xs" icon={<Icons.X size={10}/>}>failed</Pill>}
                  {r.status === 'running' && <Pill tone="blue" size="xs" icon={<Icons.RefreshCw size={10}/>}>running</Pill>}
                </td>
                <td style={{ padding: '12px', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text)' }}>{r.id}</td>
                <td style={{ padding: '12px' }}>
                  <Pill tone="gray" size="xs">{r.trigger}</Pill>
                </td>
                <td style={{ padding: '12px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt.dateTime(r.started_at)}</td>
                <td style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}</td>
                <td style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.number(r.tasks_processed)}</td>
                <td style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.number(r.time_entries_processed)}</td>
                <td style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.errors_count > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                  {r.errors_count}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <Icons.ChevronRight size={14}/>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SyncRunDrawer run={openRun} onClose={() => setOpenRun(null)}/>
    </div>
  );
}

function SyncRunDrawer({ run, onClose }) {
  if (!run) return <Drawer open={false} onClose={onClose}/>;
  return (
    <Drawer open={!!run} onClose={onClose} width={620}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>{run.id}</div>
            <h2 style={{ fontSize: 17, fontWeight: 600, margin: '4px 0 0', color: 'var(--text)' }}>Sync run · {run.trigger}</h2>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icons.X size={14}/>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {run.status === 'success' && <Pill tone="green" icon={<Icons.CircleCheck size={11}/>}>Success</Pill>}
          {run.status === 'partial' && <Pill tone="amber" icon={<Icons.AlertTriangle size={11}/>}>Partial</Pill>}
          {run.status === 'failed' && <Pill tone="red" icon={<Icons.X size={11}/>}>Failed</Pill>}
          <Pill tone="gray">{run.trigger}</Pill>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Run summary</h3>
          <MetaGrid items={[
            ['Started', fmt.dateTime(run.started_at)],
            ['Finished', run.finished_at ? fmt.dateTime(run.finished_at) : 'In progress'],
            ['Duration', run.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : '—'],
            ['Trigger', run.trigger],
          ]}/>
        </div>

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Counts</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <Stat label="Tasks processed" value={fmt.number(run.tasks_processed)}/>
            <Stat label="Time entries" value={fmt.number(run.time_entries_processed)}/>
            <Stat label="Costs calculated" value={fmt.number(run.costs_calculated)}/>
            <Stat label="Errors" value={fmt.number(run.errors_count)}/>
          </div>
        </div>

        {run.error_message && (
          <div>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Error</h3>
            <div style={{ padding: 12, background: 'var(--pill-red-bg)', borderRadius: 6, color: 'var(--pill-red-text)', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
              {run.error_message}
            </div>
          </div>
        )}

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Logs</h3>
          <div style={{
            background: '#0b0d10', color: '#cbd5e1', borderRadius: 6,
            padding: 12, fontFamily: 'ui-monospace, monospace', fontSize: 11,
            lineHeight: 1.7, maxHeight: 280, overflowY: 'auto',
          }}>
            {run.logs.map((line, i) => {
              const tone = line.includes('[ERROR]') ? '#fb7185' : line.includes('[WARN]') ? '#fbbf24' : line.includes('[INFO]') ? '#60a5fa' : '#94a3b8';
              return <div key={i} style={{ color: tone }}>{line}</div>;
            })}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function WebhooksTab() {
  const events = window.MOCK.WEBHOOK_EVENTS;
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [eventFilter, setEventFilter] = React.useState('all');
  const [openEvent, setOpenEvent] = React.useState(null);

  const filtered = events.filter(e => {
    if (statusFilter === 'failed' && e.processed) return false;
    if (statusFilter === 'processed' && !e.processed) return false;
    if (eventFilter !== 'all' && e.event !== eventFilter) return false;
    if (search && !`${e.event} ${e.task_id} ${e.id}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const eventTypes = [...new Set(events.map(e => e.event))];

  const failedCount = events.filter(e => !e.processed).length;
  const totalCount = events.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <MetricCard dense label="Total events (24h)" value={fmt.number(totalCount)} icon={<Icons.Activity size={13}/>}/>
        <MetricCard dense label="Processed" value={fmt.number(totalCount - failedCount)} sublabel={`${Math.round((totalCount - failedCount) / totalCount * 100)}%`} icon={<Icons.CircleCheck size={13}/>}/>
        <MetricCard dense label="Failed" value={fmt.number(failedCount)} sublabel="needs retry" icon={<Icons.AlertTriangle size={13}/>}/>
        <MetricCard dense label="Avg latency" value="124ms" sublabel="p95: 412ms" icon={<Icons.Clock size={13}/>}/>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}>
        <div style={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
          <Input icon={<Icons.Search size={14}/>} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search event ID, task…"/>
        </div>
        <Select size="md" value={statusFilter} onChange={setStatusFilter} options={[
          { value: 'all', label: 'All statuses' },
          { value: 'processed', label: 'Processed' },
          { value: 'failed', label: 'Failed' },
        ]}/>
        <Select size="md" value={eventFilter} onChange={setEventFilter} options={[
          { value: 'all', label: 'All events' },
          ...eventTypes.map(e => ({ value: e, label: e })),
        ]}/>
        {failedCount > 0 && <Button size="md" variant="default" icon={<Icons.RefreshCw size={13}/>}>Retry all failed</Button>}
      </div>

      <Card padding={0}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--muted-bg)', textTransform: 'uppercase', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', fontWeight: 600 }}>
              <th style={{ textAlign: 'left', padding: '10px 16px', width: 80 }}>Status</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>Event</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>Task</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>Received</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>Latency</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>Attempts</th>
              <th style={{ width: 60, padding: '10px 16px' }}/>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={e.id} onClick={() => setOpenEvent(e)} style={{
                borderTop: i ? '1px solid var(--border-soft)' : 0, cursor: 'pointer',
              }}
                onMouseEnter={ev => ev.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}
              >
                <td style={{ padding: '10px 16px' }}>
                  {e.processed
                    ? <Pill tone="green" size="xs" icon={<Icons.CircleCheck size={10}/>}>OK</Pill>
                    : <Pill tone="red" size="xs" icon={<Icons.X size={10}/>}>fail</Pill>}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <Pill tone="blue" size="xs">{e.event}</Pill>
                </td>
                <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text)' }}>{e.task_id}</td>
                <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt.dateTime(e.received_at)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.latency_ms}ms</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: e.attempts > 1 ? 'var(--amber)' : 'var(--text-muted)' }}>{e.attempts}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                  <Icons.ChevronRight size={14}/>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <WebhookEventDrawer event={openEvent} onClose={() => setOpenEvent(null)}/>
    </div>
  );
}

function WebhookEventDrawer({ event, onClose }) {
  if (!event) return <Drawer open={false} onClose={onClose}/>;
  return (
    <Drawer open={!!event} onClose={onClose} width={580}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>{event.id}</div>
            <h2 style={{ fontSize: 17, fontWeight: 600, margin: '4px 0 0', color: 'var(--text)' }}>{event.event}</h2>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icons.X size={14}/>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {event.processed
            ? <Pill tone="green" icon={<Icons.CircleCheck size={11}/>}>Processed</Pill>
            : <Pill tone="red" icon={<Icons.X size={11}/>}>Failed</Pill>}
          <Pill tone="blue">{event.event}</Pill>
          <Pill tone="gray">{event.attempts} attempt{event.attempts === 1 ? '' : 's'}</Pill>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <MetaGrid items={[
          ['Task ID', event.task_id],
          ['Received', fmt.dateTime(event.received_at)],
          ['Latency', `${event.latency_ms}ms`],
          ['Attempts', String(event.attempts)],
        ]}/>

        {event.error && (
          <div>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Error</h3>
            <div style={{ padding: 12, background: 'var(--pill-red-bg)', borderRadius: 6, color: 'var(--pill-red-text)', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{event.error}</div>
          </div>
        )}

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Payload</h3>
          <pre style={{
            background: '#0b0d10', color: '#cbd5e1', borderRadius: 6,
            padding: 12, fontFamily: 'ui-monospace, monospace', fontSize: 11,
            lineHeight: 1.6, margin: 0, overflow: 'auto', maxHeight: 320,
          }}>{JSON.stringify(event.payload, null, 2)}</pre>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <Button variant="default" icon={<Icons.RefreshCw size={12}/>}>Retry</Button>
          <Button variant="ghost" icon={<Icons.Copy size={12}/>}>Copy payload</Button>
        </div>
      </div>
    </Drawer>
  );
}

window.SyncLogsPage = SyncLogsPage;
