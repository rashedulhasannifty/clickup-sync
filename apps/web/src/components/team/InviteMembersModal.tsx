import { useMemo, useState } from 'react';
import { Mail, X, Plus, Info, Send, CircleCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Select } from '../ui/Select';
import { RoleSelect } from './RoleSelect';
import { TeamAssignmentRows, type TeamAssignment } from '../teams/TeamAssignmentRows';
import { useTeams } from '../../hooks/useTeams';
import { useClickupMembers } from '../../hooks/useClickupMembers';
import type { Role } from '../../api/auth';
import type { InvitePayload } from '../../api/users';

export type { InvitePayload };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DONT_LINK = '__none__';

interface InviteRow {
  email: string;
  role: Role;
  teams: TeamAssignment[];
  /** undefined = untouched (server auto-matches by email); null = explicit "don't link". */
  clickupUserId: string | null | undefined;
  /** Prefilled from the ClickUp members tab: the address came from ClickUp, so
   *  it is shown read-only rather than retyped (and mistyped). */
  locked?: boolean;
}

/** One row prefilled by a caller — the "Invite" action on the ClickUp tab. */
export interface InvitePrefill {
  email: string;
  clickupUserId?: string | null;
  name?: string | null;
}

/** Roles assignable on invite — no OWNER (ownership transfer is a separate flow). */
const INVITE_ROLES: Role[] = ['ADMIN', 'MEMBER'];

