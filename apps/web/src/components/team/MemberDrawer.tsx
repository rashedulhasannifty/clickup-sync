import type { ReactNode } from 'react';
import { useState } from 'react';
import { Clock, Send, Trash2, ShieldCheck, X } from 'lucide-react';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';
import { Pill } from '../ui/Pill';
import { Callout } from '../ui/Callout';
import { Switch } from '../ui/Switch';
import { RoleSelect, ROLE_META } from './RoleSelect';
import { TeamAssignmentRows, type TeamAssignment } from '../teams/TeamAssignmentRows';
import { useTeams, useTeamMutations } from '../../hooks/useTeams';
import { fmt } from '../../lib/formatters';
import type { Role } from '../../api/auth';
import type { UserTeamRef } from '../../api/users';

export interface DrawerMember {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  pending: boolean;
  /** Active members only. */
  lastLoginAt?: string | null;
  createdAt: string;
  /** Active members only — omitted (or empty) for pending invites, whose team
   *  assignments are fixed until accept and aren't editable here. */
  teams?: UserTeamRef[];
}

/** Diffs the rows widget's full next list against what's on the server and
 *  fires exactly the mutations needed — one per added/removed/role-changed
 *  team, regardless of which single edit produced the new list.
 *
 *  `local` seeds from `member.teams` once and is then the source of truth for
 *  the rest of this drawer's lifetime — the caller keys `<MemberDrawer>` on
 *  `member.id` (see TeamPage.tsx) so opening a different member's drawer
 *  remounts this hook with a fresh initializer instead of needing an effect
 *  to resync it. */
function useTeamsSection(member: DrawerMember, onToast: (msg: string) => void) {
  const teamsQuery = useTeams();
  const mutations = useTeamMutations();
  const teamOptions = (teamsQuery.data ?? []).map((t) => ({ id: t.id, name: t.name }));

  const [local, setLocal] = useState<TeamAssignment[]>(() => (member.teams ?? []).map((t) => ({ teamId: t.id, role: t.role })));

  function apply(next: TeamAssignment[]) {
    const prevMap = new Map(local.map((t) => [t.teamId, t.role]));
    const nextMap = new Map(next.map((t) => [t.teamId, t.role]));
    setLocal(next);
    for (const [teamId] of prevMap) {
      if (!nextMap.has(teamId)) {
        mutations.removeMember.mutate(
          { id: teamId, userId: member.id },
          { onError: () => onToast('Could not remove from that team') },
        );
      }
    }
    for (const [teamId, role] of nextMap) {
      if (!prevMap.has(teamId)) {
        mutations.addMember.mutate(
          { id: teamId, userId: member.id, role },
          { onError: () => onToast('Could not add to that team') },
        );
      } else if (prevMap.get(teamId) !== role) {
        mutations.setRole.mutate(
          { id: teamId, userId: member.id, role },
          { onError: () => onToast('Could not update that team role') },
        );
      }
    }
  }

  return { teamOptions, local, apply };
}

function DrawerRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '11px 0',
        borderBottom: '1px solid var(--border-soft)',
      }}
    >
      <span style={{ width: 116, flexShrink: 0, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

function ComingSoon() {
  return (
    <Pill tone="gray" size="xs">
      Coming soon
    </Pill>
  );
}

/** Static, non-functional placeholder spaces for the design's "Space access" section. */
const PLACEHOLDER_SPACES = ['Digital Marketing', 'R&D Apps', 'Projects'];
const SPACE_COLORS = ['#7B68EE', '#49CCF9', '#10b981'];

export function MemberDrawer({
  member,
  isSelf,
  canRemove,
  roleOptions,
  onClose,
  onRole,
  onRemove,
  onResend,
  changingRole,
  onTeamsError,
}: {
  member: DrawerMember;
  isSelf: boolean;
  /** false for OWNER rows the viewer can't touch, or your own row. */
  canRemove: boolean;
  roleOptions: Role[];
  onClose: () => void;
  onRole: (role: Role) => void;
  onRemove: () => void;
  onResend: () => void;
  changingRole?: boolean;
  /** Surfaces a failed team add/remove/role change (e.g. as a toast). */
  onTeamsError?: (msg: string) => void;
}) {
  const { pending } = member;
  const teamsSection = useTeamsSection(member, onTeamsError ?? (() => undefined));
  const trimmedName = member.name?.trim();
  const displayName = trimmedName || member.email.split('@')[0];
  const avatarUser = trimmedName
    ? {
        name: trimmedName,
        initials: trimmedName
          .split(/\s+/)
          .map((p) => p[0])
          .join('')
          .toUpperCase()
          .slice(0, 2),
      }
    : { name: member.email, initials: member.email.slice(0, 2).toUpperCase() };
  // Mirror the table row: an OWNER row an admin can't act on (or your own
  // OWNER row) keeps the role control locked. Pending invites have no editable role.
  const roleDisabled = (isSelf && member.role === 'OWNER') || pending || changingRole || (!pending && !canRemove);

  return (
    <Drawer open onClose={onClose} width={460}>
      {/* Header */}
      <div
        style={{
          padding: '18px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          flexShrink: 0,
        }}
      >
        <Avatar user={avatarUser} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{displayName}</span>
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
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 1 }}>{member.email}</div>
          <div style={{ marginTop: 9 }}>
            {pending ? (
              <Pill tone="amber" size="sm" icon={<Clock size={11} />}>
                Invitation pending
              </Pill>
            ) : (
              <Pill
                tone="green"
                size="sm"
                icon={<span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--green)' }} />}
              >
                Active
              </Pill>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn-3d"
          onClick={onClose}
          aria-label="Close"
          style={{
            border: 0,
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 5,
            borderRadius: 6,
            display: 'flex',
            flexShrink: 0,
            ['--b-edge' as string]: 'var(--border-strong)',
            ['--b-glow' as string]: 'var(--btn-neutral-glow)',
            ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
          }}
        >
          <X size={17} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 20px' }}>
        {pending && (
          <div style={{ margin: '12px 0 4px' }}>
            <Callout tone="amber" icon={<Send size={13} />}>
              Invitation sent {fmt.relative(member.createdAt)}. The invite expires 7 days after sending.
            </Callout>
          </div>
        )}

        {/* Role & access */}
        <div style={{ paddingTop: 14 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 8,
            }}
          >
            Role &amp; access
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <RoleSelect variant="select" value={member.role} roles={roleOptions} width={300} disabled={roleDisabled} onChange={onRole} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{ROLE_META[member.role].desc}</span>
          </div>
        </div>

        {/* Teams — active members only; a pending invite's team assignments are
            fixed until accept (InvitationTeam), not editable here. */}
        {!pending && (
          <div style={{ paddingTop: 18 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 8,
              }}
            >
              Teams
            </div>
            {teamsSection.teamOptions.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No teams exist yet.</span>
            ) : (
              <TeamAssignmentRows teams={teamsSection.teamOptions} value={teamsSection.local} onChange={teamsSection.apply} />
            )}
          </div>
        )}

        {/* Space access — coming soon placeholder */}
        <div style={{ paddingTop: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Space access
            </span>
            <ComingSoon />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: 0.6, pointerEvents: 'none' }}>
            {PLACEHOLDER_SPACES.map((name, i) => (
              <div
                key={name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '9px 10px',
                  borderRadius: 8,
                  background: 'var(--muted-bg)',
                  marginBottom: 4,
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: 3, background: SPACE_COLORS[i], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Per-space access not yet available</div>
                </div>
                <Switch checked disabled onChange={() => undefined} />
              </div>
            ))}
          </div>
        </div>

        {/* Details */}
        {!pending && (
          <div style={{ paddingTop: 18 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 4,
              }}
            >
              Security &amp; activity
            </div>
            <DrawerRow label="Two-factor">
              <span title="Two-factor — coming soon" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Pill tone="gray" size="sm" icon={<ShieldCheck size={11} />}>
                  —
                </Pill>
                <ComingSoon />
              </span>
            </DrawerRow>
            <DrawerRow label="Last active">
              {member.lastLoginAt ? fmt.relative(member.lastLoginAt) : '—'}
            </DrawerRow>
            <DrawerRow label="Joined">{fmt.date(member.createdAt)}</DrawerRow>
            <DrawerRow label="Member ID">
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--text-muted)' }}>{member.id}</span>
            </DrawerRow>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div
        style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {pending && (
          <Button variant="caution" icon={<Send size={13} />} onClick={onResend}>
            Resend
          </Button>
        )}
        <div style={{ flex: 1 }} />
        {isSelf ? (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>You can't remove yourself</span>
        ) : canRemove ? (
          <Button variant="danger" icon={<Trash2 size={13} />} onClick={onRemove}>
            {pending ? 'Revoke' : 'Remove'}
          </Button>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Only an owner can remove this member</span>
        )}
      </div>
    </Drawer>
  );
}
