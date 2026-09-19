import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Network,
  Plus,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  X,
  UserPlus,
  Users,
  Link2,
  AlertTriangle,
  CircleCheck,
  Check,
  Crown,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Pill } from '../components/ui/Pill';
import { Avatar } from '../components/ui/Avatar';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { ClientPicker } from '../components/teams/ClientPicker';
import { useTeams, useClientOptions, useReadiness, useTeamMutations } from '../hooks/useTeams';
import { useOrgUsers } from '../hooks/useUsers';
import type { Team, TeamClientsConflict, TeamMemberRoleValue } from '../api/teams';

function emailLabel(email: string) {
  return email.split('@')[0];
}

function axiosMessage(e: unknown): string {
  return (
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
    (e as Error)?.message ??
    'Something went wrong'
  );
}

function axiosConflicts(e: unknown): TeamClientsConflict[] | null {
  const status = (e as { response?: { status?: number } })?.response?.status;
  if (status !== 409) return null;
  const conflicts = (e as { response?: { data?: { conflicts?: TeamClientsConflict[] } } })?.response?.data?.conflicts;
  return Array.isArray(conflicts) ? conflicts : null;
}

const TEAM_ROLE_TONE: Record<TeamMemberRoleValue, 'purple' | 'gray'> = { LEAD: 'purple', MEMBER: 'gray' };

/** A conflict enriched with the client's display name (never a raw option id) — used only for the confirm's copy. */
interface NamedConflict extends TeamClientsConflict {
  name: string;
}

// ── Toast (same pattern as the Users page) ─────────────────────────────────
function Toast({ message }: { message: string }) {
  return (
    <div
      style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 90,
        display: 'flex', alignItems: 'center', gap: 9, padding: '10px 16px', background: 'var(--text)',
        color: 'var(--surface)', borderRadius: 10, fontSize: 13, fontWeight: 500,
        boxShadow: '0 8px 28px rgba(15,23,42,0.28)',
      }}
    >
      <CircleCheck size={15} /> {message}
    </div>
  );
}

// ── New team modal ──────────────────────────────────────────────────────────
function NewTeamModal({
  clientOptions,
  onClose,
  onCreate,
  creating,
}: {
  clientOptions: ReturnType<typeof useClientOptions>['data'];
  onClose: () => void;
  onCreate: (name: string, optionIds: string[]) => void;
  creating: boolean;
}) {
  const [name, setName] = useState('');
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const trimmed = name.trim();

  return (
    <Modal
      onClose={onClose}
      width={520}
      title="New team"
      subtitle="Group members and assign the ClickUp clients they should see."
      onSubmit={() => trimmed && onCreate(trimmed, optionIds)}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" icon={<Plus size={13} />} disabled={!trimmed} loading={creating}>
            Create team
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Team name
          </label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Digital Team A" autoFocus />
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Clients
          </label>
          <ClientPicker options={clientOptions ?? []} value={optionIds} onChange={(r) => setOptionIds(r.optionIds)} allowMove={false} />
        </div>
      </div>
    </Modal>
  );
}

// ── Edit clients modal ───────────────────────────────────────────────────────
function EditClientsModal({
  team,
  clientOptions,
  onClose,
  onSave,
  saving,
}: {
  team: Team;
  clientOptions: ReturnType<typeof useClientOptions>['data'];
  onClose: () => void;
  onSave: (optionIds: string[], move: boolean) => void;
  saving: boolean;
}) {
  const [optionIds, setOptionIds] = useState<string[]>(team.clients.map((c) => c.optionId));
  const [move, setMove] = useState(false);

  return (
    <Modal
      onClose={onClose}
      width={520}
      title={`Edit clients — ${team.name}`}
      onSubmit={() => onSave(optionIds, move)}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" loading={saving}>
            Save clients
          </Button>
        </div>
      }
    >
      <ClientPicker
        options={clientOptions ?? []}
        teamId={team.id}
        value={optionIds}
        onChange={(r) => {
          setOptionIds(r.optionIds);
          setMove(r.move);
        }}
      />
    </Modal>
  );
}