export function InviteMembersModal({
  onClose,
  onSend,
  existing = [],
  sending = false,
  prefill,
}: {
  onClose: () => void;
  onSend: (invites: InvitePayload[]) => void;
  /** Already-member or already-invited emails (lowercased comparison). */
  existing?: string[];
  sending?: boolean;
  /** Rows to open with, instead of one blank row. */
  prefill?: InvitePrefill[];
}) {
  const [rows, setRows] = useState<InviteRow[]>(
    prefill?.length
      ? prefill.map((p) => ({ email: p.email, role: 'MEMBER' as Role, teams: [], clickupUserId: p.clickupUserId, locked: true }))
      : [{ email: '', role: 'MEMBER', teams: [], clickupUserId: undefined }],
  );
  const [touched, setTouched] = useState(false);
  const existLower = existing.map((e) => e.toLowerCase());
  const teamsQuery = useTeams();
  const teamOptions = useMemo(() => (teamsQuery.data ?? []).map((t) => ({ id: t.id, name: t.name })), [teamsQuery.data]);
  const { members: clickupMembers, byEmail } = useClickupMembers();

  const setRow = (i: number, patch: Partial<InviteRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { email: '', role: 'MEMBER', teams: [], clickupUserId: undefined }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const errorFor = (r: InviteRow, i: number): string | null => {
    const e = r.email.trim().toLowerCase();
    if (!e) return 'empty';
    if (!EMAIL_RE.test(e)) return 'Enter a valid email address';
    if (existLower.includes(e)) return 'Already a member or invited';
    if (rows.findIndex((x) => x.email.trim().toLowerCase() === e) !== i) return 'Duplicate email';
    return null;
  };

  const filled = rows.filter((r) => r.email.trim());
  const allValid =
    filled.length > 0 &&
    filled.every((r) => {
      const i = rows.indexOf(r);
      return !errorFor(r, i);
    });

  const send = () => {
    setTouched(true);
    if (!allValid) return;
    onSend(
      filled.map((r) => ({
        email: r.email.trim(),
        role: r.role,
        teams: r.teams,
        clickupUserId: r.clickupUserId,
      })),
    );
  };

  return (
    <Modal
      onClose={onClose}
      width={620}
      title="Invite members"
      subtitle="They'll get an email invitation to join this workspace."
      onSubmit={send}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {filled.length > 0
              ? `${filled.length} ${filled.length === 1 ? 'person' : 'people'} to invite`
              : 'Add at least one email'}
          </span>
          <div style={{ flex: 1 }} />
          <Button type="button" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="success" icon={<Send size={13} />} disabled={!allValid} loading={sending}>
            Send {filled.length > 1 ? `${filled.length} invitations` : 'invitation'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((r, i) => {
          const err = touched && r.email.trim() ? errorFor(r, i) : null;
          const emailKey = r.email.trim().toLowerCase();
          const autoMatch = emailKey ? byEmail.get(emailKey) : undefined;
          const effectiveClickupId = r.clickupUserId === undefined ? (autoMatch?.id ?? DONT_LINK) : (r.clickupUserId ?? DONT_LINK);
          const showAutoHint = r.clickupUserId === undefined && !!autoMatch;
          const noTeamWarning = r.role === 'MEMBER' && r.teams.length === 0;

          return (
            <div
              key={i}
              style={{
                display: 'flex', flexDirection: 'column', gap: 10, padding: rows.length > 1 ? 12 : 0,
                border: rows.length > 1 ? '1px solid var(--border-soft)' : undefined,
                borderRadius: rows.length > 1 ? 10 : undefined,
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 11,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-faint)',
                      display: 'flex',
                      pointerEvents: 'none',
                    }}
                  >
                    <Mail size={14} />
                  </span>
                  <input
                    type="email"
                    value={r.email}
                    autoFocus={i === 0 && !r.locked}
                    readOnly={r.locked}
                    aria-label={`Email address ${i + 1}`}
                    aria-invalid={err && err !== 'empty' ? true : undefined}
                    onChange={(e) => setRow(i, { email: e.target.value })}
                    placeholder="name@company.com"
                    className="input-3d"
                    style={{
                      width: '100%',
                      height: 40,
                      padding: '0 12px 0 34px',
                      fontSize: 13.5,
                      background: r.locked ? 'var(--surface-2, var(--surface))' : 'var(--surface)',
                      color: 'var(--text)',
                      border: `1px solid ${err && err !== 'empty' ? 'var(--red)' : 'var(--border-strong)'}`,
                      borderRadius: 9,
                      outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
                <div style={{ width: 138 }}>
                  <RoleSelect variant="select" value={r.role} roles={INVITE_ROLES} width={240} onChange={(role) => setRow(i, { role })} />
                </div>
                <button
                  type="button"
                  aria-label={`Remove email ${i + 1}`}
                  className="btn-3d"
                  onClick={() => removeRow(i)}
                  disabled={rows.length === 1}
                  style={{
                    width: 28,
                    height: 28,
                    flexShrink: 0,
                    border: 0,
                    background: 'transparent',
                    color: rows.length === 1 ? 'var(--border-strong)' : 'var(--text-faint)',
                    borderRadius: 9,
                    cursor: rows.length === 1 ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    ['--b-edge' as string]: 'transparent',
                    ['--b-glow' as string]: 'transparent',
                    ['--b-glow-strong' as string]: 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (rows.length > 1) e.currentTarget.style.background = 'var(--hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <X size={15} />
                </button>
              </div>
              {err && err !== 'empty' && (
                <span style={{ fontSize: 11.5, color: 'var(--red)', paddingLeft: 2 }}>{err}</span>
              )}

              {/* Teams */}
              <div>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Teams
                </span>
                <TeamAssignmentRows teams={teamOptions} value={r.teams} onChange={(teams) => setRow(i, { teams })} />
                {noTeamWarning && (
                  <div style={{ marginTop: 8 }}>
                    <Callout tone="amber" icon={<Info size={13} />}>
                      This user will see no data until they&apos;re added to a team.
                    </Callout>
                  </div>
                )}
              </div>

              {/* ClickUp user */}
              <div>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  ClickUp user
                </span>
                <Select
                  fullWidth
                  searchable
                  value={effectiveClickupId}
                  onChange={(v) => setRow(i, { clickupUserId: v === DONT_LINK ? null : v })}
                  ariaLabel={`ClickUp user for ${r.email || `invite ${i + 1}`}`}
                  options={[
                    { value: DONT_LINK, label: "Don't link" },
                    ...clickupMembers.map((m) => ({ value: m.id, label: m.name?.trim() || m.email || m.id })),
                  ]}
                />
                {showAutoHint && (
                  <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--pill-green-text)' }}>
                    <CircleCheck size={12} /> Auto-matched by email
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div>
          <button
            type="button"
            className="btn-3d"
            onClick={addRow}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 4px',
              background: 'none',
              border: 0,
              color: 'var(--accent-strong)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              ['--b-edge' as string]: 'transparent',
              ['--b-glow' as string]: 'transparent',
              ['--b-glow-strong' as string]: 'transparent',
            }}
          >
            <Plus size={14} /> Add another
          </button>
        </div>

        <Callout tone="blue" icon={<Info size={13} />}>
          Roles set permissions inside Clicksy — <strong>Admins</strong> manage members &amp; settings,{' '}
          <strong>Members</strong> have read-only access to dashboards and reports.
        </Callout>
      </div>
    </Modal>
  );
}
