import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CircleCheck,
  Clock,
  History,
  Info,
  Lock,
  RefreshCw,
  Webhook,
} from 'lucide-react';
import { useSpaces, useSyncHealth } from '../hooks/useReports';
import { useTagAssignee, useCreateTagAssignee, useUpdateTagAssignee, useDeleteTagAssignee } from '../hooks/useTagAssignee';
import { useRegisterWebhook, useTestClickupConnection, useReconcileTasks, useReconcileActive } from '../hooks/useAdmin';
import { useSettings, useUpdateSettings } from '../hooks/useSettings';
import { useAuth } from '../hooks/useAuth';
import { RequireRole } from '../components/RequireRole';
import type { SettingsPatch } from '../api/settings';
import type { TagAssignee } from '../api/tag-assignee';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Switch } from '../components/ui/Switch';
import { Pill } from '../components/ui/Pill';
import { Callout } from '../components/ui/Callout';
import { EmptyState } from '../components/ui/EmptyState';
import { Field } from '../components/ui/Field';
import { Select } from '../components/ui/Select';
import { fmt } from '../lib/formatters';

const ALL_TAB_ITEMS = [
  { value: 'connection', label: 'Connection', ownerOnly: true },
  { value: 'sync', label: 'Sync rules', ownerOnly: false },
  { value: 'scopes', label: 'Scope filters', ownerOnly: false },
  { value: 'notifications', label: 'Notifications', ownerOnly: false },
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
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</div>
      {subtitle != null && subtitle !== '' && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>{subtitle}</div>
      )}
    </div>
  );
}

/** Card header with a hairline divider so the title reads as a real section
 *  head instead of floating text. `action` sits flush-right (status pill, etc). */
function CardHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        paddingBottom: 14,
        marginBottom: 16,
        borderBottom: '1px solid var(--border-soft)',
      }}
    >
      <SectionTitle title={title} subtitle={subtitle} />
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
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

const DOT: Record<'green' | 'amber' | 'gray', { color: string; ring: string }> = {
  green: { color: 'var(--green)', ring: 'rgba(16, 185, 129, 0.18)' },
  amber: { color: 'var(--amber)', ring: 'rgba(245, 158, 11, 0.18)' },
  gray: { color: 'var(--text-faint)', ring: 'rgba(148, 163, 184, 0.18)' },
};

