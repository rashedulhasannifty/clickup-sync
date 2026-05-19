import { useState, type ReactNode } from 'react';
import {
  CircleCheck,
  Edit,
  Info,
  Key,
  Lock,
  Plus,
  RefreshCw,
  Unlink,
  X,
} from 'lucide-react';
import { useSpaces, useSyncHealth } from '../hooks/useReports';
import { useTagAssignee, useCreateTagAssignee, useUpdateTagAssignee, useDeleteTagAssignee } from '../hooks/useTagAssignee';
import { useRegisterWebhook } from '../hooks/useAdmin';
import type { TagAssignee } from '../api/tag-assignee';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Switch } from '../components/ui/Switch';
import { Pill } from '../components/ui/Pill';
import { Avatar } from '../components/ui/Avatar';
import { Callout } from '../components/ui/Callout';
import { EmptyState } from '../components/ui/EmptyState';
import { Field } from '../components/ui/Field';
import { Select } from '../components/ui/Select';
import { fmt } from '../lib/formatters';

const TAB_ITEMS = [
  { value: 'connection', label: 'Connection' },
  { value: 'sync', label: 'Sync rules' },
  { value: 'scopes', label: 'Scope filters' },
  { value: 'members', label: 'Members & access' },
  { value: 'notifications', label: 'Notifications' },
];

const WEBHOOK_EVENTS = [
  'taskCreated',
  'taskUpdated',
  'taskDeleted',
  'taskStatusUpdated',
  'taskAssigneeUpdated',
  'taskTimeTrackedUpdated',
];

const PALETTE = ['#7B68EE', '#FF02F0', '#49CCF9', '#10b981', '#f59e0b', '#ef4444'];

function spaceColor(spaceId: string | null | undefined): string {
  const id = spaceId ?? '';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {subtitle != null && subtitle !== '' && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
      )}
    </div>
  );
}

