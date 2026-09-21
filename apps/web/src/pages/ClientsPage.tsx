import { useMemo, useState } from 'react';
import { Search, Building2, Flag, ExternalLink, Layers, Rocket, FolderTree } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Pill } from '../components/ui/Pill';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { QueryError } from '../components/ui/QueryError';
import { ClickupAvatarStack } from '../components/ui/ClickupAvatar';
import { useClientsOverview } from '../hooks/useClients';
import { useSpaces } from '../hooks/useReports';
import { fmt } from '../lib/formatters';
import type { ClientOverview, ClientEndpointTask, ClientSort } from '../api/clients';

const SORTS: { value: ClientSort; label: string }[] = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'tasks', label: 'Most tasks' },
  { value: 'hours', label: 'Most hours' },
  { value: 'recent', label: 'Most recent task' },
];

type SpaceOption = { spaceId: string | null; spaceName: string | null };

/** "R&D Apps / Q1 / Sprint 4" — sprint wins over list when both are present,
 *  since a sprint name is the more meaningful label; a task in an ordinary
 *  (non-sprint) list still gets its list name. */
function breadcrumb(task: ClientEndpointTask): string {
  const parts = [task.spaceName, task.folderName, task.sprintName ?? task.listName].filter(
    (p): p is string => !!p && p.trim() !== '',
  );
  return parts.length ? parts.join('  /  ') : 'No space or list recorded';
}