// ── Move/steal conflict confirm ─────────────────────────────────────────────
function ClientMoveConfirm({
  conflicts,
  loading,
  onCancel,
  onConfirm,
}: {
  conflicts: NamedConflict[];
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onCancel} width={460}>
      <div style={{ display: 'flex', gap: 14 }}>
        <div
          style={{
            width: 40, height: 40, flexShrink: 0, borderRadius: 10, background: 'var(--pill-amber-bg)',
            color: 'var(--pill-amber-text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <AlertTriangle size={19} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
            {conflicts.length > 1 ? 'These clients belong to other teams' : 'This client belongs to another team'}
          </h2>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {conflicts.map((c) => (
              <p key={c.optionId} style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>
                <strong style={{ color: 'var(--text)' }}>{c.name}</strong> belongs to{' '}
                <strong style={{ color: 'var(--text)' }}>{c.teamName}</strong>. Moving it removes {c.teamName}&apos;s access
                to all of its history.
              </p>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" loading={loading} onClick={onConfirm} style={{ boxShadow: 'none' }}>
          Move {conflicts.length > 1 ? `${conflicts.length} clients` : 'client'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Delete team confirm ──────────────────────────────────────────────────────
function DeleteTeamModal({
  team,
  loading,
  onCancel,
  onConfirm,
}: {
  team: Team;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onCancel} width={440}>
      <div style={{ display: 'flex', gap: 14 }}>
        <div
          style={{
            width: 40, height: 40, flexShrink: 0, borderRadius: 10, background: 'var(--pill-red-bg)',
            color: 'var(--pill-red-text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <AlertTriangle size={19} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Delete {team.name}?</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.55 }}>
            Its {team.clients.length} {team.clients.length === 1 ? 'client' : 'clients'} return to Unassigned and its
            members lose access to them. This can&apos;t be undone.
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" icon={<Trash2 size={13} />} loading={loading} onClick={onConfirm} style={{ boxShadow: 'none' }}>
          Delete team
        </Button>
      </div>
    </Modal>
  );
}

// ── Readiness strip ──────────────────────────────────────────────────────────
function ReadinessStrip({
  readiness,
  teams,
  onAssign,
}: {
  readiness: ReturnType<typeof useReadiness>['data'];
  teams: Team[];
  onAssign: (optionId: string, teamId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!readiness) return null;

  const items: { key: string; label: string; count: number }[] = [
    { key: 'unassigned', label: 'Unassigned clients', count: readiness.unassignedClients.length },
    { key: 'noTeam', label: 'Members without a team', count: readiness.membersWithoutTeam.length },
    { key: 'noClickup', label: 'Users without a ClickUp link', count: readiness.usersWithoutClickupLink.length },
    { key: 'ambiguous', label: 'Ambiguous client names', count: readiness.ambiguousNames.length },
  ];

  if (items.every((i) => i.count === 0)) return null;

  return (
    <Card padding={0}>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            onClick={() => i.count > 0 && setOpen((o) => (o === i.key ? null : i.key))}
            disabled={i.count === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', flex: '1 1 200px',
              border: 0, borderRight: '1px solid var(--border-soft)', background: open === i.key ? 'var(--hover)' : 'transparent',
              cursor: i.count === 0 ? 'default' : 'pointer', textAlign: 'left',
            }}
          >
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 22,
                padding: '0 6px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                background: i.count > 0 ? 'var(--pill-amber-bg)' : 'var(--pill-green-bg)',
                color: i.count > 0 ? 'var(--pill-amber-text)' : 'var(--pill-green-text)',
              }}
            >
              {i.count}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', flex: 1 }}>{i.label}</span>
            {i.count > 0 && (open === i.key ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          </button>
        ))}
      </div>

      {open === 'unassigned' && readiness.unassignedClients.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {readiness.unassignedClients.map((c) => (
            <div key={c.optionId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{c.name}</span>
              <Select
                size="sm"
                value=""
                onChange={(teamId) => onAssign(c.optionId, teamId)}
                placeholder="Assign to…"
                options={teams.map((t) => ({ value: t.id, label: t.name }))}
                ariaLabel={`Assign ${c.name} to a team`}
              />
            </div>
          ))}
        </div>
      )}
      {open === 'noTeam' && readiness.membersWithoutTeam.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {readiness.membersWithoutTeam.map((u) => (
            <div key={u.id} style={{ fontSize: 13, color: 'var(--text)' }}>{u.name?.trim() || u.email}</div>
          ))}
          <Link to="/team" style={{ fontSize: 12.5, color: 'var(--accent-strong)', fontWeight: 600 }}>
            Fix in Team →
          </Link>
        </div>
      )}
      {open === 'noClickup' && readiness.usersWithoutClickupLink.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {readiness.usersWithoutClickupLink.map((u) => (
            <div key={u.id} style={{ fontSize: 13, color: 'var(--text)' }}>{u.name?.trim() || u.email}</div>
          ))}
          <Link to="/team" style={{ fontSize: 12.5, color: 'var(--accent-strong)', fontWeight: 600 }}>
            Fix in Team →
          </Link>
        </div>
      )}
      {open === 'ambiguous' && readiness.ambiguousNames.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 6px' }}>
            More than one client option shares this name across teams — assignment can&apos;t tell them apart.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {readiness.ambiguousNames.map((n) => (
              <Pill key={n} tone="amber" size="sm">
                {n}
              </Pill>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Add member row ───────────────────────────────────────────────────────────
function AddMemberRow({
  candidates,
  onAdd,
  onCancel,
  adding,
}: {
  candidates: { id: string; name: string | null; email: string }[];
  onAdd: (userId: string) => void;
  onCancel: () => void;
  adding: boolean;
}) {
  const [userId, setUserId] = useState('');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Select
          fullWidth
          searchable
          value={userId}
          onChange={setUserId}
          placeholder="Choose a member…"
          options={candidates.map((c) => ({ value: c.id, label: c.name?.trim() || c.email }))}
          ariaLabel="Choose a member to add"
        />
      </div>
      <Button size="sm" variant="accent" icon={<Check size={13} />} disabled={!userId} loading={adding} onClick={() => userId && onAdd(userId)}>
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

// ── Team detail panel ────────────────────────────────────────────────────────
function TeamDetail({
  team,
  orgUsers,
  clientOptions,
  onClose,
  onRequestDelete,
  onRequestEditClients,
  onRemoveClient,
  onSetRole,
  onRemoveMember,
  onAddMember,
  onRename,
  toast,
}: {
  team: Team;
  orgUsers: { id: string; name: string | null; email: string; status: 'ACTIVE' | 'DISABLED' }[];
  clientOptions: ReturnType<typeof useClientOptions>['data'];
  onClose: () => void;
  onRequestDelete: () => void;
  onRequestEditClients: () => void;
  onRemoveClient: (optionId: string) => void;
  onSetRole: (userId: string, role: TeamMemberRoleValue) => void;
  onRemoveMember: (userId: string) => void;
  onAddMember: (userId: string) => void;
  onRename: (name: string) => void;
  toast: (msg: string) => void;
}) {
  // The caller keys this component on `team.id` (see TeamsPage's render
  // below), so selecting a different team remounts it with a fresh `name`
  // initializer instead of needing an effect to resync it on rename/switch.
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const [addingMember, setAddingMember] = useState(false);
  const memberIds = new Set(team.members.map((m) => m.userId));
  const candidates = orgUsers.filter((u) => u.status === 'ACTIVE' && !memberIds.has(u.id));

  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        {renaming ? (
          <>
            <div style={{ flex: 1 }}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <Button
              size="sm"
              variant="accent"
              onClick={() => {
                const trimmed = name.trim();
                if (trimmed && trimmed !== team.name) onRename(trimmed);
                setRenaming(false);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="default" onClick={() => { setRenaming(false); setName(team.name); }}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0, flex: 1 }}>{team.name}</h2>
            <Button size="sm" variant="default" icon={<Pencil size={12} />} onClick={() => setRenaming(true)}>
              Rename
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={onRequestDelete}>
              Delete
            </Button>
            <button
              type="button"
              aria-label="Close detail"
              onClick={onClose}
              style={{ width: 28, height: 28, border: 0, background: 'transparent', color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={15} />
            </button>
          </>
        )}
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Clients */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Clients ({team.clients.length})
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {team.clients.length === 0 && (
              <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>No clients assigned.</span>
            )}
            {team.clients.map((c) => (
              <span
                key={c.optionId}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px',
                  background: 'var(--muted-bg)', borderRadius: 999, fontSize: 12.5,
                  textDecoration: c.archived ? 'line-through' : 'none', color: c.archived ? 'var(--text-faint)' : 'var(--text)',
                }}
              >
                {c.name}
                <button
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  onClick={() => onRemoveClient(c.optionId)}
                  style={{ width: 16, height: 16, border: 0, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <Button size="sm" variant="default" icon={<Plus size={12} />} onClick={onRequestEditClients} disabled={!clientOptions}>
              Add client
            </Button>
          </div>
        </div>

        {/* Members */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Members ({team.members.length})
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {team.members.map((m) => (
              <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <Avatar name={m.name?.trim() || m.email} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.name?.trim() || emailLabel(m.email)}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {m.email}
                    {!m.clickupUserId && ' · No ClickUp link'}
                  </div>
                </div>
                <div style={{ width: 118, flexShrink: 0 }}>
                  <Select
                    size="sm"
                    fullWidth
                    value={m.role}
                    onChange={(v) => onSetRole(m.userId, v as TeamMemberRoleValue)}
                    options={[
                      { value: 'LEAD', label: 'Lead' },
                      { value: 'MEMBER', label: 'Member' },
                    ]}
                    ariaLabel={`Role for ${m.name ?? m.email}`}
                  />
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${m.name ?? m.email}`}
                  onClick={() => onRemoveMember(m.userId)}
                  style={{ width: 28, height: 28, border: 0, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {team.members.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>No members yet.</span>}

            {addingMember ? (
              <AddMemberRow
                candidates={candidates}
                adding={false}
                onCancel={() => setAddingMember(false)}
                onAdd={(userId) => {
                  onAddMember(userId);
                  setAddingMember(false);
                }}
              />
            ) : (
              <Button
                size="sm"
                variant="default"
                icon={<UserPlus size={12} />}
                onClick={() => (candidates.length > 0 ? setAddingMember(true) : toast('Every active user is already on this team.'))}
                style={{ alignSelf: 'flex-start', marginTop: 4 }}
              >
                Add member
              </Button>
            )}
          </div>
        </div>

        {/* Pending invites */}
        {team.pendingInvites.length > 0 && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Pending invites ({team.pendingInvites.length})
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {team.pendingInvites.map((inv) => (
                <div key={inv.invitationId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{inv.email}</span>
                  <Pill tone={TEAM_ROLE_TONE[inv.role]} size="sm">
                    {inv.role === 'LEAD' ? 'Lead' : 'Member'}
                  </Pill>
                  <Pill tone="amber" size="xs">
                    Pending
                  </Pill>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function TeamsPage() {
  const teamsQuery = useTeams();
  const clientOptionsQuery = useClientOptions();
  const readinessQuery = useReadiness();
  const orgUsersQuery = useOrgUsers();
  const m = useTeamMutations();

  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const orgUsers = useMemo(() => orgUsersQuery.data ?? [], [orgUsersQuery.data]);

  const [newTeamOpen, setNewTeamOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editClientsOpen, setEditClientsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{ teamId: string; optionIds: string[]; conflicts: NamedConflict[] } | null>(null);
  const [toast, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const selectedTeam = teams.find((t) => t.id === selectedId) ?? null;

  async function createTeam(name: string, optionIds: string[]) {
    try {
      await m.create.mutateAsync({ name, optionIds });
      setNewTeamOpen(false);
      showToast('Team created');
    } catch (e) {
      showToast(axiosMessage(e));
    }
  }

  async function renameTeam(id: string, name: string) {
    try {
      await m.rename.mutateAsync({ id, name });
      showToast('Team renamed');
    } catch (e) {
      showToast(axiosMessage(e));
    }
  }

  async function deleteTeam() {
    if (!deleteTarget) return;
    try {
      const res = await m.remove.mutateAsync(deleteTarget.id);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      showToast(`Team deleted — ${res.releasedClients} client${res.releasedClients === 1 ? '' : 's'} returned to Unassigned`);
    } catch (e) {
      showToast(axiosMessage(e));
    }
  }

  /** Shared by "remove one chip", the edit-clients modal, and the readiness
   *  "assign" picker. Always tries `move:false` first; a 409 (someone else's
   *  clients came along, or a race since the picker's data was fetched) opens
   *  the explicit confirm and only THEN retries with `move:true`. */
  async function saveClients(teamId: string, optionIds: string[], proactiveMove: boolean) {
    const options = clientOptionsQuery.data ?? [];
    const nameFor = (optionId: string) => options.find((o) => o.optionId === optionId)?.name ?? optionId;
    if (proactiveMove) {
      const conflicts: NamedConflict[] = options
        .filter((o) => optionIds.includes(o.optionId) && o.teamId && o.teamId !== teamId)
        .map((o) => ({ optionId: o.optionId, name: o.name, teamId: o.teamId as string, teamName: o.teamName ?? 'another team' }));
      setMoveConfirm({ teamId, optionIds, conflicts });
      return;
    }
    try {
      await m.setClients.mutateAsync({ id: teamId, optionIds, move: false });
      setEditClientsOpen(false);
      showToast('Clients updated');
    } catch (e) {
      const conflicts = axiosConflicts(e);
      if (conflicts) {
        const named: NamedConflict[] = conflicts.map((c) => ({ ...c, name: nameFor(c.optionId) }));
        setMoveConfirm({ teamId, optionIds, conflicts: named });
      } else {
        showToast(axiosMessage(e));
      }
    }
  }

  async function confirmMove() {
    if (!moveConfirm) return;
    try {
      await m.setClients.mutateAsync({ id: moveConfirm.teamId, optionIds: moveConfirm.optionIds, move: true });
      setMoveConfirm(null);
      setEditClientsOpen(false);
      showToast('Clients updated');
    } catch (e) {
      showToast(axiosMessage(e));
      setMoveConfirm(null);
    }
  }

  function removeClient(team: Team, optionId: string) {
    void saveClients(team.id, team.clients.filter((c) => c.optionId !== optionId).map((c) => c.optionId), false);
  }

  function assignUnassigned(optionId: string, teamId: string) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;
    void saveClients(teamId, [...team.clients.map((c) => c.optionId), optionId], false);
  }

  async function setRole(teamId: string, userId: string, role: TeamMemberRoleValue) {
    try {
      await m.setRole.mutateAsync({ id: teamId, userId, role });
      showToast(`Role updated to ${role === 'LEAD' ? 'Lead' : 'Member'}`);
    } catch (e) {
      showToast(axiosMessage(e));
    }
  }

  async function removeMember(teamId: string, userId: string) {
    try {
      await m.removeMember.mutateAsync({ id: teamId, userId });
      showToast('Member removed');
    } catch (e) {
      showToast(axiosMessage(e));
    }
  }

  async function addMember(teamId: string, userId: string) {
    try {
      await m.addMember.mutateAsync({ id: teamId, userId, role: 'MEMBER' });
      showToast('Member added');
    } catch (e) {
      showToast(axiosMessage(e));
    }
  }

  const loading = teamsQuery.isLoading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        title="Teams"
        description="Group members and assign ClickUp clients so cost, sprints and chargeability can be scoped per team."
        actions={
          <Button variant="accent" icon={<Plus size={14} />} onClick={() => setNewTeamOpen(true)}>
            New team
          </Button>
        }
      />

      <ReadinessStrip readiness={readinessQuery.data} teams={teams} onAssign={assignUnassigned} />

      <Card padding={0}>
        {loading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={44} radius="8px" />
            ))}
          </div>
        ) : teams.length === 0 ? (
          <EmptyState
            icon={<Network size={20} strokeWidth={1.75} />}
            title="No teams yet"
            body="Create a team to scope clients, cost visibility, and sprint access to a group of members."
            action={
              <Button variant="accent" size="sm" icon={<Plus size={13} />} onClick={() => setNewTeamOpen(true)}>
                New team
              </Button>
            }
          />
        ) : (
          <div>
            {teams.map((t) => {
              const leads = t.members.filter((m) => m.role === 'LEAD');
              const isSelected = selectedId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(isSelected ? null : t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 16px',
                    border: 0, borderTop: '1px solid var(--border-soft)', background: isSelected ? 'var(--accent-soft)' : 'transparent',
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  }}
                >
                  <Network size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', flexShrink: 0 }}>{t.name}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Crown size={12} />
                    {leads.length > 0 ? leads.map((l) => l.name?.trim() || emailLabel(l.email)).join(', ') : 'No lead'}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Users size={12} /> {t.members.length}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Link2 size={12} /> {t.clients.length}
                  </span>
                  <ChevronRight
                    size={15}
                    style={{ color: 'var(--text-faint)', transform: isSelected ? 'rotate(90deg)' : undefined, transition: 'transform 100ms' }}
                  />
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {selectedTeam && (
        <TeamDetail
          // Keyed on team id: selecting a different team remounts the panel
          // (rename/adding-member local state) fresh instead of needing an
          // effect to resync it.
          key={selectedTeam.id}
          team={selectedTeam}
          orgUsers={orgUsers}
          clientOptions={clientOptionsQuery.data}
          onClose={() => setSelectedId(null)}
          onRequestDelete={() => setDeleteTarget(selectedTeam)}
          onRequestEditClients={() => setEditClientsOpen(true)}
          onRemoveClient={(optionId) => removeClient(selectedTeam, optionId)}
          onSetRole={(userId, role) => void setRole(selectedTeam.id, userId, role)}
          onRemoveMember={(userId) => void removeMember(selectedTeam.id, userId)}
          onAddMember={(userId) => void addMember(selectedTeam.id, userId)}
          onRename={(name) => void renameTeam(selectedTeam.id, name)}
          toast={showToast}
        />
      )}

      {newTeamOpen && (
        <NewTeamModal
          clientOptions={clientOptionsQuery.data}
          onClose={() => setNewTeamOpen(false)}
          onCreate={(name, optionIds) => void createTeam(name, optionIds)}
          creating={m.create.isPending}
        />
      )}

      {editClientsOpen && selectedTeam && (
        <EditClientsModal
          team={selectedTeam}
          clientOptions={clientOptionsQuery.data}
          onClose={() => setEditClientsOpen(false)}
          onSave={(optionIds, move) => void saveClients(selectedTeam.id, optionIds, move)}
          saving={m.setClients.isPending}
        />
      )}

      {moveConfirm && (
        <ClientMoveConfirm
          conflicts={moveConfirm.conflicts}
          loading={m.setClients.isPending}
          onCancel={() => setMoveConfirm(null)}
          onConfirm={() => void confirmMove()}
        />
      )}

      {deleteTarget && (
        <DeleteTeamModal
          team={deleteTarget}
          loading={m.remove.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void deleteTeam()}
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
