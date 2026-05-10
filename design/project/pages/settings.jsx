// Page: Settings — connection, sync rules, scopes, members

function SettingsPage() {
  const [tab, setTab] = React.useState('connection');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Settings"
        description="ClickUp connection, sync configuration, and access controls."
      />
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'connection', label: 'Connection' },
        { value: 'sync', label: 'Sync rules' },
        { value: 'scopes', label: 'Scope filters' },
        { value: 'members', label: 'Members & access' },
        { value: 'notifications', label: 'Notifications' },
      ]}/>
      <div>
        {tab === 'connection' && <ConnectionTab/>}
        {tab === 'sync' && <SyncRulesTab/>}
        {tab === 'scopes' && <ScopeFiltersTab/>}
        {tab === 'members' && <MembersTab/>}
        {tab === 'notifications' && <NotificationsTab/>}
      </div>
    </div>
  );
}

function ConnectionTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
      <Card>
        <SectionTitle title="ClickUp workspace" subtitle="Source of truth for tasks, time tracking, and rates."/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: 'var(--muted-bg)', borderRadius: 10, marginTop: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'linear-gradient(135deg, #FF02F0 0%, #7B68EE 50%, #49CCF9 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 18,
          }}>C</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Acme Co Workspace</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>workspace_id: 90123456</span>
              <span>·</span>
              <span>Connected by ahmad@acme.co</span>
            </div>
          </div>
          <Pill tone="green" icon={<Icons.CircleCheck size={11}/>}>Connected</Pill>
        </div>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <Stat label="Last successful sync" value="2 min ago"/>
          <Stat label="Webhook endpoint" value="active"/>
          <Stat label="Token expires" value="Mar 12, 2026"/>
          <Stat label="API quota (today)" value="14k / 100k"/>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-soft)' }}>
          <Button variant="default" icon={<Icons.RefreshCw size={13}/>}>Test connection</Button>
          <Button variant="default" icon={<Icons.Key size={13}/>}>Rotate token</Button>
          <span style={{ flex: 1 }}/>
          <Button variant="ghost" style={{ color: 'var(--red)' }} icon={<Icons.Unlink size={13}/>}>Disconnect</Button>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Webhook" subtitle="Real-time event delivery from ClickUp."/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <Field label="Endpoint URL" hint="Configured in ClickUp Apps">
            <Input value="https://sync.acme.co/webhooks/clickup" readOnly icon={<Icons.Lock size={14}/>}/>
          </Field>
          <Field label="Subscribed events">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['taskCreated', 'taskUpdated', 'taskDeleted', 'taskStatusUpdated', 'taskAssigneeUpdated', 'taskTimeTrackedUpdated'].map(ev => (
                <Pill key={ev} tone="blue" size="sm">{ev}</Pill>
              ))}
            </div>
          </Field>
          <Field label="Signing secret">
            <Input value="whsec_••••••••••••••••3a91" readOnly type="password"/>
          </Field>
        </div>
      </Card>
    </div>
  );
}

function SyncRulesTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
      <Card>
        <SectionTitle title="Sync schedule" subtitle="When to perform full reconciliation runs."/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <SettingRow label="Real-time webhooks" desc="Apply changes as ClickUp events arrive." control={<Switch checked={true}/>}/>
          <SettingRow label="Full reconciliation" desc="Runs in addition to webhook events to catch drift." control={
            <Select size="sm" value="hourly" onChange={() => {}} options={[
              { value: 'never', label: 'Disabled' },
              { value: 'hourly', label: 'Every hour' },
              { value: 'daily', label: 'Daily at 03:00 UTC' },
              { value: 'weekly', label: 'Weekly' },
            ]}/>
          }/>
          <SettingRow label="Backfill on connect" desc="When connecting a new space, fetch all historical tasks and entries." control={<Switch checked={true}/>}/>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Cost calculation" subtitle="How labor cost is computed from time entries."/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <SettingRow label="Default currency" control={
            <Select size="sm" value="USD" onChange={() => {}} options={[
              { value: 'USD', label: 'USD ($)' }, { value: 'EUR', label: 'EUR (€)' }, { value: 'GBP', label: 'GBP (£)' },
            ]}/>
          }/>
          <SettingRow label="Rate matching" desc="Pick rate by time entry start date (recommended) or by task due date." control={
            <Select size="sm" value="start" onChange={() => {}} options={[
              { value: 'start', label: 'Start date' },
              { value: 'due', label: 'Task due date' },
            ]}/>
          }/>
          <SettingRow label="Auto-recalculate on rate change" desc="Recompute affected entries when rates are added or edited." control={<Switch checked={true}/>}/>
          <SettingRow label="Treat non-billable as zero cost" desc="Skip cost calc for non-billable entries." control={<Switch checked={false}/>}/>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Failure handling"/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <SettingRow label="Webhook retry" desc="Exponential backoff up to N attempts before parking in dead-letter." control={
            <Select size="sm" value="5" onChange={() => {}} options={[
              { value: '3', label: '3 attempts' },
              { value: '5', label: '5 attempts' },
              { value: '10', label: '10 attempts' },
            ]}/>
          }/>
          <SettingRow label="Pause syncing on repeated failure" desc="If 25+ webhooks fail consecutively, pause and alert." control={<Switch checked={true}/>}/>
        </div>
      </Card>
    </div>
  );
}

