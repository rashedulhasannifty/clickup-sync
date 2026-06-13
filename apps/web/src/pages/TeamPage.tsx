import { useEffect, useMemo, useRef, useState } from 'react';
import {
  UserPlus,
  Search,
  Shield,
  Users,
  Send,
  Clock,
  MoreHorizontal,
  Eye,
  Trash2,
  Check,
  ChevronDown,
  CircleCheck,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Pill } from '../components/ui/Pill';
import { Avatar } from '../components/ui/Avatar';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useOrgUsers, useInvites, useUserMutations } from '../hooks/useUsers';
import { useAuth } from '../hooks/useAuth';
import { fmt } from '../lib/formatters';
import type { OrgUser, Invite } from '../api/users';
import type { Role } from '../api/auth';
import { RoleSelect, ROLE_META, ALL_ROLES } from '../components/team/RoleSelect';
import { InviteMembersModal, type InvitePayload } from '../components/team/InviteMembersModal';
import { MemberDrawer, type DrawerMember } from '../components/team/MemberDrawer';
import { ConfirmRemove, type RemoveTarget } from '../components/team/ConfirmRemove';

type Tab = 'active' | 'pending';

const FIVE_MIN = 5 * 60 * 1000;

function emailLabel(email: string) {
  return email.split('@')[0];
}

function avatarFor(name: string | null, email: string) {
  const trimmed = name?.trim();
  if (trimmed) {
    const initials = trimmed
      .split(/\s+/)
      .map((p) => p[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    return { name: trimmed, initials };
  }
  // No name (e.g. pending invites): fall back to two-letter email initials.
  return { name: email, initials: email.slice(0, 2).toUpperCase() };
}

// ── Row overflow menu ─────────────────────────────────────────────────────────
function RowMenu({
  tab,
  isSelf,
  canRemove,
  onView,
  onResend,
  onRemove,
}: {
  tab: Tab;
  isSelf: boolean;
  canRemove: boolean;
  onView: () => void;
  onResend: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const item = (icon: React.ReactNode, label: string, fn: () => void, danger?: boolean) => (
    <button
      type="button"
      onClick={() => {
        fn();
        setOpen(false);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        padding: '7px 10px',
        border: 0,
        background: 'transparent',
        borderRadius: 6,
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: 13,
        color: danger ? 'var(--red)' : 'var(--text)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.08)' : 'var(--hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Member actions"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: 28,
          height: 28,
          border: '1px solid transparent',
          background: 'transparent',
          borderRadius: 7,
          cursor: 'pointer',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--hover)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.borderColor = 'transparent';
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            width: 184,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 5,
            boxShadow: '0 12px 32px rgba(15,23,42,0.16)',
          }}
        >
          {tab === 'active'
            ? item(<Eye size={14} />, 'View profile', onView)
            : item(<Send size={14} />, 'Resend invite', onResend)}
          {(canRemove || isSelf) && <div style={{ height: 1, background: 'var(--border-soft)', margin: '5px 6px' }} />}
          {canRemove && item(<Trash2 size={14} />, tab === 'pending' ? 'Revoke invite' : 'Remove member', onRemove, true)}
          {isSelf && <div style={{ padding: '7px 10px', fontSize: 11.5, color: 'var(--text-faint)' }}>This is you</div>}
        </div>
      )}
    </span>
  );
}

