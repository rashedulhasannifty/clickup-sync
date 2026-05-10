import { useState } from 'react';
import { useSyncHealth } from '../hooks/useReports';
import { useTagAssignee, useCreateTagAssignee, useUpdateTagAssignee, useDeleteTagAssignee } from '../hooks/useTagAssignee';
import { useRegisterWebhook } from '../hooks/useAdmin';
import type { TagAssignee } from '../api/tag-assignee';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/ui/SectionHeader';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Switch } from '../components/ui/Switch';
import { Pill } from '../components/ui/Pill';
import { Avatar } from '../components/ui/Avatar';
import { Callout } from '../components/ui/Callout';
import { EmptyState } from '../components/ui/EmptyState';
import { DataTable } from '../components/ui/DataTable';
import type { Column } from '../components/ui/DataTable';
import { fmt } from '../lib/formatters';

type TagRow = TagAssignee & { [key: string]: unknown };

const TAB_ITEMS = [
  { key: 'connection', label: 'Connection' },
  { key: 'sync', label: 'Sync Rules' },
  { key: 'scopes', label: 'Scope Filters' },
  { key: 'members', label: 'Members & Access' },
  { key: 'notifications', label: 'Notifications' },
];

const WEBHOOK_EVENTS = ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskTimeTrackedUpdated'];

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
  const tagAssignee = useTagAssignee();
  const createTagAssignee = useCreateTagAssignee();
  const updateTagAssignee = useUpdateTagAssignee();
  const deleteTagAssignee = useDeleteTagAssignee();
  const registerWebhook = useRegisterWebhook();

  const [showTagForm, setShowTagForm] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagForm, setTagForm] = useState<TagFormState>(emptyForm);

  const lastSyncAt = syncHealth.data?.[0]?.lastSuccessfulSyncAt;
  const webhookStatus = syncHealth.data?.[0]?.status ?? 'Unknown';
  const webhookUrl = import.meta.env.VITE_WEBHOOK_URL ?? 'https://your-domain.com/webhooks/clickup';

  const tagItems: TagRow[] = (tagAssignee.data ?? []) as TagRow[];

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
      updateTagAssignee.mutate(
        { id: editingTagId, data: payload },
        { onSuccess: () => cancelTagForm() },
      );
    } else {
      createTagAssignee.mutate(payload, { onSuccess: () => cancelTagForm() });
    }
  }

  function deleteTag(id: string) {
    if (!window.confirm('Delete this tag-assignee mapping?')) return;
    deleteTagAssignee.mutate(id);
  }

  const tagColumns: Column<TagRow>[] = [
    { key: 'tagName', header: 'Tag Name', render: (row) => <Pill tone="purple">{row.tagName}</Pill> },
    {
      key: 'clickupUserId',
      header: 'ClickUp User ID',
      render: (row) => <span className="font-mono text-xs">{row.clickupUserId}</span>,
    },
    {
      key: 'clickupUserName',
      header: 'User Name',
      render: (row) => <span className="text-sm">{row.clickupUserName ?? '—'}</span>,
    },
    {
      key: 'clickupEmail',
      header: 'Email',
      render: (row) => (
        <span className="text-xs text-[var(--text-muted)]">{row.clickupEmail ?? '—'}</span>
      ),
    },
    {
      key: 'active',
      header: 'Active',
      render: (row) => (
        <Switch
          checked={row.active as boolean}
          onChange={(v) =>
            updateTagAssignee.mutate({ id: row.id as string, data: { active: v } })
          }
        />
      ),
    },
    {
      key: 'edit',
      header: '',
      render: (row) => (
        <Button size="sm" variant="ghost" onClick={() => startEditTag(row as TagAssignee)}>
          Edit
        </Button>
      ),
    },
    {
      key: 'delete',
      header: '',
      render: (row) => (
        <Button
          size="sm"
          variant="danger"
          onClick={() => deleteTag(row.id as string)}
        >
          Delete
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />
      <Tabs items={TAB_ITEMS} active={activeTab} onChange={setActiveTab} variant="underline" />

      {/* CONNECTION TAB */}
      {activeTab === 'connection' && (
        <div className="flex flex-col gap-6">
          <Card>
            <SectionHeader title="Workspace" />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px 24px',
                marginBottom: 16,
              }}
            >
              <span className="text-xs text-[var(--text-muted)]">Workspace</span>
              <span className="text-sm">Nifty IT</span>
              <span className="text-xs text-[var(--text-muted)]">Last Sync</span>
              <span className="text-sm">
                {lastSyncAt ? fmt.relative(lastSyncAt) : '—'}
              </span>
              <span className="text-xs text-[var(--text-muted)]">Webhook Status</span>
              <span>
                <Pill tone={webhookStatus === 'Fresh' ? 'green' : webhookStatus === 'Stale' ? 'amber' : 'gray'}>
                  {webhookStatus}
                </Pill>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" disabled>Test Connection</Button>
              <Button variant="ghost" disabled>Rotate Token</Button>
              <Button variant="danger" disabled>Disconnect</Button>
            </div>
          </Card>

          <Card>
            <SectionHeader title="Webhook" />
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">
                  Endpoint URL
                </label>
                <Input
                  value={webhookUrl}
                  onChange={() => undefined}
                  readOnly
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">
                  Subscribed Events
                </label>
                <div className="flex flex-wrap gap-2">
                  {WEBHOOK_EVENTS.map((ev) => (
                    <Pill key={ev} tone="blue">{ev}</Pill>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="accent"
                  onClick={() => registerWebhook.mutate(undefined)}
                  loading={registerWebhook.isPending}
                >
                  Register Webhook
                </Button>
                {registerWebhook.data && (
                  <span className="text-xs text-[var(--text-muted)]">
                    Webhook ID: {(registerWebhook.data as { webhookId?: string }).webhookId ?? '—'}
                  </span>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* SYNC RULES TAB */}
      {activeTab === 'sync' && (
        <div className="flex flex-col gap-6">
          <Card>
            <SectionHeader title="Schedule" />
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">Real-time webhooks</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Events are processed via ClickUp webhooks in real time.
                  </p>
                </div>
                <Switch checked onChange={() => undefined} disabled />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Reconciliation backfills run on a scheduled interval per space lookback window.
              </p>
            </div>
          </Card>

          <Card>
            <SectionHeader title="Cost Calculation" />
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">Currency</p>
                </div>
                <span className="text-sm font-mono">USD</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">Auto-recalculate on rate change</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Recalculate entry costs when assignee rates are updated.
                  </p>
                </div>
                <Switch checked onChange={() => undefined} disabled />
              </div>
            </div>
          </Card>

          <Card>
            <SectionHeader
              title="Tag-Assignee Map"
              action={
                <Button variant="ghost" size="sm" onClick={startAddTag}>
                  Add mapping
                </Button>
              }
            />

            {showTagForm && (
              <div
                className="border border-[var(--border)] rounded-[var(--radius)] p-4 mb-4 flex flex-col gap-3"
                style={{ background: 'var(--surface-alt)' }}
              >
                <div
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
                >
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-[var(--text-muted)]">Tag Name</label>
                    <Input
                      value={tagForm.tagName}
                      onChange={(e) => setTagForm((f) => ({ ...f, tagName: e.target.value }))}
                      placeholder="e.g. rashedul"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-[var(--text-muted)]">User ID</label>
                    <Input
                      value={tagForm.clickupUserId}
                      onChange={(e) => setTagForm((f) => ({ ...f, clickupUserId: e.target.value }))}
                      placeholder="ClickUp user ID"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-[var(--text-muted)]">User Name</label>
                    <Input
                      value={tagForm.clickupUserName}
                      onChange={(e) => setTagForm((f) => ({ ...f, clickupUserName: e.target.value }))}
                      placeholder="Display name"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-[var(--text-muted)]">Email</label>
                    <Input
                      value={tagForm.clickupEmail}
                      onChange={(e) => setTagForm((f) => ({ ...f, clickupEmail: e.target.value }))}
                      placeholder="user@example.com"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
              <p className="text-sm text-[var(--text-muted)]">Loading…</p>
            ) : tagItems.length === 0 ? (
              <EmptyState
                title="No mappings"
                body="Add tag-to-assignee mappings to enable tracked-time replacement."
              />
            ) : (
              <DataTable<TagRow>
                columns={tagColumns}
                data={tagItems}
                emptyTitle="No mappings"
                pageSize={50}
              />
            )}
          </Card>
        </div>
      )}

      {/* SCOPE FILTERS TAB */}
      {activeTab === 'scopes' && (
        <div className="flex flex-col gap-6">
          <Callout tone="info">
            Scope filters control which ClickUp spaces are synced. Contact an administrator to change space configuration.
          </Callout>
          <Card>
            <SectionHeader title="Spaces" />
            <div className="flex flex-col gap-4">
              {[
                { label: 'Digital Marketing', id: '3577824' },
                { label: 'R&D Apps', id: '3589129' },
                { label: 'Projects', id: '3525433' },
              ].map((space) => (
                <div key={space.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">{space.label}</p>
                    <p className="text-xs text-[var(--text-muted)]">ID: {space.id}</p>
                  </div>
                  <Switch checked onChange={() => undefined} disabled />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <SectionHeader title="Status Filters" description="Excluded statuses" />
            <EmptyState
              title="No excluded statuses"
              body="All task statuses are synced. Exclusion rules will be configurable in a future release."
            />
          </Card>
        </div>
      )}

      {/* MEMBERS & ACCESS TAB */}
      {activeTab === 'members' && (
        <Card>
          <SectionHeader title="Members & Access" />
          <div className="flex items-center gap-3">
            <Avatar name="Admin" size="md" />
            <div>
              <p className="text-sm font-bold text-[var(--text)]">Admin</p>
              <p className="text-xs text-[var(--text-muted)]">API key holder</p>
            </div>
          </div>
        </Card>
      )}

      {/* NOTIFICATIONS TAB */}
      {activeTab === 'notifications' && (
        <div className="flex flex-col gap-6">
          <Card>
            <SectionHeader title="Alerts" />
            <div className="flex flex-col gap-4">
              {[
                { label: 'Failed jobs', desc: 'Notify when a BullMQ job fails.' },
                { label: 'Dead letters', desc: 'Notify when items land in dead-letter queue.' },
                { label: 'Missing rates', desc: 'Notify when time entries have no assignee rate.' },
                { label: 'Stale sync', desc: 'Notify when a space has not synced recently.' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">{item.label}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{item.desc}</p>
                  </div>
                  <Switch checked={false} onChange={() => undefined} disabled />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <SectionHeader title="Channels" />
            <div className="flex flex-col gap-4">
              {['Email', 'Slack', 'PagerDuty'].map((ch) => (
                <div key={ch} className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[var(--text)]">{ch}</p>
                  <Switch checked={false} onChange={() => undefined} disabled />
                </div>
              ))}
            </div>
            <div className="mt-4">
              <Callout tone="info">
                Notification channels will be configurable in a future release.
              </Callout>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