function EndpointCard({ label, task, tone }: { label: string; task: ClientEndpointTask | null; tone: 'first' | 'last' }) {
  return (
    <div
      style={{
        flex: '1 1 260px',
        minWidth: 0,
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid var(--border-soft)',
        background: 'var(--surface-alt)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Pill tone={tone === 'first' ? 'purple' : 'blue'} size="xs" icon={<Flag size={10} />}>
          {label}
        </Pill>
        {task?.createdDate && (
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{fmt.date(task.createdDate)}</span>
        )}
        {task?.status && (
          <Pill tone="gray" size="xs">
            {task.status}
          </Pill>
        )}
      </div>
      {task ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            {task.url ? (
              <a
                href={task.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontWeight: 600,
                  fontSize: 13.5,
                  color: 'var(--text)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  minWidth: 0,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {task.taskName}
                </span>
                <ExternalLink size={11} style={{ flexShrink: 0, color: 'var(--text-faint)' }} />
              </a>
            ) : (
              <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text)' }}>{task.taskName}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>{breadcrumb(task)}</div>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>No task with a created date</div>
      )}
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ textAlign: 'right', minWidth: 68 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: muted ? 'var(--text-faint)' : 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
    </div>
  );
}

function ClientCard({ row }: { row: ClientOverview }) {
  return (
    <Card padding={0}>
      {/* Header: who, and the headline numbers */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 16px',
          borderBottom: '1px solid var(--border-soft)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: 'var(--accent-soft)',
              color: 'var(--accent-strong)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Building2 size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{row.client}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {fmt.number(row.openCount)} open · {fmt.number(row.closedCount)} closed
            </div>
          </div>
        </div>
        <Stat label="Tasks" value={fmt.number(row.taskCount)} />
        <Stat label="Hours" value={fmt.hours(row.totalHours)} />
        {/* Masked cost is an em dash, never a zero — `fmt.money(null)` handles it. */}
        <Stat
          label={row.costPartial ? 'Cost (partial)' : 'Cost'}
          value={row.totalCostAud == null ? '—' : fmt.money(row.totalCostAud * 100)}
          muted={row.totalCostAud == null}
        />
      </div>

      {/* First / last task */}
      <div style={{ display: 'flex', gap: 12, padding: '14px 16px', flexWrap: 'wrap' }}>
        <EndpointCard label="First" task={row.firstTask} tone="first" />
        <EndpointCard label="Last" task={row.lastTask} tone="last" />
      </div>

      {/* Where the work lives, and who did it */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderTop: '1px solid var(--border-soft)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)' }}>
          <Layers size={12} />
          {row.spaces.length ? row.spaces.map((s) => s.name).join(', ') : '—'}
        </span>
        {row.folders.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <FolderTree size={12} />
            {row.folders.length} {row.folders.length === 1 ? 'folder' : 'folders'}
          </span>
        )}
        {row.sprintCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <Rocket size={12} />
            {row.sprintCount} {row.sprintCount === 1 ? 'sprint' : 'sprints'}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {row.assignees.length > 0 && (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            title={row.assignees.map((a) => `${a.userName ?? 'Unknown'} — ${fmt.hours(a.hours)}`).join('\n')}
          >
            <ClickupAvatarStack
              users={row.assignees.map((a) => ({ userId: a.userId, name: a.userName }))}
              max={row.assignees.length}
            />
            {row.assigneeOverflow > 0 && (
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>+{row.assigneeOverflow} more</span>
            )}
          </span>
        )}
      </div>
    </Card>
  );
}

/**
 * Clients page: one card per ClickUp "Client", showing where that engagement
 * started and where it stands now. Lifetime-wide — see
 * `GET /reports/clients/overview`; there is deliberately no date filter, since
 * a window would redefine "first task" as "first task in range".
 */
export function ClientsPage() {
  const [query, setQuery] = useState('');
  const [spaceId, setSpaceId] = useState('all');
  const [sort, setSort] = useState<ClientSort>('name');

  const clientsQuery = useClientsOverview({ spaceId: spaceId === 'all' ? undefined : spaceId, sort });
  const spacesQuery = useSpaces();

  const spaceOptions = useMemo(() => {
    const rows: SpaceOption[] = (spacesQuery.data ?? []) as SpaceOption[];
    return [
      { value: 'all', label: 'All spaces' },
      ...rows
        .filter((s) => s.spaceId)
        .map((s) => ({ value: s.spaceId as string, label: s.spaceName ?? (s.spaceId as string) })),
    ];
  }, [spacesQuery.data]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () => (clientsQuery.data ?? []).filter((r) => !q || r.client.toLowerCase().includes(q)),
    [clientsQuery.data, q],
  );

  const totals = useMemo(
    () => ({
      clients: rows.length,
      tasks: rows.reduce((sum, r) => sum + r.taskCount, 0),
      hours: rows.reduce((sum, r) => sum + r.totalHours, 0),
    }),
    [rows],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        title="Clients"
        description="Every client's first and last task, and the work in between."
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ width: 240, display: 'flex' }}>
          <Input
            icon={<Search size={14} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients…"
          />
        </div>
        <Select size="md" icon={<Layers size={13} />} value={spaceId} onChange={setSpaceId} options={spaceOptions} />
        <Select size="md" value={sort} onChange={(v) => setSort(v as ClientSort)} options={SORTS} />
      </div>

      {clientsQuery.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={180} radius="12px" />
          ))}
        </div>
      ) : clientsQuery.isError ? (
        <QueryError query={clientsQuery} what="clients" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 size={20} />}
            title={q ? 'No matching clients' : 'No clients yet'}
            body={
              q
                ? 'Try a different search, or widen the space filter.'
                : 'Tasks need the ClickUp "Client" field set before they show up here.'
            }
          />
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map((row) => (
              // Keyed on the NAME, not `clientOptionId`: the overview groups by
              // `t.client`, so the name is unique by construction while the
              // option id is not — a renamed ClickUp option leaves its old
              // label on tasks not touched since, producing two rows that share
              // one id. That key collision made React keep a stale card on
              // every filter change, so searching showed the same client twice.
              <ClientCard key={row.client} row={row} />
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 2px' }}>
            {totals.clients} {totals.clients === 1 ? 'client' : 'clients'} · {fmt.number(totals.tasks)} tasks ·{' '}
            {fmt.hours(totals.hours)} logged
          </p>
        </>
      )}
    </div>
  );
}