function Stat({
  label,
  value,
  icon,
  dotTone,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  dotTone?: 'green' | 'amber' | 'gray';
}) {
  const dot = dotTone ? DOT[dotTone] : null;
  return (
    <div
      style={{
        padding: '11px 13px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 9,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-faint)',
          }}
        >
          {label}
        </span>
        {icon && <span style={{ color: 'var(--text-faint)', display: 'flex', flexShrink: 0 }}>{icon}</span>}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text)',
          minWidth: 0,
        }}
      >
        {dot && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: dot.color,
              boxShadow: `0 0 0 3px ${dot.ring}`,
              flexShrink: 0,
            }}
          />
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      </div>
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
  const { hasRole } = useAuth();
  const [activeTab, setActiveTab] = useState(() => (hasRole('OWNER') ? 'connection' : 'sync'));
  const syncHealth = useSyncHealth();
  const spacesQuery = useSpaces();
  const tagAssignee = useTagAssignee();
  const createTagAssignee = useCreateTagAssignee();
  const updateTagAssignee = useUpdateTagAssignee();
  const deleteTagAssignee = useDeleteTagAssignee();
  const registerWebhook = useRegisterWebhook();
  const testConnection = useTestClickupConnection();
  const reconcileTasks = useReconcileTasks();
  const reconcileProgress = useReconcileActive(hasRole('ADMIN'));
  const settingsQuery = useSettings();
  const updateSettings = useUpdateSettings();

  // Editable ClickUp connection form. API token + webhook secret are write-only:
  // empty means "leave unchanged"; the masked status comes from the query.
  const [connForm, setConnForm] = useState({
    teamId: '',
    webhookEndpoint: '',
    webhookEvents: '',
    apiToken: '',
    webhookSecret: '',
  });
  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    setConnForm((f) => ({
      ...f,
      teamId: s.teamId ?? '',
      webhookEndpoint: s.webhookEndpoint ?? '',
      webhookEvents: s.webhookEvents ?? '',
    }));
  }, [settingsQuery.data]);

  function saveConnection() {
    const patch: SettingsPatch = {
      teamId: connForm.teamId,
      webhookEndpoint: connForm.webhookEndpoint,
      webhookEvents: connForm.webhookEvents,
    };
    if (connForm.apiToken.trim()) patch.apiToken = connForm.apiToken.trim();
    if (connForm.webhookSecret.trim()) patch.webhookSecret = connForm.webhookSecret.trim();
    updateSettings.mutate(patch, {
      onSuccess: () => {
        showBanner('Settings saved.', 'blue');
        setConnForm((f) => ({ ...f, apiToken: '', webhookSecret: '' }));
      },
      onError: (err) => showBanner(`Save failed: ${(err as Error).message}`, 'red'),
    });
  }

  // Auto-dismissing inline banner for Test connection / Register webhook
  // results — same pattern as the other pages.
  const [banner, setBanner] = useState<{ tone: 'blue' | 'red'; text: string } | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
  }, []);
  function showBanner(text: string, tone: 'blue' | 'red' = 'blue') {
    setBanner({ tone, text });
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setBanner(null), 5000);
  }

  const [showTagForm, setShowTagForm] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagForm, setTagForm] = useState<TagFormState>(emptyForm);

  const [reconcileDays, setReconcileDays] = useState('365');
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [rateMatch, setRateMatch] = useState('start');
  const [webhookRetries, setWebhookRetries] = useState('5');
  const [capInput, setCapInput] = useState('');
  useEffect(() => {
    if (settingsQuery.data?.spikeHoursCap != null) setCapInput(String(settingsQuery.data.spikeHoursCap));
  }, [settingsQuery.data?.spikeHoursCap]);

  const [alertSyncFail, setAlertSyncFail] = useState(true);
  const [alertWebhookSpike, setAlertWebhookSpike] = useState(true);
  const [alertMissingRate, setAlertMissingRate] = useState(true);
  const [alertToken, setAlertToken] = useState(true);
  const [chEmail, setChEmail] = useState(true);
  const [chSlack, setChSlack] = useState(true);
  const [chPager, setChPager] = useState(false);

  const lastSyncAt = syncHealth.data?.[0]?.lastSuccessfulSyncAt;
  const webhookStatus = syncHealth.data?.[0]?.status ?? 'Unknown';

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
      <Tabs
        items={ALL_TAB_ITEMS.filter((t) => !t.ownerOnly || hasRole('OWNER')).map((t) => ({ value: t.value, label: t.label }))}
        value={activeTab}
        onChange={setActiveTab}
        variant="underline"
      />

      {banner && <Callout tone={banner.tone}>{banner.text}</Callout>}

      {activeTab === 'connection' && (
        <RequireRole min="OWNER">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
          {settingsQuery.data && !settingsQuery.data.encryptionEnabled && (
            <Callout tone="amber" icon={<AlertTriangle size={13} />}>
              Secret storage is disabled — <code style={{ fontFamily: 'ui-monospace, monospace' }}>APP_ENCRYPTION_KEY</code> isn't set on
              the server. You can edit the team ID and webhook URL, but the API token and signing secret can't be saved until that key is
              configured (64 hex chars) and the backend restarts.
            </Callout>
          )}

          <Card>
            <CardHeader
              title="ClickUp connection"
              subtitle="API token and workspace used as the source of truth. Saved to the database — changes apply without a redeploy."
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: 14,
                background: 'linear-gradient(180deg, var(--accent-soft), transparent)',
                border: '1px solid var(--border)',
                borderRadius: 10,
              }}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
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
                    boxShadow: '0 2px 8px rgba(123, 104, 238, 0.25)',
                  }}
                >
                  C
                </div>
                {settingsQuery.data?.apiTokenSet && (
                  <span
                    style={{
                      position: 'absolute',
                      right: -2,
                      bottom: -2,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: 'var(--green)',
                      border: '2px solid var(--surface)',
                    }}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>ClickUp workspace</div>
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
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>workspace_id: {connForm.teamId || '—'}</span>
                  <span>·</span>
                  <span>{settingsQuery.data?.apiTokenSet ? 'Token configured' : 'No token'}</span>
                </div>
              </div>
              <Pill tone={settingsQuery.data?.apiTokenSet ? 'green' : 'gray'} icon={<CircleCheck size={11} />}>
                {settingsQuery.data?.apiTokenSet ? 'Connected' : 'No token'}
              </Pill>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              <Field label="Team / Workspace ID">
                <Input
                  value={connForm.teamId}
                  onChange={(e) => setConnForm((f) => ({ ...f, teamId: e.target.value }))}
                  placeholder="3450636"
                />
              </Field>
              <Field
                label="API token"
                hint={
                  settingsQuery.data?.apiTokenSet
                    ? `A token is set (ending ••${settingsQuery.data.apiTokenLast4 ?? ''}). Enter a new value to replace it.`
                    : 'No token set. Use a Workspace Owner/Admin token (pk_…).'
                }
              >
                <Input
                  value={connForm.apiToken}
                  type="password"
                  icon={<Lock size={14} />}
                  placeholder={settingsQuery.data?.apiTokenSet ? '•••• leave blank to keep current' : 'pk_...'}
                  onChange={(e) => setConnForm((f) => ({ ...f, apiToken: e.target.value }))}
                />
              </Field>
            </div>

            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <Stat
                label="Last successful sync"
                value={lastSyncAt ? fmt.relative(lastSyncAt) : '—'}
                icon={<Clock size={13} />}
                dotTone={lastSyncAt ? 'green' : 'gray'}
              />
              <Stat
                label="Webhook endpoint"
                value={webhookEndpointLabel}
                icon={<Webhook size={13} />}
                dotTone={webhookStatus === 'Fresh' ? 'green' : webhookStatus === 'Stale' ? 'amber' : 'gray'}
              />
              <Stat
                label="Settings updated"
                value={settingsQuery.data?.updatedAt ? fmt.relative(settingsQuery.data.updatedAt) : '—'}
                icon={<History size={13} />}
              />
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                marginTop: 16,
                paddingTop: 14,
                borderTop: '1px solid var(--border-soft)',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Verifies the stored token and team ID against the ClickUp API.
              </span>
              <Button
                variant="default"
                icon={<RefreshCw size={13} />}
                loading={testConnection.isPending}
                onClick={() =>
                  testConnection.mutate(undefined, {
                    onSuccess: (res) =>
                      showBanner(
                        `Connection OK — ClickUp returned ${res.memberCount} workspace member${res.memberCount === 1 ? '' : 's'}.`,
                        'blue',
                      ),
                    onError: (err) =>
                      showBanner(
                        `Connection failed: ${(err as Error).message}. Save a valid API token and team ID below, then retry.`,
                        'red',
                      ),
                  })
                }
              >
                Test connection
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader
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
              action={
                webhookStatus === 'Fresh' ? (
                  <Pill tone="green" icon={<CircleCheck size={11} />}>Active</Pill>
                ) : webhookStatus === 'Stale' ? (
                  <Pill tone="amber">Stale</Pill>
                ) : (
                  <Pill tone="gray">Not registered</Pill>
                )
              }
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Endpoint URL" hint="Public HTTPS URL ClickUp posts events to. Ends with /api/webhooks/clickup.">
                <Input
                  value={connForm.webhookEndpoint}
                  onChange={(e) => setConnForm((f) => ({ ...f, webhookEndpoint: e.target.value }))}
                  placeholder="https://your-domain.com/api/webhooks/clickup"
                />
              </Field>
              <Field label="Subscribed events" hint="Comma-separated ClickUp event types.">
                <Input
                  value={connForm.webhookEvents}
                  onChange={(e) => setConnForm((f) => ({ ...f, webhookEvents: e.target.value }))}
                  placeholder="taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated,taskStatusUpdated"
                />
              </Field>
              <Field
                label="Signing secret"
                hint={
                  settingsQuery.data?.webhookSecretSet
                    ? 'A secret is stored (encrypted). Register webhook re-issues it, or enter one manually to override.'
                    : 'Not set — click Register webhook to create and store one automatically.'
                }
              >
                <Input
                  value={connForm.webhookSecret}
                  type="password"
                  icon={<Lock size={14} />}
                  placeholder={settingsQuery.data?.webhookSecretSet ? '•••• leave blank to keep current' : 'set via Register webhook'}
                  onChange={(e) => setConnForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                />
              </Field>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Button
                  variant={webhookStatus === 'Fresh' ? 'default' : 'accent'}
                  loading={registerWebhook.isPending}
                  onClick={() =>
                    registerWebhook.mutate(undefined, {
                      onSuccess: (res) => {
                        const data = res as {
                          webhookId?: string;
                          action?: string;
                          secretStored?: boolean;
                          addedEvents?: string[];
                        };
                        const id = data.webhookId ?? '—';
                        if (data.action === 'existing') {
                          showBanner(`Webhook already active and subscribed to all configured events (id ${id}).`, 'blue');
                        } else if (data.action === 'updated') {
                          const added = data.addedEvents?.length
                            ? ` Added: ${data.addedEvents.join(', ')}.`
                            : '';
                          showBanner(
                            `Webhook re-subscribed (id ${id}).${added} Status-change history will start flowing in as tasks change status.`,
                            'blue',
                          );
                        } else {
                          showBanner(
                            `Webhook registered (id ${id}). ${data.secretStored ? 'Signing secret stored automatically.' : 'Secret could NOT be stored — set APP_ENCRYPTION_KEY.'}`,
                            data.secretStored === false ? 'red' : 'blue',
                          );
                        }
                        settingsQuery.refetch();
                      },
                      onError: (err) => showBanner(`Webhook registration failed: ${(err as Error).message}`, 'red'),
                    })
                  }
                >
                  {webhookStatus === 'Fresh' ? 'Reconnect' : 'Register Webhook'}
                </Button>
              </div>
            </div>
          </Card>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 16px',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Changes save to the database and apply immediately — no restart required.
            </span>
            <Button variant="accent" loading={updateSettings.isPending} onClick={saveConnection}>
              Save changes
            </Button>
          </div>
        </div>
        </RequireRole>
      )}

      {activeTab === 'sync' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
          {/* The schedule / cost / failure sections below describe current
              behavior, but the controls aren't wired to backend persistence
              yet — values shown reflect the hardcoded defaults the workers
              already use. The Tag-assignee map further down IS fully wired. */}
          <Callout tone="amber" icon={<Info size={13} />}>
            Preview only — settings below reflect the current behavior of the
            sync workers, but changes here aren't persisted yet. The
            <strong> Tag–assignee map</strong> at the bottom is the one
            exception: it's fully active and immediately applied.
          </Callout>

          <Card>
            <CardHeader title="Sync schedule" subtitle="When to perform full reconciliation runs." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <SettingRow
                label="Real-time webhooks"
                desc="Active — changes apply as ClickUp events arrive."
                control={<Switch checked disabled onChange={() => undefined} />}
              />
              <SettingRow
                label="Full reconciliation"
                desc="Not scheduled — run on demand. Sweeps every stored task: soft-deletes ones removed in ClickUp (and their time entries) and re-syncs the rest's tracked time, so deletions made directly in ClickUp show up here."
                control={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Input
                      type="number"
                      min={1}
                      value={reconcileDays}
                      onChange={(e) => setReconcileDays(e.target.value)}
                      style={{ width: 88 }}
                      aria-label="Reconciliation lookback in days"
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>days back</span>
                    <Button
                      size="sm"
                      variant="accent"
                      loading={reconcileTasks.isPending}
                      onClick={() => {
                        const days = Number(reconcileDays);
                        if (!Number.isFinite(days) || days < 1) {
                          showBanner('Enter a lookback of at least 1 day.', 'red');
                          return;
                        }
                        reconcileTasks.mutate(days, {
                          onSuccess: (res) => {
                            showBanner(
                              `Reconciliation queued for ${res.queued} task${res.queued === 1 ? '' : 's'} (last ${days} days). Deletions will clear as the jobs run.`,
                              'blue',
                            );
                            reconcileProgress.refetch();
                          },
                          onError: (err) => showBanner(`Reconciliation failed to start: ${(err as Error).message}`, 'red'),
                        });
                      }}
                    >
                      Run now
                    </Button>
                  </div>
                }
              />
              {reconcileProgress.data?.active && (
                <div style={{ padding: '4px 0 10px' }}>
                  {(() => {
                    const { done, total } = reconcileProgress.data;
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                          <span>Reconciling tasks · {fmt.number(done)} / {fmt.number(total)}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                        </div>
                        <div style={{ width: '100%', height: 6, background: 'var(--muted-bg)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width 200ms ease-out' }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
              <SettingRow
                label="Backfill on connect"
                desc="Active — configured spaces backfill on first sync."
                control={<Switch checked disabled onChange={() => undefined} />}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Cost calculation" subtitle="How labor cost is computed from time entries." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <SettingRow
                label="Default currency"
                desc="Per-row currency comes from ClickUp — workspace-wide override isn't implemented yet."
                control={
                  <Select
                    size="sm"
                    value={defaultCurrency}
                    onChange={setDefaultCurrency}
                    disabled
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
                desc="Always uses time-entry start_time today; selector is a placeholder."
                control={
                  <Select
                    size="sm"
                    value={rateMatch}
                    onChange={setRateMatch}
                    disabled
                    options={[
                      { value: 'start', label: 'Start date' },
                      { value: 'due', label: 'Task due date' },
                    ]}
                  />
                }
              />
              <SettingRow
                label="Auto-recalculate on rate change"
                desc="Active — editing a rate enqueues a maintenance recalc job."
                control={<Switch checked disabled onChange={() => undefined} />}
              />
              <SettingRow
                label="Treat non-billable as zero cost"
                desc="Not implemented — non-billable entries are costed normally today."
                control={<Switch checked={false} disabled onChange={() => undefined} />}
              />
              <SettingRow
                label="Daily-hour spike cap"
                desc="Flag a user-day as a spike when logged hours exceed this absolute cap (also flags > 2× the user's 30-day median). 1–24 hours."
                control={
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input
                      type="number"
                      value={capInput}
                      onChange={(e) => setCapInput(e.target.value)}
                      style={{ width: 80 }}
                    />
                    <Button
                      size="sm"
                      disabled={updateSettings.isPending || capInput === '' || Number(capInput) === settingsQuery.data?.spikeHoursCap}
                      onClick={() => {
                        const n = Math.round(Number(capInput));
                        if (!Number.isFinite(n) || n < 1 || n > 24) {
                          showBanner('Spike cap must be a whole number between 1 and 24.', 'red');
                          return;
                        }
                        updateSettings.mutate(
                          { spikeHoursCap: n },
                          { onError: (err) => showBanner(`Save failed: ${(err as Error).message}`, 'red') },
                        );
                      }}
                    >
                      Save
                    </Button>
                  </div>
                }
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Failure handling" subtitle="What happens when sync jobs error." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <SettingRow
                label="Webhook retry"
                desc="Currently uses BullMQ defaults (5 attempts, exponential backoff). Configurable retry count isn't wired yet."
                control={
                  <Select
                    size="sm"
                    value={webhookRetries}
                    onChange={setWebhookRetries}
                    disabled
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
                desc="Not implemented — failed jobs go to dead-letter but syncing isn't paused."
                control={<Switch checked={false} disabled onChange={() => undefined} />}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Tag–assignee map"
              subtitle="Map ClickUp tags to assignees for tracked-time replacement."
              action={
                <Button variant="ghost" size="sm" onClick={startAddTag}>
                  Add mapping
                </Button>
              }
            />

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
            Configured spaces are defined in <code style={{ fontFamily: 'ui-monospace, monospace' }}>src/config/clickup-spaces.config.ts</code>{' '}
            and applied at startup. Adding or removing a space here isn't supported yet — edit the config and restart the backend to change the set.
          </Callout>
          <Card>
            <CardHeader
              title="Synced spaces"
              subtitle={
                spaceRows.length > 0 ? `${spaceRows.length} space${spaceRows.length === 1 ? '' : 's'} active` : 'No spaces synced yet'
              }
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {spaceRows.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No spaces loaded yet. Sync data to see spaces here.</p>
              ) : (
                spaceRows.map((s) => {
                  const sid = (s as { spaceId?: string }).spaceId ?? '';
                  const nameRaw = (s as { spaceName?: string | null }).spaceName?.trim();
                  const name = nameRaw || (sid ? `Space ${sid}` : 'Space');
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
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
                          {sid || '—'} · {fmt.number(taskCount)} tasks · {fmt.hours(hours)}
                        </div>
                      </div>
                      <Pill tone="green" size="xs" icon={<CircleCheck size={10} />}>active</Pill>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* Status filters + tag filters dropped from the UI: they were
              decorative chips that didn't filter anything. Bring them back
              once a `scope_filters` table (or env-config) exists to persist
              the exclusion list, and the workers honor it. */}
        </div>
      )}

      {activeTab === 'notifications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
          <Callout tone="amber" icon={<AlertTriangle size={13} />}>
            Preview only — no notifications are actually delivered yet.
            Toggling these switches doesn't persist or wire any channel. Operational alerts surface in the
            <strong> Overview → Alerts</strong> card today; outbound delivery (email, Slack, PagerDuty) is on the roadmap.
          </Callout>
          <Card>
            <CardHeader title="Alerts" subtitle="Get notified when sync issues need attention." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
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
            <CardHeader title="Channels" subtitle="Where alerts are delivered." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
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