// ── Bulk role mini-dropdown ─────────────────────────────────────────────────────
function BulkRoleButton({ roles, onPick }: { roles: Role[]; onPick: (r: Role) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <Button
        size="sm"
        variant="default"
        icon={<Shield size={13} />}
        iconRight={<ChevronDown size={12} />}
        onClick={() => setOpen((o) => !o)}
      >
        Change role
      </Button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 50,
            width: 150,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 9,
            padding: 5,
            boxShadow: '0 12px 32px rgba(15,23,42,0.16)',
          }}
        >
          {roles.map((r) => {
            const Ic = ROLE_META[r].icon;
            return (
              <button
                type="button"
                key={r}
                onClick={() => {
                  onPick(r);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '7px 9px',
                  border: 0,
                  background: 'transparent',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                  color: 'var(--text)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <Ic size={14} style={{ color: 'var(--text-muted)' }} />
                {ROLE_META[r].label}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

// ── Checkbox ────────────────────────────────────────────────────────────────────
function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(); }
      }}
      style={{
        width: 17,
        height: 17,
        borderRadius: 5,
        flexShrink: 0,
        padding: 0,
        border: `1.5px solid ${checked || indeterminate ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: checked || indeterminate ? 'var(--accent)' : 'transparent',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        cursor: 'pointer',
        transition: 'all 100ms',
      }}
    >
      {checked && <Check size={12} strokeWidth={3} />}
      {indeterminate && !checked && <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1 }} />}
    </button>
  );
}

const TH: React.CSSProperties = { textAlign: 'left', padding: '10px 12px' };

export function TeamPage() {
  const { user, hasRole } = useAuth();
  const usersQuery = useOrgUsers();
  const invitesQuery = useInvites();
  const m = useUserMutations();

  const isOwner = hasRole('OWNER');
  // Roles a non-owner may assign: ADMIN/MEMBER. An owner may also assign OWNER.
  const assignableRoles: Role[] = isOwner ? ALL_ROLES : (['ADMIN', 'MEMBER'] as Role[]);

  const [tab, setTab] = useState<Tab>('active');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inviteOpen, setInviteOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<RemoveTarget[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const toastError = (e: unknown) => {
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
      (e as Error)?.message ??
      'Something went wrong';
    showToast(msg);
  };

  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const pendingInvites = useMemo(
    () => (invitesQuery.data ?? []).filter((i) => i.status === 'PENDING'),
    [invitesQuery.data],
  );

  const counts = { active: users.length, pending: pendingInvites.length };
  const adminCount = users.filter((u) => u.role === 'ADMIN' || u.role === 'OWNER').length;

  // selection resets when switching tabs
  useEffect(() => {
    setSelected(new Set());
  }, [tab]);

  const q = query.trim().toLowerCase();
  const matchesQuery = (name: string | null, email: string) =>
    !q || (name ?? '').toLowerCase().includes(q) || email.toLowerCase().includes(q);

  const activeRows: OrgUser[] = users
    .filter((u) => roleFilter === 'all' || u.role === roleFilter)
    .filter((u) => matchesQuery(u.name, u.email));

  const pendingRows: Invite[] = pendingInvites
    .filter((i) => roleFilter === 'all' || i.role === roleFilter)
    .filter((i) => matchesQuery(null, i.email));

  const rowCount = tab === 'active' ? activeRows.length : pendingRows.length;
  const filtering = !!q || roleFilter !== 'all';

  // selection only applies on the active tab
  const visibleIds = activeRows.map((r) => r.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id)) && !allSelected;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleIds));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // ── mutation helpers ──
  const canActOn = (u: OrgUser) => u.id !== user?.id && (u.role !== 'OWNER' || isOwner);

  async function changeRole(id: string, role: Role) {
    try {
      await m.changeRole.mutateAsync({ id, role });
      showToast(`Role updated to ${ROLE_META[role].label}`);
    } catch (e) {
      toastError(e);
    }
  }

  async function bulkChangeRole(role: Role) {
    const ids = [...selected].filter((id) => {
      const u = users.find((x) => x.id === id);
      return u && canActOn(u);
    });
    let ok = 0;
    for (const id of ids) {
      try {
        await m.changeRole.mutateAsync({ id, role });
        ok++;
      } catch (e) {
        toastError(e);
      }
    }
    if (ok > 0) showToast(ok > 1 ? `Updated role for ${ok} members` : `Role updated to ${ROLE_META[role].label}`);
    setSelected(new Set());
  }

  async function doRemove() {
    if (!confirm) return;
    let ok = 0;
    const wasPending = confirm.every((t) => t.pending);
    for (const t of confirm) {
      try {
        if (t.pending) await m.revoke.mutateAsync(t.id);
        else await m.remove.mutateAsync(t.id);
        ok++;
      } catch (e) {
        toastError(e);
      }
    }
    if (ok > 0) {
      if (wasPending) showToast(ok > 1 ? `${ok} invitations revoked` : 'Invitation revoked');
      else showToast(ok > 1 ? `Removed ${ok} members` : 'Member removed');
    }
    setSelected(new Set());
    setDetailId(null);
    setConfirm(null);
  }

  async function doResend(id: string) {
    try {
      await m.resend.mutateAsync(id);
      showToast('Invitation resent');
    } catch (e) {
      toastError(e);
    }
  }

  async function sendInvites(invites: InvitePayload[]) {
    let ok = 0;
    for (const inv of invites) {
      try {
        await m.invite.mutateAsync({ email: inv.email, role: inv.role });
        ok++;
      } catch (e) {
        toastError(e);
      }
    }
    setInviteOpen(false);
    if (ok > 0) {
      setTab('pending');
      showToast(`${ok} invitation${ok > 1 ? 's' : ''} sent`);
    }
  }

  // Emails already used (members + pending) for invite validation.
  const existingEmails = [...users.map((u) => u.email), ...pendingInvites.map((i) => i.email)];

  // Build the active detail member for the drawer.
  const detailMember: DrawerMember | null = (() => {
    if (!detailId) return null;
    const u = users.find((x) => x.id === detailId);
    if (u)
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        pending: false,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      };
    const inv = pendingInvites.find((x) => x.id === detailId);
    if (inv)
      return { id: inv.id, email: inv.email, name: null, role: inv.role, pending: true, createdAt: inv.createdAt };
    return null;
  })();

  const loading = tab === 'active' ? usersQuery.isLoading : invitesQuery.isLoading;
  const isError = tab === 'active' ? usersQuery.isError : invitesQuery.isError;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        title="Team"
        description="Manage who has access to this workspace and what they can do."
        actions={
          <Button variant="accent" icon={<UserPlus size={14} />} onClick={() => setInviteOpen(true)}>
            Invite member
          </Button>
        }
      />

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Tabs
          variant="segmented"
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          items={[
            { value: 'active', label: 'Active', count: counts.active },
            { value: 'pending', label: 'Pending', count: counts.pending },
          ]}
        />
        <div style={{ flex: 1 }} />
        <div style={{ width: 240, display: 'flex' }}>
          <Input
            icon={<Search size={14} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email…"
          />
        </div>
        <Select
          size="md"
          icon={<Shield size={13} />}
          value={roleFilter}
          onChange={(v) => setRoleFilter(v as 'all' | Role)}
          options={[{ value: 'all', label: 'All roles' }, ...ALL_ROLES.map((r) => ({ value: r, label: ROLE_META[r].label }))]}
        />
      </div>

      <Card padding={0} style={{ overflow: 'visible', position: 'relative' }}>
        {/* Bulk action bar (active tab only) */}
        {tab === 'active' && selected.size > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--accent-soft)',
              borderTopLeftRadius: 10,
              borderTopRightRadius: 10,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent-strong)' }}>{selected.size} selected</span>
            <div style={{ height: 16, width: 1, background: 'var(--border-strong)' }} />
            <BulkRoleButton roles={assignableRoles} onPick={(r) => void bulkChangeRole(r)} />
            <Button
              size="sm"
              variant="default"
              icon={<Trash2 size={13} />}
              onClick={() =>
                setConfirm(
                  [...selected]
                    .map((id) => users.find((u) => u.id === id))
                    .filter((u): u is OrgUser => !!u && canActOn(u))
                    .map((u) => ({ id: u.id, label: u.name?.trim() || emailLabel(u.email), pending: false })),
                )
              }
              style={{ color: 'var(--red)', borderColor: 'var(--border)' }}
            >
              Remove
            </Button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: 'var(--text-muted)',
                background: 'none',
                border: 0,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={40} radius="8px" />
            ))}
          </div>
        ) : isError ? (
          <p style={{ fontSize: 13, color: 'var(--red)', padding: 16 }}>
            Could not load {tab === 'active' ? 'members' : 'invitations'}.
          </p>
        ) : rowCount === 0 ? (
          <EmptyState
            icon={tab === 'pending' ? <Send size={20} /> : <Users size={20} />}
            title={filtering ? 'No matches' : tab === 'pending' ? 'No pending invitations' : 'No members'}
            body={
              filtering
                ? 'Try adjusting your search or role filter.'
                : tab === 'pending'
                  ? 'Invitations you send will appear here until accepted.'
                  : 'Invite teammates to collaborate.'
            }
            action={
              tab === 'pending' && !filtering ? (
                <Button variant="accent" size="sm" icon={<UserPlus size={13} />} onClick={() => setInviteOpen(true)}>
                  Invite member
                </Button>
              ) : null
            }
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr
                style={{
                  background: 'var(--surface-alt)',
                  fontSize: 10.5,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontWeight: 600,
                }}
              >
                {tab === 'active' && (
                  <th style={{ width: 44, padding: '10px 0 10px 16px', textAlign: 'left' }}>
                    <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} label="Select all members" />
                  </th>
                )}
                <th style={TH}>Member</th>
                <th style={{ ...TH, width: 150 }}>Role</th>
                {tab === 'active' ? (
                  <>
                    <th style={{ ...TH, width: 130 }}>Last active</th>
                    <th style={{ ...TH, width: 90 }}>2FA</th>
                    <th style={{ ...TH, width: 130 }}>Joined</th>
                  </>
                ) : (
                  <>
                    <th style={{ ...TH, width: 130 }}>Sent</th>
                    <th style={{ ...TH, width: 90 }}>Status</th>
                  </>
                )}
                <th style={{ width: 56, padding: '10px 16px 10px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {tab === 'active'
                ? activeRows.map((u) => {
                    const isSel = selected.has(u.id);
                    const isSelf = u.id === user?.id;
                    const actable = canActOn(u);
                    const activeNow = u.lastLoginAt != null && Date.now() - new Date(u.lastLoginAt).getTime() < FIVE_MIN;
                    const roleLocked = (isSelf && u.role === 'OWNER') || !actable;
                    return (
                      <tr
                        key={u.id}
                        onClick={() => setDetailId(u.id)}
                        style={{
                          borderTop: '1px solid var(--border-soft)',
                          background: isSel ? 'var(--accent-soft)' : 'transparent',
                          cursor: 'pointer',
                          transition: 'background 80ms',
                        }}
                        onMouseEnter={(e) => {
                          if (!isSel) e.currentTarget.style.background = 'var(--hover)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isSel) e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <td style={{ padding: '12px 0 12px 16px' }} onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={isSel} onChange={() => toggleOne(u.id)} label={`Select ${u.name}`} />
                        </td>
                        <td style={{ padding: '11px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                            <Avatar user={avatarFor(u.name, u.email)} size={32} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                                  {u.name?.trim() || emailLabel(u.email)}
                                </span>
                                {isSelf && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 600,
                                      color: 'var(--text-muted)',
                                      background: 'var(--muted-bg)',
                                      padding: '1px 6px',
                                      borderRadius: 5,
                                    }}
                                  >
                                    You
                                  </span>
                                )}
                                {u.status === 'DISABLED' && (
                                  <Pill tone="gray" size="xs">
                                    Disabled
                                  </Pill>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '11px 6px' }}>
                          <RoleSelect
                            value={u.role}
                            roles={assignableRoles}
                            disabled={roleLocked || m.changeRole.isPending}
                            onChange={(r) => void changeRole(u.id, r)}
                          />
                        </td>
                        <td style={{ padding: '11px 12px', color: 'var(--text-muted)' }}>
                          {activeNow ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: 'var(--green)',
                                fontWeight: 600,
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--green)' }} />
                              Active now
                            </span>
                          ) : u.lastLoginAt ? (
                            fmt.relative(u.lastLoginAt)
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '11px 12px' }}>
                          <span title="Two-factor — coming soon" style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                            —
                          </span>
                        </td>
                        <td style={{ padding: '11px 12px', color: 'var(--text-muted)' }}>{fmt.date(u.createdAt)}</td>
                        <td style={{ padding: '11px 16px 11px 12px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <RowMenu
                            tab="active"
                            isSelf={isSelf}
                            canRemove={actable}
                            onView={() => setDetailId(u.id)}
                            onResend={() => undefined}
                            onRemove={() =>
                              setConfirm([{ id: u.id, label: u.name?.trim() || emailLabel(u.email), pending: false }])
                            }
                          />
                        </td>
                      </tr>
                    );
                  })
                : pendingRows.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => setDetailId(inv.id)}
                      style={{
                        borderTop: '1px solid var(--border-soft)',
                        cursor: 'pointer',
                        transition: 'background 80ms',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <td style={{ padding: '11px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                          <Avatar user={avatarFor(null, inv.email)} size={32} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{emailLabel(inv.email)}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inv.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '11px 12px' }}>
                        <Pill tone={ROLE_META[inv.role].tone} size="sm">
                          {ROLE_META[inv.role].label}
                        </Pill>
                      </td>
                      <td style={{ padding: '11px 12px', color: 'var(--text-muted)' }}>{fmt.relative(inv.createdAt)}</td>
                      <td style={{ padding: '11px 12px' }}>
                        <Pill tone="amber" size="xs" icon={<Clock size={10} />}>
                          Pending
                        </Pill>
                      </td>
                      <td style={{ padding: '11px 16px 11px 12px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <RowMenu
                          tab="pending"
                          isSelf={false}
                          canRemove
                          onView={() => setDetailId(inv.id)}
                          onResend={() => void doResend(inv.id)}
                          onRemove={() => setConfirm([{ id: inv.id, label: emailLabel(inv.email), pending: true }])}
                        />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
      </Card>

      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 2px' }}>
        {counts.active} active {counts.active === 1 ? 'member' : 'members'} · {counts.pending} pending{' '}
        {counts.pending === 1 ? 'invite' : 'invites'} · {adminCount} {adminCount === 1 ? 'admin' : 'admins'}
      </p>

      {inviteOpen && (
        <InviteMembersModal
          onClose={() => setInviteOpen(false)}
          onSend={(invs) => void sendInvites(invs)}
          existing={existingEmails}
          sending={m.invite.isPending}
        />
      )}

      {detailMember && (
        <MemberDrawer
          member={detailMember}
          isSelf={detailMember.id === user?.id}
          canRemove={
            detailMember.pending
              ? true
              : (() => {
                  const u = users.find((x) => x.id === detailMember.id);
                  return !!u && canActOn(u);
                })()
          }
          roleOptions={assignableRoles}
          changingRole={m.changeRole.isPending}
          onClose={() => setDetailId(null)}
          onRole={(r) => void changeRole(detailMember.id, r)}
          onResend={() => void doResend(detailMember.id)}
          onRemove={() =>
            setConfirm([
              {
                id: detailMember.id,
                label: detailMember.name?.trim() || emailLabel(detailMember.email),
                pending: detailMember.pending,
              },
            ])
          }
        />
      )}

      {confirm && (
        <ConfirmRemove
          targets={confirm}
          loading={m.remove.isPending || m.revoke.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void doRemove()}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 90,
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '10px 16px',
            background: 'var(--text)',
            color: 'var(--surface)',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 8px 28px rgba(15,23,42,0.28)',
          }}
        >
          <CircleCheck size={15} /> {toast}
        </div>
      )}
    </div>
  );
}
