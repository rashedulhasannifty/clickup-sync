import { useEffect, useState, type ReactNode } from 'react';
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
import { useSpaces, useSyncHealth, useStats } from '../hooks/useReports';
import { useTagAssignee, useCreateTagAssignee, useUpdateTagAssignee, useDeleteTagAssignee } from '../hooks/useTagAssignee';
import { useRegisterWebhook, useTestClickupConnection, useReconcileTasks, useReconcileActive, useWebhooks, useSyncTaskFull, useDeleteWebhook, usePruneStaleWebhooks, useRotateWebhook, useSyncAllTimeEntries } from '../hooks/useAdmin';
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
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
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

// ClickUp task-scoped webhook event types. Stored as a comma-separated string;
// the UI below is a grouped checkbox list. "handled" events are processed by the
// backend (clickup-event.processor.ts) — some with dedicated logic, the rest
// captured as task-event history and/or a task re-sync. "unimplemented" events
// have no handler yet, so they're shown disabled (greyed out) and can't be
// selected. Non-task events (list/space/folder/goal) are omitted — they carry
// no taskId and the worker discards them.
type WebhookEventGroup = 'handled' | 'unimplemented';
const WEBHOOK_EVENT_OPTIONS: { value: string; label: string; desc: string; group: WebhookEventGroup }[] = [
  { value: 'taskCreated', label: 'Task created', desc: 'New tasks appear in reporting.', group: 'handled' },
  { value: 'taskUpdated', label: 'Task updated', desc: 'Field changes re-sync the task.', group: 'handled' },
  { value: 'taskDeleted', label: 'Task deleted', desc: 'Soft-deletes the task in reporting.', group: 'handled' },
  { value: 'taskTimeTrackedUpdated', label: 'Time tracked', desc: 'Tracked-time entries and costs.', group: 'handled' },
  { value: 'taskStatusUpdated', label: 'Status changed', desc: 'Powers cycle-time & status history.', group: 'handled' },
  { value: 'taskMoved', label: 'Task moved', desc: 'Records move history + re-syncs the task.', group: 'handled' },
  { value: 'taskAssigneeUpdated', label: 'Assignee changed', desc: 'Records assignee history + re-syncs the task.', group: 'handled' },
  { value: 'taskPriorityUpdated', label: 'Priority changed', desc: 'Records priority history + re-syncs the task.', group: 'handled' },
  { value: 'taskCommentPosted', label: 'Comment posted', desc: 'No handler yet.', group: 'unimplemented' },
  { value: 'taskCommentUpdated', label: 'Comment updated', desc: 'No handler yet.', group: 'unimplemented' },
  { value: 'taskTagUpdated', label: 'Tags changed', desc: 'No handler yet.', group: 'unimplemented' },
  { value: 'taskDueDateUpdated', label: 'Due date changed', desc: 'No handler yet.', group: 'unimplemented' },
  { value: 'taskTimeEstimateUpdated', label: 'Estimate changed', desc: 'No handler yet.', group: 'unimplemented' },
];

const WEBHOOK_EVENT_GROUPS: { group: WebhookEventGroup; label: string; disabled?: boolean }[] = [
  { group: 'handled', label: 'Available' },
  { group: 'unimplemented', label: 'Not yet implemented', disabled: true },
];

const KNOWN_EVENT_VALUES = WEBHOOK_EVENT_OPTIONS.map((o) => o.value);

/** Checkbox list for the webhook event subscription. Keeps the value a
 * comma-separated string (known events in canonical order, then any custom
 * ones already stored so they aren't silently dropped). */
function WebhookEventsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const selected = new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
  const extras = [...selected].filter((v) => !KNOWN_EVENT_VALUES.includes(v));

  function emit(next: Set<string>) {
    const known = KNOWN_EVENT_VALUES.filter((v) => next.has(v));
    const stillExtra = [...next].filter((v) => !KNOWN_EVENT_VALUES.includes(v));
    onChange([...known, ...stillExtra].join(','));
  }

  function toggle(ev: string) {
    const next = new Set(selected);
    if (next.has(ev)) next.delete(ev);
    else next.add(ev);
    emit(next);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {WEBHOOK_EVENT_GROUPS.map(({ group, label, disabled }) => (
        <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--text-muted)',
            }}
          >
            {label}
          </span>
          {WEBHOOK_EVENT_OPTIONS.filter((o) => o.group === group).map((o) => {
            const checked = selected.has(o.value);
            return (
              <label
                key={o.value}
                title={disabled ? 'Not implemented yet — no backend handler.' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '8px 10px',
                  border: `1px solid ${checked && !disabled ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  background: checked && !disabled ? 'var(--accent-soft)' : 'var(--surface)',
                  opacity: disabled ? 0.5 : 1,
                  transition: 'border-color 100ms, background 100ms',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => !disabled && toggle(o.value)}
                  style={{
                    marginTop: 1,
                    width: 15,
                    height: 15,
                    accentColor: 'var(--accent)',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    flexShrink: 0,
                  }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                    {o.label}{' '}
                    <code style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>{o.value}</code>
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{o.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
      ))}
      {extras.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
          <span>Also subscribed:</span>
          {extras.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => toggle(e)}
              title="Remove this custom event"
              className="btn-3d"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 7px',
                fontSize: 11,
                fontFamily: 'inherit',
                color: 'var(--text)',
                background: 'var(--muted-bg)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                cursor: 'pointer',
                ['--b-edge' as string]: 'var(--border-strong)',
                ['--b-glow' as string]: 'var(--btn-neutral-glow)',
                ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
              }}
            >
              {e} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
        <span title={value} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
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
  const stats = useStats();
  const spacesQuery = useSpaces();
  const tagAssignee = useTagAssignee();
  const createTagAssignee = useCreateTagAssignee();
  const updateTagAssignee = useUpdateTagAssignee();
  const deleteTagAssignee = useDeleteTagAssignee();
  const registerWebhook = useRegisterWebhook();
  const testConnection = useTestClickupConnection();
  const reconcileTasks = useReconcileTasks();
  const syncAllTimeEntries = useSyncAllTimeEntries();
  const reconcileProgress = useReconcileActive(hasRole('ADMIN'));
  const settingsQuery = useSettings();
  const updateSettings = useUpdateSettings();
  const toast = useToast();
  const webhooksList = useWebhooks();
  const syncTaskFull = useSyncTaskFull();
  const deleteWebhook = useDeleteWebhook();
  const pruneStaleWebhooks = usePruneStaleWebhooks();
  const rotateWebhook = useRotateWebhook();
  const staleWebhookCount = webhooksList.data
    ? webhooksList.data.webhooks.filter((w) => w.endpoint !== webhooksList.data!.configuredEndpoint).length
    : 0;
  // Only meaningful when the live (configured) webhook is suspended and keeps
  // re-suspending after a plain Register — that's the 401 secret-mismatch case
  // a rotation (delete + re-create → fresh secret) is the fix for.
  const configuredSuspended = webhooksList.data
    ? webhooksList.data.webhooks.some(
        (w) => w.endpoint === webhooksList.data!.configuredEndpoint && w.health?.status === 'suspended',
      )
    : false;

  function confirmDeleteWebhook(id: string, endpoint: string | null, isConfigured: boolean) {
    const msg = isConfigured
      ? `Delete the CONFIGURED webhook?\n\n${endpoint}\n\nThis is your live endpoint — deleting it STOPS all ClickUp sync until you click Register Webhook again (which re-issues a fresh signing secret). Continue?`
      : `Delete this webhook? This cannot be undone.\n\n${endpoint ?? id}`;
    if (!window.confirm(msg)) return;
    deleteWebhook.mutate(id, {
      onSuccess: () => showBanner(`Deleted webhook ${id}.`, 'blue'),
      onError: (err) => showBanner(`Delete failed: ${(err as Error).message}`, 'red'),
    });
  }

  function pruneStale() {
    if (staleWebhookCount === 0) return;
    if (!window.confirm(`Delete ${staleWebhookCount} stale webhook(s) — every registered endpoint that isn't your configured one? This cannot be undone. Your configured webhook is left untouched.`)) return;
    pruneStaleWebhooks.mutate(undefined, {
      onSuccess: (res) => showBanner(`Pruned ${res.deleted.length} stale webhook(s).`, 'blue'),
      onError: (err) => showBanner(`Prune failed: ${(err as Error).message}`, 'red'),
    });
  }

  function rotateSecret() {
    if (!window.confirm('Rotate the signing secret?\n\nThis deletes the webhook at your configured endpoint and re-creates it with a FRESH secret. Use this only when a suspended webhook keeps re-suspending after Register (a 401 secret mismatch). Brief gap while it re-registers. Continue?')) return;
    rotateWebhook.mutate(undefined, {
      onSuccess: (res) => res.rotated
        ? showBanner(`Rotated webhook — fresh secret issued (${res.result.webhookId}).`, 'blue')
        : showBanner(`Rotation did NOT issue a fresh secret (register returned "${res.result.action}"). A webhook still matched after delete — try again, or check APP_ENCRYPTION_KEY.`, 'red'),
      onError: (err) => showBanner(`Rotate failed: ${(err as Error).message}`, 'red'),
    });
  }
  const [manualTaskId, setManualTaskId] = useState('');

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

  // Connection/webhook/save results surface as toasts (top-right, auto-dismiss).
  function showBanner(text: string, tone: 'blue' | 'red' = 'blue') {
    toast.show(text, tone);
  }

  const prefs = settingsQuery.data?.preferences;
  const isOwner = hasRole('OWNER');

  function patchPrefs(patch: SettingsPatch['preferences']) {
    updateSettings.mutate(
      { preferences: patch },
      { onError: (err) => showBanner(`Save failed: ${(err as Error).message}`, 'red') },
    );
  }

  const [showTagForm, setShowTagForm] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagForm, setTagForm] = useState<TagFormState>(emptyForm);

  const [reconcileDays, setReconcileDays] = useState('365');
  // "Reconcile time entries" — the lighter, time-entries-only sweep (no delete
  // detection). Heavy enough to gate behind a confirm dialog.
  const [teReconcileDays, setTeReconcileDays] = useState('90');
  const [teConfirmOpen, setTeConfirmOpen] = useState(false);
  useEffect(() => {
    if (prefs?.sync.reconcileLookbackDays != null) setReconcileDays(String(prefs.sync.reconcileLookbackDays));
  }, [prefs?.sync.reconcileLookbackDays]);
  const [maxBackfillDays, setMaxBackfillDays] = useState('1095');
  useEffect(() => {
    if (prefs?.sync.maxBackfillLookbackDays != null) setMaxBackfillDays(String(prefs.sync.maxBackfillLookbackDays));
  }, [prefs?.sync.maxBackfillLookbackDays]);
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [capInput, setCapInput] = useState('');
  useEffect(() => {
    if (settingsQuery.data?.spikeHoursCap != null) setCapInput(String(settingsQuery.data.spikeHoursCap));
  }, [settingsQuery.data?.spikeHoursCap]);

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

  // Webhook delivery health, derived from actually-received webhook events
  // (NOT sync-checkpoint freshness): "active" = events arrived in the last 24h,
  // "idle" = events seen before but none recently, "none" = none ever received.
  const webhookStats = stats.data as
    | { webhooksLast24h?: number; lastWebhookEventAt?: string | null }
    | undefined;
  const lastWebhookEventAt = webhookStats?.lastWebhookEventAt ?? null;
  const webhookDelivery: 'active' | 'idle' | 'none' =
    (webhookStats?.webhooksLast24h ?? 0) > 0 ? 'active' : lastWebhookEventAt ? 'idle' : 'none';
  const webhookDeliveryTone: 'green' | 'amber' | 'gray' =
    webhookDelivery === 'active' ? 'green' : webhookDelivery === 'idle' ? 'amber' : 'gray';

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
        variant="segmented"
      />


      {activeTab === 'connection' && (
        <RequireRole min="OWNER">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14, maxWidth: 560 }}>
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
                value={lastWebhookEventAt ? `event ${fmt.relative(lastWebhookEventAt)}` : 'no events yet'}
                icon={<Webhook size={13} />}
                dotTone={webhookDeliveryTone}
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
                webhookDelivery === 'active' ? (
                  <Pill tone="green" icon={<CircleCheck size={11} />}>Active</Pill>
                ) : webhookDelivery === 'idle' ? (
                  <Pill tone="amber">Idle</Pill>
                ) : (
                  <Pill tone="gray">No events</Pill>
                )
              }
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
              <Field label="Endpoint URL" hint="Public HTTPS URL ClickUp posts events to. Ends with /api/webhooks/clickup.">
                <Input
                  value={connForm.webhookEndpoint}
                  onChange={(e) => setConnForm((f) => ({ ...f, webhookEndpoint: e.target.value }))}
                  placeholder="https://your-domain.com/api/webhooks/clickup"
                />
              </Field>
              <Field label="Subscribed events" hint="Pick which ClickUp events trigger a sync. Re-register the webhook after changing.">
                <WebhookEventsField
                  value={connForm.webhookEvents}
                  onChange={(v) => setConnForm((f) => ({ ...f, webhookEvents: v }))}
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
                  variant={webhookStatus === 'Fresh' ? 'default' : 'caution'}
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

          <Card>
            <CardHeader
              title="Registered on ClickUp"
              subtitle="What ClickUp actually delivers to. Differs from the checkboxes above until you Register."
              action={
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {configuredSuspended && isOwner && (
                    <Button variant="danger" size="sm" loading={rotateWebhook.isPending} onClick={rotateSecret}>
                      Rotate secret
                    </Button>
                  )}
                  {staleWebhookCount > 0 && (
                    <Button variant="danger" size="sm" loading={pruneStaleWebhooks.isPending} onClick={pruneStale}>
                      Prune stale ({staleWebhookCount})
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => webhooksList.refetch()} loading={webhooksList.isFetching}>
                    Refresh
                  </Button>
                </div>
              }
            />
            <div style={{ padding: '4px 0' }}>
              {webhooksList.isLoading ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>Loading…</p>
              ) : webhooksList.isError ? (
                <Callout tone="red">
                  Couldn’t read webhooks from ClickUp: {(webhooksList.error as Error)?.message ?? 'unknown error'}. Check the API token.
                </Callout>
              ) : !webhooksList.data || webhooksList.data.webhooks.length === 0 ? (
                <EmptyState title="No webhook registered" body="Click Register Webhook above to create one." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {webhooksList.data.webhooks.map((w) => (
                    <div key={w.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Pill tone={w.health?.status === 'active' ? 'green' : 'amber'}>
                          {w.health?.status ?? 'unknown'}
                        </Pill>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{w.endpoint ?? '(no endpoint)'}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>id {w.id}</span>
                        {w.endpoint === webhooksList.data.configuredEndpoint && (
                          <Pill tone="blue">configured</Pill>
                        )}
                        <Button
                          variant="danger"
                          size="sm"
                          style={{ marginLeft: 'auto' }}
                          loading={deleteWebhook.isPending && deleteWebhook.variables === w.id}
                          onClick={() => confirmDeleteWebhook(w.id, w.endpoint, w.endpoint === webhooksList.data!.configuredEndpoint)}
                        >
                          Delete
                        </Button>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {w.events.length === 0 ? (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No events subscribed.</span>
                        ) : (
                          w.events.map((e) => <Pill key={e} tone="gray">{e}</Pill>)
                        )}
                      </div>
                      {w.endpoint !== webhooksList.data.configuredEndpoint && (
                        <div style={{ marginTop: 8 }}>
                          <Callout tone="amber">
                            Endpoint differs from configured — this webhook posts elsewhere.
                          </Callout>
                        </div>
                      )}
                      {w.missingEvents.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <Callout tone="amber">
                            Not registered for: {w.missingEvents.join(', ')}. Click Register Webhook to sync these.
                          </Callout>
                        </div>
                      )}
                      {w.extraEvents.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Extra (not in your configured list): {w.extraEvents.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Manual task sync"
              subtitle="Force a re-pull of one task and its time entries by ClickUp task ID."
            />
            <Field label="Task ID" hint="e.g. 86eyajwq8. Runs in the background — watch Sync Logs for results.">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Input
                  value={manualTaskId}
                  placeholder="86eyajwq8"
                  onChange={(e) => setManualTaskId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
                <Button
                  loading={syncTaskFull.isPending}
                  disabled={!manualTaskId.trim()}
                  onClick={() => {
                    const id = manualTaskId.trim();
                    if (!id) return;
                    syncTaskFull.mutate(id, {
                      onSuccess: () => {
                        showBanner(`Queued sync for ${id} (task + time entries). Check Sync Logs shortly.`, 'blue');
                        setManualTaskId('');
                      },
                      onError: (err) => showBanner(`Sync failed to queue: ${(err as Error).message}`, 'red'),
                    });
                  }}
                >
                  Sync task
                </Button>
              </div>
            </Field>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Callout tone="amber" icon={<Info size={13} />}>
            Most settings here are live: changes persist and take effect. The
            exceptions still in preview are <strong>Default currency</strong> and{' '}
            <strong>Pause syncing on repeated failure</strong>. Changing{' '}
            <strong>Rate matching</strong> or <strong>Treat non-billable as zero</strong>{' '}
            applies to new entries immediately; run <strong>Recalculate costs</strong>{' '}
            (Assignee Rates) to apply it to existing ones.
          </Callout>

          <Card>
            <CardHeader title="Sync schedule" subtitle="When to perform full reconciliation runs." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <SettingRow
                label="Real-time webhooks"
                desc="When off, incoming ClickUp webhooks are acknowledged but not processed — the hourly reconcile catches up."
                control={
                  <Switch
                    checked={prefs?.sync.realtimeWebhooks ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ sync: { realtimeWebhooks: v } })}
                  />
                }
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
                      variant="caution"
                      loading={reconcileTasks.isPending}
                      onClick={() => {
                        const days = Number(reconcileDays);
                        if (!Number.isFinite(days) || days < 1) {
                          showBanner('Enter a lookback of at least 1 day.', 'red');
                          return;
                        }
                        reconcileTasks.mutate(days, {
                          onSuccess: (res) => {
                            if (isOwner) patchPrefs({ sync: { reconcileLookbackDays: days } });
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
                label="Reconcile time entries"
                desc="Re-pull tracked time for every stored task (last N days). Time-entries only — it won't detect task deletes; use Full reconciliation for that. Heavy: queues one job per task and can take hours to drain on a large workspace. For a routine refresh, sync a single space from the Spaces page instead."
                control={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Input
                      type="number"
                      min={1}
                      value={teReconcileDays}
                      onChange={(e) => setTeReconcileDays(e.target.value)}
                      style={{ width: 88 }}
                      aria-label="Time-entry reconcile lookback in days"
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>days back</span>
                    <Button
                      size="sm"
                      variant="caution"
                      loading={syncAllTimeEntries.isPending}
                      onClick={() => {
                        const days = Number(teReconcileDays);
                        if (!Number.isFinite(days) || days < 1) {
                          showBanner('Enter a lookback of at least 1 day.', 'red');
                          return;
                        }
                        setTeConfirmOpen(true);
                      }}
                    >
                      Run now
                    </Button>
                  </div>
                }
              />
              <SettingRow
                label="Backfill on connect"
                desc="When on, registering the webhook also backfills enabled spaces."
                control={
                  <Switch
                    checked={prefs?.sync.backfillOnConnect ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ sync: { backfillOnConnect: v } })}
                  />
                }
              />
              <SettingRow
                label="Include archived tasks"
                desc="When on, space syncs also pull archived tasks (and their tracked time). Archived tasks count toward space totals."
                control={
                  <Switch
                    checked={prefs?.sync.includeArchived ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ sync: { includeArchived: v } })}
                  />
                }
              />
              <SettingRow
                label="Backfill maximum lookback"
                desc="Upper limit for a manual space backfill's “days back” (1–3650). Applies to both the Spaces input and the API."
                control={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      value={maxBackfillDays}
                      disabled={!isOwner}
                      onChange={(e) => setMaxBackfillDays(e.target.value)}
                      style={{ width: 88 }}
                      aria-label="Backfill maximum lookback in days"
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>days back</span>
                    <Button
                      size="sm"
                      disabled={!isOwner}
                      loading={updateSettings.isPending}
                      onClick={() => {
                        const days = Number(maxBackfillDays);
                        if (!Number.isFinite(days) || days < 1 || days > 3650) {
                          showBanner('Enter a maximum lookback between 1 and 3650 days.', 'red');
                          return;
                        }
                        const rounded = Math.round(days);
                        // Direct mutate (not patchPrefs) so the save gets explicit
                        // success feedback — unlike the toggles, a number input shows
                        // no visible state change on its own.
                        updateSettings.mutate(
                          { preferences: { sync: { maxBackfillLookbackDays: rounded } } },
                          {
                            onSuccess: () => showBanner(`Backfill maximum lookback saved (${rounded} days).`, 'blue'),
                            onError: (err) => showBanner(`Save failed: ${(err as Error).message}`, 'red'),
                          },
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

          {teConfirmOpen && (
            <Modal
              open
              onClose={() => setTeConfirmOpen(false)}
              title="Reconcile all time entries?"
              subtitle="Queues one sync job per stored task."
              width={440}
              footer={
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Button size="md" variant="ghost" onClick={() => setTeConfirmOpen(false)}>Cancel</Button>
                  <Button
                    size="md"
                    variant="caution"
                    loading={syncAllTimeEntries.isPending}
                    onClick={() => {
                      const days = Number(teReconcileDays);
                      syncAllTimeEntries.mutate(days, {
                        onSuccess: (res) => {
                          setTeConfirmOpen(false);
                          showBanner(
                            `Queued ${res.queued} time-entry sync job${res.queued === 1 ? '' : 's'} (last ${days} days). Hours will refresh as workers drain the queue.`,
                            'blue',
                          );
                        },
                        onError: (err) => showBanner(`Failed to start: ${(err as Error).message}`, 'red'),
                      });
                    }}
                  >
                    Queue jobs
                  </Button>
                </div>
              }
            >
              <div style={{ fontSize: 13, color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0 }}>
                  Re-pulls the last <strong>{teReconcileDays} days</strong> of tracked time for <strong>every</strong> stored task.
                  On a large workspace that can be tens of thousands of jobs and take hours to drain (ClickUp rate limits).
                </p>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                  For a routine refresh, sync a single space from the Spaces page instead.
                </p>
              </div>
            </Modal>
          )}

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
                desc="Which date selects the effective rate: the entry's start time, or the task's due date (falls back to start when no due date). Recalculate to apply to existing entries."
                control={
                  <Select
                    size="sm"
                    value={prefs?.cost.rateMatching ?? 'start'}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ cost: { rateMatching: v as 'start' | 'due' } })}
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
                control={
                  <Switch
                    checked={prefs?.cost.autoRecalcOnRateChange ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ cost: { autoRecalcOnRateChange: v } })}
                  />
                }
              />
              <SettingRow
                label="Treat non-billable as zero cost"
                desc="When on, non-billable time entries are costed at 0. Recalculate to apply to existing entries."
                control={
                  <Switch
                    checked={prefs?.cost.nonBillableZero ?? false}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ cost: { nonBillableZero: v } })}
                  />
                }
              />
              <RequireRole min="OWNER">
                <SettingRow
                  label="Daily-hour spike cap"
                  desc="Flag a user-day as a spike when logged hours exceed this absolute cap. 1–24 hours."
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
                        variant="accent"
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
                <SettingRow
                  label="Median spike rule"
                  desc="When on, also flag a day as a spike at > 2× the user's median and show median context across Time Spikes, Anomalies, and notifications. When off, those median numbers are hidden."
                  control={
                    <Switch
                      checked={prefs?.spike?.medianEnabled ?? true}
                      disabled={!isOwner || updateSettings.isPending}
                      onChange={(v) => patchPrefs({ spike: { medianEnabled: v } })}
                    />
                  }
                />
              </RequireRole>
            </div>
          </Card>

          <Card>
            <CardHeader title="Failure handling" subtitle="What happens when sync jobs error." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <SettingRow
                label="Webhook retry"
                desc="Number of BullMQ attempts before a failed webhook job moves to dead-letter (exponential backoff)."
                control={
                  <Select
                    size="sm"
                    value={String(prefs?.failure.webhookRetryAttempts ?? 5)}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ failure: { webhookRetryAttempts: Number(v) } })}
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
                <Button variant="accent" size="sm" onClick={startAddTag}>
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
                  maxWidth: 620,
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
                  <Switch ariaLabel="Tag mapping active" checked={tagForm.active} onChange={(v) => setTagForm((f) => ({ ...f, active: v }))} />
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
                <div style={{ overflowX: 'auto' }}>
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
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'scopes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Callout tone="blue" icon={<Info size={13} />}>
            Toggling a space off pauses its <strong>scheduled</strong> hourly sync. Manual backfills and existing reports are unaffected. The set of spaces still comes from{' '}
            <code style={{ fontFamily: 'ui-monospace, monospace' }}>src/config/clickup-spaces.config.ts</code>; add or remove a space there and restart.
          </Callout>
          <Card>
            <CardHeader
              title="Synced spaces"
              subtitle={
                spaceRows.length > 0 ? `${spaceRows.length} space${spaceRows.length === 1 ? '' : 's'} active` : 'No spaces synced yet'
              }
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(() => {
                const configured = settingsQuery.data?.configuredSpaces ?? [];
                const byId = new Map<string, { id: string; name: string }>();
                for (const c of configured) byId.set(c.id, { id: c.id, name: c.name });
                for (const s of spaceRows) {
                  const sid = (s as { spaceId?: string }).spaceId ?? '';
                  if (!sid) continue;
                  const nameRaw = (s as { spaceName?: string | null }).spaceName?.trim();
                  if (!byId.has(sid)) byId.set(sid, { id: sid, name: nameRaw || `Space ${sid}` });
                }
                const rows = Array.from(byId.values());
                if (rows.length === 0) {
                  return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No spaces configured or synced yet.</p>;
                }
                return rows.map((s) => {
                  const enabled = prefs?.spaces[s.id]?.enabled ?? true;
                  return (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, background: 'var(--muted-bg)', marginBottom: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: spaceColor(s.id), flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
                          {s.id}{enabled ? '' : ' · scheduled sync paused'}
                        </div>
                      </div>
                      <Switch
                        ariaLabel={`Scheduled sync for ${s.name}`}
                        checked={enabled}
                        disabled={!isOwner || updateSettings.isPending}
                        onChange={(v) => patchPrefs({ spaces: { [s.id]: { enabled: v } } })}
                      />
                    </div>
                  );
                });
              })()}
            </div>
          </Card>

          {/* Status filters + tag filters dropped from the UI: they were
              decorative chips that didn't filter anything. Bring them back
              once a `scope_filters` table (or env-config) exists to persist
              the exclusion list, and the workers honor it. */}
        </div>
      )}

      {activeTab === 'notifications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Callout tone="amber" icon={<AlertTriangle size={13} />}>
            Preview only — no notifications are actually delivered yet.
            Toggle preferences are persisted, but outbound delivery (email, Slack, PagerDuty) is on the roadmap.
            Operational alerts surface in the <strong> Overview → Alerts</strong> card today.
          </Callout>
          <Card>
            <CardHeader title="Alerts" subtitle="Get notified when sync issues need attention." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <SettingRow
                label="Sync run failed"
                desc="Notify on any failed sync run."
                control={
                  <Switch
                    ariaLabel="Sync run failed alerts"
                    checked={prefs?.notifications.alerts.syncFail ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ notifications: { alerts: { syncFail: v } } })}
                  />
                }
              />
              <SettingRow
                label="Webhook errors spike"
                desc="Alert if more than 25 webhooks fail in 5 min."
                control={
                  <Switch
                    ariaLabel="Webhook error spike alerts"
                    checked={prefs?.notifications.alerts.webhookSpike ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ notifications: { alerts: { webhookSpike: v } } })}
                  />
                }
              />
              <SettingRow
                label="Missing rate created"
                desc="Alert when an assignee logs time without a rate."
                control={
                  <Switch
                    ariaLabel="Missing rate alerts"
                    checked={prefs?.notifications.alerts.missingRate ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ notifications: { alerts: { missingRate: v } } })}
                  />
                }
              />
              <SettingRow
                label="Token expiring"
                desc="Notify 14 days before ClickUp token expires."
                control={
                  <Switch
                    ariaLabel="Token expiring alerts"
                    checked={prefs?.notifications.alerts.tokenExpiring ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ notifications: { alerts: { tokenExpiring: v } } })}
                  />
                }
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Channels" subtitle="Where alerts are delivered." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <SettingRow
                label="Email"
                desc="ops-alerts@acme.co"
                control={
                  <Switch
                    ariaLabel="Email channel"
                    checked={prefs?.notifications.channels.email ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ notifications: { channels: { email: v } } })}
                  />
                }
              />
              <SettingRow
                label="Slack"
                desc="#data-platform-alerts"
                control={
                  <Switch
                    ariaLabel="Slack channel"
                    checked={prefs?.notifications.channels.slack ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ notifications: { channels: { slack: v } } })}
                  />
                }
              />
              <SettingRow
                label="PagerDuty"
                desc="Connect for critical failures"
                control={
                  <Switch
                    ariaLabel="PagerDuty channel"
                    checked={prefs?.notifications.channels.pagerduty ?? false}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ notifications: { channels: { pagerduty: v } } })}
                  />
                }
              />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