function SettingRow({ label, desc, control }: { label: string; desc?: string; control: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 0',
        borderBottom: '1px solid var(--border-soft)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '10px 14px', background: 'var(--muted-bg)', borderRadius: 8 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-muted)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

interface TagFormState {
  tagName: string;
  clickupUserId: string;
  clickupUserName: string;
  clickupEmail: string;
  active: boolean;
}

const emptyForm: TagFormState = {
  tagName: '',
  clickupUserId: '',
  clickupUserName: '',
  clickupEmail: '',
  active: true,
};

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('connection');
  const syncHealth = useSyncHealth();
  const spacesQuery = useSpaces();
  const tagAssignee = useTagAssignee();
  const createTagAssignee = useCreateTagAssignee();
  const updateTagAssignee = useUpdateTagAssignee();
  const deleteTagAssignee = useDeleteTagAssignee();
  const registerWebhook = useRegisterWebhook();

  const [showTagForm, setShowTagForm] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagForm, setTagForm] = useState<TagFormState>(emptyForm);

  const [reconcileCadence, setReconcileCadence] = useState('hourly');
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [rateMatch, setRateMatch] = useState('start');
  const [webhookRetries, setWebhookRetries] = useState('5');

  const [alertSyncFail, setAlertSyncFail] = useState(true);
  const [alertWebhookSpike, setAlertWebhookSpike] = useState(true);
  const [alertMissingRate, setAlertMissingRate] = useState(true);
  const [alertToken, setAlertToken] = useState(true);
  const [chEmail, setChEmail] = useState(true);
  const [chSlack, setChSlack] = useState(true);
  const [chPager, setChPager] = useState(false);

  const lastSyncAt = syncHealth.data?.[0]?.lastSuccessfulSyncAt;
  const webhookStatus = syncHealth.data?.[0]?.status ?? 'Unknown';
  const webhookUrl = import.meta.env.VITE_WEBHOOK_URL ?? 'https://your-domain.com/webhooks/clickup';

  const spaceRows = Array.isArray(spacesQuery.data) ? spacesQuery.data : [];

  const tagItems: TagAssignee[] = tagAssignee.data ?? [];

  function startAddTag() {
    setEditingTagId(null);
    setTagForm(emptyForm);
    setShowTagForm(true);
  }

  function startEditTag(row: TagAssignee) {
    setEditingTagId(row.id);
    setTagForm({
      tagName: row.tagName,
      clickupUserId: row.clickupUserId,
      clickupUserName: row.clickupUserName ?? '',
      clickupEmail: row.clickupEmail ?? '',
      active: row.active,
    });
    setShowTagForm(true);
  }

  function cancelTagForm() {
    setShowTagForm(false);
    setEditingTagId(null);
    setTagForm(emptyForm);
  }

  function saveTagForm() {
    const payload = {
      tagName: tagForm.tagName,
      clickupUserId: tagForm.clickupUserId,
      clickupUserName: tagForm.clickupUserName || null,
      clickupEmail: tagForm.clickupEmail || null,
      active: tagForm.active,
    };
    if (editingTagId) {
      updateTagAssignee.mutate({ id: editingTagId, data: payload }, { onSuccess: () => cancelTagForm() });
    } else {
      createTagAssignee.mutate(payload, { onSuccess: () => cancelTagForm() });
    }
  }

  function deleteTag(id: string) {
    if (!window.confirm('Delete this tag-assignee mapping?')) return;
    deleteTagAssignee.mutate(id);
  }

  const webhookEndpointLabel =
    webhookStatus === 'Fresh' ? 'active' : webhookStatus === 'Stale' ? 'stale' : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Settings"
        description="ClickUp connection, sync configuration, and access controls."
      />
      <Tabs items={TAB_ITEMS} value={activeTab} onChange={setActiveTab} variant="underline" />

      {activeTab === 'connection' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
          <Card>
            <SectionTitle title="ClickUp workspace" subtitle="Source of truth for tasks, time tracking, and rates." />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: 14,
                background: 'var(--muted-bg)',
                borderRadius: 10,
                marginTop: 12,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #FF02F0 0%, #7B68EE 50%, #49CCF9 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 700,
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                C
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Nifty IT Solution</div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 2,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>workspace_id: 3450636</span>
                  <span>·</span>
                  <span>Connected by API key</span>
                </div>
              </div>
              <Pill tone="green" icon={<CircleCheck size={11} />}>
                Connected
              </Pill>
            </div>

            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <Stat label="Last successful sync" value={lastSyncAt ? fmt.relative(lastSyncAt) : '—'} />
              <Stat label="Webhook endpoint" value={webhookEndpointLabel} />
              <Stat label="Token expires" value="—" />
              <Stat label="API quota (today)" value="—" />
            </div>

            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 14,
                paddingTop: 14,
                borderTop: '1px solid var(--border-soft)',
                flexWrap: 'wrap',
              }}
            >
              <Button variant="default" icon={<RefreshCw size={13} />} disabled>
                Test connection
              </Button>
              <Button variant="default" icon={<Key size={13} />} disabled>
                Rotate token
              </Button>
              <span style={{ flex: 1 }} />
              <Button variant="ghost" style={{ color: 'var(--red)' }} icon={<Unlink size={13} />} disabled>
                Disconnect
              </Button>
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <SectionTitle
                title="Webhook"
                subtitle={
                  <>
                    Real-time event delivery from{' '}
                    <a href="https://clickup.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                      ClickUp
                    </a>
                    .
                  </>
                }
              />
              {webhookStatus === 'Fresh' ? (
                <Pill tone="green" icon={<CircleCheck size={11} />}>Active</Pill>
              ) : webhookStatus === 'Stale' ? (
                <Pill tone="amber">Stale</Pill>
              ) : (
                <Pill tone="gray">Not registered</Pill>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <Field label="Endpoint URL" hint="Set via VITE_WEBHOOK_URL — not editable here">
                <Input value={webhookUrl} readOnly icon={<Lock size={14} />} onChange={() => undefined} />
              </Field>
              <Field label="Subscribed events">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {WEBHOOK_EVENTS.map((ev) => (
                    <Pill key={ev} tone="blue" size="sm">
                      {ev}
                    </Pill>
                  ))}
                </div>
              </Field>
              <Field label="Signing secret" hint="Stored in CLICKUP_WEBHOOK_SECRET on the server — not editable here">
                <Input value="whsec_••••••••••••••••••••" readOnly type="password" onChange={() => undefined} />
              </Field>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Button
                  variant={webhookStatus === 'Fresh' ? 'default' : 'accent'}
                  onClick={() => registerWebhook.mutate(undefined)}
                  loading={registerWebhook.isPending}
                >
                  {webhookStatus === 'Fresh' ? 'Reconnect' : 'Register Webhook'}
                </Button>
                {registerWebhook.data && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Webhook ID: {(registerWebhook.data as { webhookId?: string }).webhookId ?? '—'}
                    {(registerWebhook.data as { action?: string }).action === 'existing' && ' · already active'}
                  </span>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'sync' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
          <Card>
            <SectionTitle title="Sync schedule" subtitle="When to perform full reconciliation runs." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 12 }}>
              <SettingRow
                label="Real-time webhooks"
                desc="Apply changes as ClickUp events arrive."
                control={<Switch checked disabled onChange={() => undefined} />}
              />
              <SettingRow
                label="Full reconciliation"
                desc="Runs in addition to webhook events to catch drift."
                control={
                  <Select
                    size="sm"
                    value={reconcileCadence}
                    onChange={setReconcileCadence}
                    options={[
                      { value: 'never', label: 'Disabled' },
                      { value: 'hourly', label: 'Every hour' },
                      { value: 'daily', label: 'Daily at 03:00 UTC' },
                      { value: 'weekly', label: 'Weekly' },
                    ]}
                  />
                }
              />
              <SettingRow
                label="Backfill on connect"
                desc="When connecting a new space, fetch all historical tasks and entries."
                control={<Switch checked disabled onChange={() => undefined} />}
              />
            </div>
          </Card>

          <Card>
            <SectionTitle title="Cost calculation" subtitle="How labor cost is computed from time entries." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 12 }}>
              <SettingRow
                label="Default currency"
                control={
                  <Select
                    size="sm"
                    value={defaultCurrency}
                    onChange={setDefaultCurrency}
                    options={[
                      { value: 'USD', label: 'USD ($)' },
                      { value: 'EUR', label: 'EUR (€)' },
                      { value: 'GBP', label: 'GBP (£)' },
                    ]}
                  />
                }
              />
              <SettingRow
                label="Rate matching"
                desc="Pick rate by time entry start date (recommended) or by task due date."
                control={
                  <Select
                    size="sm"
                    value={rateMatch}
                    onChange={setRateMatch}
                    options={[
                      { value: 'start', label: 'Start date' },
                      { value: 'due', label: 'Task due date' },
                    ]}
                  />
                }
              />
              <SettingRow
                label="Auto-recalculate on rate change"
                desc="Recompute affected entries when rates are added or edited."
                control={<Switch checked disabled onChange={() => undefined} />}
              />
              <SettingRow
                label="Treat non-billable as zero cost"
                desc="Skip cost calc for non-billable entries."
                control={<Switch checked={false} disabled onChange={() => undefined} />}
              />
            </div>
          </Card>

          <Card>
            <SectionTitle title="Failure handling" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 12 }}>
              <SettingRow
                label="Webhook retry"
                desc="Exponential backoff up to N attempts before parking in dead-letter."
                control={
                  <Select
                    size="sm"
                    value={webhookRetries}
                    onChange={setWebhookRetries}
                    options={[
                      { value: '3', label: '3 attempts' },
                      { value: '5', label: '5 attempts' },
                      { value: '10', label: '10 attempts' },
                    ]}
                  />
                }
              />
              <SettingRow
                label="Pause syncing on repeated failure"
                desc="If 25+ webhooks fail consecutively, pause and alert."
                control={<Switch checked disabled onChange={() => undefined} />}
              />
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <SectionTitle title="Tag–assignee map" subtitle="Map ClickUp tags to assignees for tracked-time replacement." />
              <Button variant="ghost" size="sm" onClick={startAddTag}>
                Add mapping
              </Button>
            </div>

            {showTagForm && (
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 14,
                  marginBottom: 14,
                  background: 'var(--muted-bg)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Tag name">
                    <Input
                      value={tagForm.tagName}
                      onChange={(e) => setTagForm((f) => ({ ...f, tagName: e.target.value }))}
                      placeholder="e.g. rashedul"
                    />
                  </Field>
                  <Field label="User ID">
                    <Input
                      value={tagForm.clickupUserId}
                      onChange={(e) => setTagForm((f) => ({ ...f, clickupUserId: e.target.value }))}
                      placeholder="ClickUp user ID"
                    />
                  </Field>
                  <Field label="User name">
                    <Input
                      value={tagForm.clickupUserName}
                      onChange={(e) => setTagForm((f) => ({ ...f, clickupUserName: e.target.value }))}
                      placeholder="Display name"
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      value={tagForm.clickupEmail}
                      onChange={(e) => setTagForm((f) => ({ ...f, clickupEmail: e.target.value }))}
                      placeholder="user@example.com"
                    />
                  </Field>
                </div>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <Switch checked={tagForm.active} onChange={(v) => setTagForm((f) => ({ ...f, active: v }))} />
                  Active
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={saveTagForm}
                    loading={createTagAssignee.isPending || updateTagAssignee.isPending}
                  >
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" onClick={cancelTagForm}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {tagAssignee.isLoading ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
            ) : tagItems.length === 0 ? (
              <EmptyState title="No mappings" body="Add tag-to-assignee mappings to enable tracked-time replacement." />
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr
                      style={{
                        background: 'var(--muted-bg)',
                        textTransform: 'uppercase',
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        letterSpacing: '0.05em',
                        fontWeight: 600,
                      }}
                    >
                      <th style={{ textAlign: 'left', padding: '8px 16px' }}>Tag</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>User ID</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>Name</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>Email</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>Active</th>
                      <th style={{ width: 100, padding: '8px 16px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {tagItems.map((row, i) => (
                      <tr key={row.id} style={{ borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined }}>
                        <td style={{ padding: '10px 16px' }}>
                          <Pill tone="purple" size="sm">
                            {row.tagName}
                          </Pill>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                          {row.clickupUserId}
                        </td>
                        <td style={{ padding: '10px 12px' }}>{row.clickupUserName ?? '—'}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{row.clickupEmail ?? '—'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <Switch
                            checked={row.active}
                            onChange={(v) => updateTagAssignee.mutate({ id: row.id, data: { active: v } })}
                          />
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                          <Button size="sm" variant="ghost" onClick={() => startEditTag(row)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => deleteTag(row.id)}>
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'scopes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
          <Callout tone="blue" icon={<Info size={13} />}>
            Only checked spaces are included in syncing. Excluded spaces will not generate tasks, time entries, or cost rows.
          </Callout>
          <Card>
            <SectionTitle
              title="Synced spaces"
              subtitle={
                spaceRows.length > 0 ? `${spaceRows.length} of ${spaceRows.length} included` : '0 of 0 included'
              }
            />
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {spaceRows.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No spaces loaded yet. Sync data to see spaces here.</p>
              ) : (
                spaceRows.map((s) => {
                  const name = (s as { spaceName?: string | null }).spaceName?.trim() || (s as { spaceId?: string }).spaceId || 'Space';
                  const sid = (s as { spaceId?: string }).spaceId ?? '';
                  const taskCount = (s as { taskCount?: number }).taskCount ?? 0;
                  const hours = (s as { hoursLogged?: number }).hoursLogged ?? 0;
                  return (
                    <div
                      key={sid}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: 10,
                        borderRadius: 8,
                        background: 'var(--muted-bg)',
                        marginBottom: 4,
                      }}
                    >
                      <Switch checked disabled onChange={() => undefined} />
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: spaceColor(sid),
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {fmt.number(taskCount)} tasks · — members · {fmt.hours(hours)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card>
            <SectionTitle title="Status filters" subtitle="Tasks in these statuses are excluded from cost rollups." />
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {['cancelled', 'archived', 'duplicate'].map((st) => (
                <Pill key={st} tone="gray" size="sm">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {st}
                    <X size={10} />
                  </span>
                </Pill>
              ))}
              <button
                type="button"
                style={{
                  padding: '4px 10px',
                  border: '1px dashed var(--border)',
                  borderRadius: 999,
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: 'inherit',
                }}
              >
                <Plus size={11} /> Add status
              </button>
            </div>
          </Card>

          <Card>
            <SectionTitle title="Tag filters" subtitle="Optional — only include tasks with these tags (leave blank to include all)." />
            <div style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No tag filters set — all tags included.</span>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'members' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
          <Card padding={0}>
            <div
              style={{
                padding: '14px 16px',
                borderBottom: '1px solid var(--border-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Members & access</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  1 person with access to this dashboard.
                </div>
              </div>
              <Button variant="accent" icon={<Plus size={13} />} disabled>
                Invite member
              </Button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr
                  style={{
                    background: 'var(--muted-bg)',
                    textTransform: 'uppercase',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                  }}
                >
                  <th style={{ textAlign: 'left', padding: '8px 16px' }}>Member</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Role</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Last active</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>2FA</th>
                  <th style={{ width: 60, padding: '8px 16px' }} />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name="Admin" size={28} />
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>Admin</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>API key holder</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <Pill tone="purple" size="sm">
                      Owner
                    </Pill>
                  </td>
                  <td style={{ padding: '12px', color: 'var(--text-muted)' }}>just now</td>
                  <td style={{ padding: '12px' }}>
                    <Pill tone="green" size="xs" icon={<CircleCheck size={10} />}>
                      enabled
                    </Pill>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <Button variant="ghost" size="sm" icon={<Edit size={12} />} disabled />
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
          <Card>
            <SectionTitle title="Alerts" subtitle="Get notified when sync issues need attention." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 12 }}>
              <SettingRow
                label="Sync run failed"
                desc="Notify on any failed sync run."
                control={<Switch checked={alertSyncFail} onChange={setAlertSyncFail} />}
              />
              <SettingRow
                label="Webhook errors spike"
                desc="Alert if more than 25 webhooks fail in 5 min."
                control={<Switch checked={alertWebhookSpike} onChange={setAlertWebhookSpike} />}
              />
              <SettingRow
                label="Missing rate created"
                desc="Alert when an assignee logs time without a rate."
                control={<Switch checked={alertMissingRate} onChange={setAlertMissingRate} />}
              />
              <SettingRow
                label="Token expiring"
                desc="Notify 14 days before ClickUp token expires."
                control={<Switch checked={alertToken} onChange={setAlertToken} />}
              />
            </div>
          </Card>

          <Card>
            <SectionTitle title="Channels" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 12 }}>
              <SettingRow label="Email" desc="ops-alerts@acme.co" control={<Switch checked={chEmail} onChange={setChEmail} />} />
              <SettingRow label="Slack" desc="#data-platform-alerts" control={<Switch checked={chSlack} onChange={setChSlack} />} />
              <SettingRow
                label="PagerDuty"
                desc="Connect for critical failures"
                control={<Switch checked={chPager} onChange={setChPager} />}
              />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