function ScopeFiltersTab() {
  const spaces = window.MOCK.SPACES;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
      <Callout tone="blue" icon={<Icons.Info size={13}/>}>
        Only checked spaces are included in syncing. Excluded spaces will not generate tasks, time entries, or cost rows.
      </Callout>
      <Card>
        <SectionTitle title="Synced spaces" subtitle={`${spaces.filter(s => s.synced).length} of ${spaces.length} included`}/>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {spaces.map(s => (
            <div key={s.space_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, background: 'var(--muted-bg)', marginBottom: 4 }}>
              <Switch checked={s.synced}/>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {s.task_count} tasks · {s.member_count} members · {fmt.hours(s.hours_logged)}
                </div>
              </div>
              {s.archived && <Pill tone="gray" size="xs">archived</Pill>}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Status filters" subtitle="Tasks in these statuses are excluded from cost rollups."/>
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {['cancelled', 'archived', 'duplicate'].map(st => (
            <Pill key={st} tone="gray">{st} <Icons.X size={10}/></Pill>
          ))}
          <button style={{
            padding: '4px 10px', border: '1px dashed var(--border-strong)', borderRadius: 999,
            background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}><Icons.Plus size={11}/> Add status</button>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Tag filters" subtitle="Optional — only include tasks with these tags (leave blank to include all)."/>
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No tag filters set — all tags included.</span>
        </div>
      </Card>
    </div>
  );
}

function MembersTab() {
  const members = window.MOCK.ASSIGNEES.slice(0, 6).map((u, i) => ({
    ...u,
    role: i === 0 ? 'Owner' : i < 2 ? 'Admin' : i < 4 ? 'Member' : 'Viewer',
    last_active: i * 3 + 1,
  }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
      <Card padding={0}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Members & access</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{members.length} people with access to this dashboard.</div>
          </div>
          <Button variant="accent" icon={<Icons.Plus size={13}/>}>Invite member</Button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--muted-bg)', textTransform: 'uppercase', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', fontWeight: 600 }}>
              <th style={{ textAlign: 'left', padding: '8px 16px' }}>Member</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Role</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Last active</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>2FA</th>
              <th style={{ width: 60, padding: '8px 16px' }}/>
            </tr>
          </thead>
          <tbody>
            {members.map((m, i) => (
              <tr key={m.id} style={{ borderTop: i ? '1px solid var(--border-soft)' : 0 }}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar user={m} size={28}/>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '12px' }}>
                  <Pill tone={m.role === 'Owner' ? 'purple' : m.role === 'Admin' ? 'blue' : 'gray'} size="sm">{m.role}</Pill>
                </td>
                <td style={{ padding: '12px', color: 'var(--text-muted)' }}>{m.last_active === 1 ? 'just now' : `${m.last_active}h ago`}</td>
                <td style={{ padding: '12px' }}>
                  {i % 2 === 0
                    ? <Pill tone="green" size="xs" icon={<Icons.CircleCheck size={10}/>}>enabled</Pill>
                    : <Pill tone="amber" size="xs">not set</Pill>}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <Button variant="ghost" size="sm" icon={<Icons.Edit size={12}/>}/>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function NotificationsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
      <Card>
        <SectionTitle title="Alerts" subtitle="Get notified when sync issues need attention."/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <SettingRow label="Sync run failed" desc="Notify on any failed sync run." control={<Switch checked={true}/>}/>
          <SettingRow label="Webhook errors spike" desc="Alert if more than 25 webhooks fail in 5 min." control={<Switch checked={true}/>}/>
          <SettingRow label="Missing rate created" desc="Alert when an assignee logs time without a rate." control={<Switch checked={true}/>}/>
          <SettingRow label="Token expiring" desc="Notify 14 days before ClickUp token expires." control={<Switch checked={true}/>}/>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Channels"/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <SettingRow label="Email" desc="ops-alerts@acme.co" control={<Switch checked={true}/>}/>
          <SettingRow label="Slack" desc="#data-platform-alerts" control={<Switch checked={true}/>}/>
          <SettingRow label="PagerDuty" desc="Connect for critical failures" control={<Switch checked={false}/>}/>
        </div>
      </Card>
    </div>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function SettingRow({ label, desc, control }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>}
      </div>
      <div>{control}</div>
    </div>
  );
}

window.SettingsPage = SettingsPage;
