import { useMemo, useState } from 'react';
import { RefreshCw, UserPlus, Users, Check, Clock, MailX } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { Avatar } from '../ui/Avatar';
import { Checkbox } from '../ui/Checkbox';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { Switch } from '../ui/Switch';
import { fmt } from '../../lib/formatters';
import type { ClickupDirectoryMember } from '../../api/users';
import { ROLE_META } from './RoleSelect';

const TH: React.CSSProperties = { textAlign: 'left', padding: '10px 12px' };

const CLICKUP_ROLE_LABEL: Record<NonNullable<ClickupDirectoryMember['role']>, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

function memberLabel(m: ClickupDirectoryMember) {
  return m.name?.trim() || m.email || `ClickUp user ${m.id}`;
}

/** What this person is, as far as this app is concerned. */
function StatusCell({ member }: { member: ClickupDirectoryMember }) {
  if (member.linkStatus === 'member') {
    const role = member.appUser?.role;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* "Has account", not "Member": the role pill beside it can also read
            "Member", and two pills saying the same word means two things. */}
        <Pill tone="green" size="xs" icon={<Check size={10} />}>
          Has account
        </Pill>
        {role && (
          <Pill tone={ROLE_META[role].tone} size="xs">
            {ROLE_META[role].label}
          </Pill>
        )}
        {member.appUser?.status === 'DISABLED' && (
          <Pill tone="gray" size="xs">
            Disabled
          </Pill>
        )}
      </span>
    );
  }
  if (member.linkStatus === 'invited') {
    return (
      <Pill tone="amber" size="xs" icon={<Clock size={10} />}>
        Invited
      </Pill>
    );
  }
  if (!member.email) {
    return (
      <Pill tone="gray" size="xs" icon={<MailX size={10} />}>
        No email
      </Pill>
    );
  }
  return <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Not invited</span>;
}

/**
 * The ClickUp tab of the Users page: everyone in the ClickUp workspace, with
 * the detail ClickUp holds about them, and an invite affordance for the ones
 * who have no account here yet. Rows are annotated server-side — see
 * `GET /users/clickup-members`.
 */
export function ClickupMembersTable({
  members,
  query,
  loading,
  isError,
  refreshing,
  onRefresh,
  onInvite,
}: {
  members: ClickupDirectoryMember[];
  /** Shared with the page toolbar's search box. */
  query: string;
  loading: boolean;
  isError: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onInvite: (members: ClickupDirectoryMember[]) => void;
}) {
  const [uninvitedOnly, setUninvitedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      members
        .filter((m) => !uninvitedOnly || m.canInvite)
        .filter(
          (m) => !q || (m.name ?? '').toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q),
        ),
    [members, uninvitedOnly, q],
  );

  // Only invitable rows are selectable — there is nothing to do with the rest.
  const selectableIds = rows.filter((m) => m.canInvite).map((m) => m.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id)) && !allSelected;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const inviteSelected = () => {
    const picked = members.filter((m) => selected.has(m.id) && m.canInvite);
    if (picked.length) onInvite(picked);
    setSelected(new Set());
  };

  const invitable = members.filter((m) => m.canInvite).length;

  return (
    <Card padding={0} style={{ overflow: 'visible', position: 'relative' }}>
      {/* Tab toolbar: scope toggle + cache refresh */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Switch checked={uninvitedOnly} onChange={setUninvitedOnly} ariaLabel="Show only members not yet invited" />
          Not yet invited{invitable ? ` (${invitable})` : ''}
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Cached for ~10 min</span>
        <Button size="sm" icon={<RefreshCw size={13} />} loading={refreshing} onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {selected.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--accent-soft)',
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent-strong)' }}>
            {selected.size} selected
          </span>
          <Button size="sm" variant="accent" icon={<UserPlus size={13} />} onClick={inviteSelected}>
            Invite selected
          </Button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-muted)', background: 'none', border: 0, cursor: 'pointer' }}
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
          Could not load the ClickUp workspace directory. Check the ClickUp connection in Settings.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users size={20} />}
          title={q || uninvitedOnly ? 'No matches' : 'No ClickUp members'}
          body={
            uninvitedOnly && !q
              ? 'Everyone in the ClickUp workspace already has an account or a pending invitation.'
              : q
                ? 'Try adjusting your search.'
                : 'This ClickUp workspace has no members, or the API token cannot see them.'
          }
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
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
                <th style={{ width: 44, padding: '10px 0 10px 16px', textAlign: 'left' }}>
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleAll}
                    label="Select all invitable members"
                  />
                </th>
                <th style={TH}>ClickUp member</th>
                <th style={{ ...TH, width: 110 }}>ClickUp role</th>
                <th style={{ ...TH, width: 190 }}>Status here</th>
                <th style={{ ...TH, width: 120 }}>Last active</th>
                <th style={{ ...TH, width: 120 }}>Joined</th>
                <th style={{ ...TH, width: 140 }}>Invited by</th>
                <th style={{ width: 104, padding: '10px 16px 10px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const isSel = selected.has(m.id);
                return (
                  <tr
                    key={m.id}
                    className="row-3d"
                    style={{
                      borderTop: '1px solid var(--border-soft)',
                      background: isSel ? 'var(--accent-soft)' : 'transparent',
                      transition: 'background 80ms',
                    }}
                  >
                    <td style={{ padding: '12px 0 12px 16px' }}>
                      {m.canInvite ? (
                        <Checkbox checked={isSel} onChange={() => toggleOne(m.id)} label={`Select ${memberLabel(m)}`} />
                      ) : null}
                    </td>
                    <td style={{ padding: '11px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                        <Avatar
                          user={{
                            name: memberLabel(m),
                            color: m.color ?? undefined,
                            initials: m.initials ?? undefined,
                            image: m.profilePicture,
                          }}
                          size={32}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{memberLabel(m)}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {m.email ?? <span style={{ color: 'var(--text-faint)' }}>No email in ClickUp</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '11px 12px', color: 'var(--text-muted)' }}>
                      {m.role ? CLICKUP_ROLE_LABEL[m.role] : '—'}
                    </td>
                    <td style={{ padding: '11px 12px' }}>
                      <StatusCell member={m} />
                    </td>
                    <td style={{ padding: '11px 12px', color: 'var(--text-muted)' }}>
                      {m.lastActive ? fmt.relative(m.lastActive) : '—'}
                    </td>
                    <td style={{ padding: '11px 12px', color: 'var(--text-muted)' }}>
                      {m.dateJoined ? fmt.date(m.dateJoined) : '—'}
                    </td>
                    <td style={{ padding: '11px 12px', color: 'var(--text-muted)' }}>{m.invitedByName ?? '—'}</td>
                    <td style={{ padding: '11px 16px 11px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {m.canInvite ? (
                        <Button size="sm" variant="accent" icon={<UserPlus size={13} />} onClick={() => onInvite([m])}>
                          Invite
                        </Button>
                      ) : (
                        <span
                          style={{ fontSize: 12, color: 'var(--text-faint)' }}
                          title={
                            m.linkStatus === 'none'
                              ? 'ClickUp has no email address for this member, so there is nowhere to send an invitation.'
                              : undefined
                          }
                        >
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
