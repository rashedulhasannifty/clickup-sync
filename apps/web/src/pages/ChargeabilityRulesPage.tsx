import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Scale, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useChargeabilityRules, useSetAssigneeChargeable } from '../hooks/useReports';
import { useWorkspaceMembers } from '../hooks/useRates';
import { adminApi, type ChargeabilityRule } from '../api/admin';
import { fmt } from '../lib/formatters';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { Card } from '../components/ui/Card';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Field } from '../components/ui/Field';
import { ClickupAvatar } from '../components/ui/ClickupAvatar';

const PAGE_SIZE = 50;

interface TaskHit {
  taskId: string;
  taskName: string;
}

/**
 * The only aggregate view of (task, assignee) chargeability rules. Everywhere
 * else you have to already know which task to open, which makes a rule that
 * suppresses billable hours effectively invisible once it's set.
 *
 * It is also the only place a rule can be created for someone who has not
 * logged time on the task yet: the task drawer builds its per-assignee controls
 * from time entries, so the forward-looking case — set the rule, then the work
 * happens — has nowhere else to go.
 */
export function ChargeabilityRulesPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const [page, setPage] = useState(1);
  const rulesQuery = useChargeabilityRules({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const setRule = useSetAssigneeChargeable();
  const [adding, setAdding] = useState(false);

  const items = rulesQuery.data?.items ?? [];
  const total = rulesQuery.data?.total ?? 0;

  // A rule stores only a ClickUp user id, so the backend can borrow a name from
  // a time entry — and comes back empty for the prospective rules this page
  // exists to create. The members list the Add modal already needs fills those
  // in, so a forward-looking rule doesn't render as a bare id.
  const { data: members } = useWorkspaceMembers();
  const nameById = useMemo(
    () => new Map((members ?? []).map((m) => [String(m.id), m.name])),
    [members],
  );
  const nameOf = (r: ChargeabilityRule) => r.userName ?? nameById.get(r.userId) ?? r.userId;

  const columns: Column<ChargeabilityRule>[] = [
    {
      key: 'task',
      header: 'Task',
      width: 280,
      // maxWidth 256 = column 280 - cell padding (12+12), so a long task name
      // truncates instead of widening the column and squeezing every column
      // after it. Same convention as the Task columns on Time Entries.
      render: (r) => (
        <div style={{ maxWidth: 256 }}>
          <span
            title={r.taskName ?? r.taskId}
            style={{
              fontWeight: 500, display: 'block', maxWidth: 256,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {r.taskName ?? r.taskId}
          </span>
          {r.spaceName && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>{r.spaceName}</span>
          )}
        </div>
      ),
    },
    {
      key: 'assignee',
      header: 'Assignee',
      width: 180,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ClickupAvatar userId={r.userId} name={nameOf(r)} size={20} />
          <span
            title={nameOf(r)}
            style={{ fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {nameOf(r)}
          </span>
        </span>
      ),
    },
    {
      key: 'chargeable',
      header: 'Rule',
      width: 130,
      render: (r) => (
        r.chargeable
          ? <Pill tone="green" size="xs">chargeable</Pill>
          : <Pill tone="gray" size="xs">non-chargeable</Pill>
      ),
    },
    {
      // What the rule is actually doing. A rule with zero hours is either
      // brand new or pointed at the wrong person — both worth seeing.
      // Header kept short on purpose: right-aligned, so a long one runs into
      // the left-aligned header of the column beside it.
      key: 'hours',
      header: 'Hours',
      width: 120,
      align: 'right',
      render: (r) => (
        r.entryCount === 0
          ? <span style={{ color: 'var(--text-faint)' }}>no time logged</span>
          : (
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmt.duration(r.hours)}
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {r.entryCount}</span>
            </span>
          )
      ),
    },
    {
      key: 'note',
      header: 'Note',
      width: 200,
      render: (r) => (
        r.note
          ? (
            <span
              title={r.note}
              style={{
                fontSize: 12, display: 'block', maxWidth: 176,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {r.note}
            </span>
          )
          : <span style={{ color: 'var(--text-faint)' }}>—</span>
      ),
    },
    {
      key: 'setBy',
      header: 'Set by',
      width: 160,
      render: (r) => (
        <span
          title={r.setBy ?? ''}
          style={{
            fontSize: 12, display: 'block', maxWidth: 136,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {r.setBy ?? '—'}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: 120,
      render: (r) => <span style={{ fontSize: 12 }}>{fmt.date(r.updatedAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: 190,
      render: (r) => (
        canEdit ? (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <Button
              size="sm"
              variant="ghost"
              disabled={setRule.isPending}
              onClick={(e) => {
                e.stopPropagation();
                setRule.mutate({ taskId: r.taskId, userId: r.userId, chargeable: !r.chargeable });
              }}
            >
              {r.chargeable ? 'Mark non-chargeable' : 'Mark chargeable'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={setRule.isPending}
              icon={<Trash2 size={12} strokeWidth={1.75} />}
              onClick={(e) => {
                e.stopPropagation();
                // Clearing goes through the same PATCH the drawer uses
                // (`chargeable: null`) — already audited and recalc-scoped, so
                // there is deliberately no separate DELETE endpoint.
                setRule.mutate({ taskId: r.taskId, userId: r.userId, chargeable: null });
              }}
            >
              Clear
            </Button>
          </span>
        ) : null
      ),
    },
  ];

  if (rulesQuery.isError) return <QueryError query={rulesQuery} what="chargeability rules" />;

  return (
    <div>
      <PageHeader
        title="Chargeability Rules"
        description="Per-assignee exceptions to a task's chargeable flag. The most specific rule wins, so one person's time can be excluded from an otherwise chargeable task — or included on a non-chargeable one."
        actions={canEdit ? (
          <Button size="md" variant="primary" icon={<Plus size={14} strokeWidth={2} />} onClick={() => setAdding(true)}>
            Add rule
          </Button>
        ) : undefined}
      />

      <Card>
        <DataTable<ChargeabilityRule>
          layout="design"
          stickyFirstColumn
          rowKey="id"
          columns={columns}
          data={items}
          loading={rulesQuery.isLoading}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onRowClick={(r) => navigate(`/tasks?taskIds=${encodeURIComponent(r.taskId)}`)}
          emptyTitle="No chargeability rules"
          emptyIcon={<Scale size={20} strokeWidth={1.5} />}
          emptyBody="Rules let you exclude one person's time from a chargeable task. Add one here, or from the per-assignee controls in any task's drawer."
        />
      </Card>

      {adding && (
        <AddRuleModal
          onClose={() => setAdding(false)}
          members={members ?? []}
          onSubmit={(v) => {
            setRule.mutate(
              { taskId: v.taskId, userId: v.userId, chargeable: v.chargeable, note: v.note || undefined },
              { onSuccess: () => setAdding(false) },
            );
          }}
          pending={setRule.isPending}
        />
      )}
    </div>
  );
}

/**
 * Task picker + member picker. The task search hits `/admin/search`, which
 * matches on task name OR an exact task id — so pasting an id from ClickUp
 * works as well as typing a name.
 */
function AddRuleModal({
  onClose, members, onSubmit, pending,
}: {
  onClose: () => void;
  members: { id: string; name: string | null; email: string | null }[];
  onSubmit: (v: { taskId: string; userId: string; chargeable: boolean; note: string }) => void;
  pending: boolean;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TaskHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [task, setTask] = useState<TaskHit | null>(null);
  const [userId, setUserId] = useState('');
  const [chargeable, setChargeable] = useState('false');
  const [note, setNote] = useState('');

  async function runSearch() {
    const term = q.trim();
    // Mirrors the backend's own floor: fewer than 2 characters returns nothing,
    // so don't spend a request on it.
    if (term.length < 2) return;
    setSearching(true);
    try {
      const res = await adminApi.searchTasks(term);
      setHits(res.tasks.map((t) => ({ taskId: t.taskId, taskName: t.taskName })));
    } finally {
      setSearching(false);
    }
  }

  const memberOptions = [
    { value: '', label: 'Select an assignee…' },
    ...members.map((m) => ({ value: String(m.id), label: m.name ?? m.email ?? String(m.id) })),
  ];

  const canSubmit = !!task && !!userId && !pending;

  return (
    <Modal
      open
      onClose={onClose}
      title="Add chargeability rule"
      subtitle="Applies to one person's time on one task. It takes effect immediately, including for time logged later."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={() => task && onSubmit({ taskId: task.taskId, userId, chargeable: chargeable === 'true', note })}
          >
            {pending ? 'Saving…' : 'Add rule'}
          </Button>
        </>
      }
    >
      <Field label="Task">
        {task ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{task.taskName}</span>
            <Button size="sm" variant="ghost" onClick={() => { setTask(null); setHits([]); }}>Change</Button>
          </span>
        ) : (
          <>
            <span style={{ display: 'flex', gap: 6 }}>
              <Input
                value={q}
                placeholder="Search by task name, or paste a task id"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }}
              />
              <Button variant="default" icon={<Search size={12} strokeWidth={1.75} />} onClick={() => void runSearch()}>
                Search
              </Button>
            </span>
            {searching && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Searching…</div>}
            {!searching && hits.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {hits.map((h) => (
                  <Button key={h.taskId} size="sm" variant="ghost" onClick={() => setTask(h)}>
                    {h.taskName}
                  </Button>
                ))}
              </div>
            )}
            {!searching && q.trim().length >= 2 && hits.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                No matches yet — press Search.
              </div>
            )}
          </>
        )}
      </Field>

      <Field label="Assignee">
        <Select ariaLabel="Assignee" value={userId} onChange={setUserId} options={memberOptions} />
      </Field>

      <Field label="Their time on this task is">
        <Select
          ariaLabel="Chargeable"
          value={chargeable}
          onChange={setChargeable}
          options={[
            { value: 'false', label: 'Non-chargeable' },
            { value: 'true', label: 'Chargeable' },
          ]}
        />
      </Field>

      <Field label="Note (optional)">
        <Input value={note} placeholder="Why this exception exists" onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}
