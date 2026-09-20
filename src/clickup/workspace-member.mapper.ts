/** A ClickUp workspace member, with every detail the `GET /team/{team_id}`
 *  payload carries. The lean `MemberDto` (id/name/email/avatar) is a projection
 *  of this — see `WorkspaceMembersService`. */
export interface WorkspaceMemberDto {
  id: string;
  name: string | null;
  email: string | null;
  profilePicture: string | null;
  color: string | null;
  initials: string | null;
  /** ClickUp's own workspace role, not this app's `Role`. */
  role: ClickupRole | null;
  lastActive: string | null;
  dateJoined: string | null;
  dateInvited: string | null;
  invitedByName: string | null;
}

export type ClickupRole = 'owner' | 'admin' | 'member' | 'guest';

const ROLES: Record<number, ClickupRole> = { 1: 'owner', 2: 'admin', 3: 'member', 4: 'guest' };

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** ClickUp sends epochs as millisecond *strings* ("1741737600000"), sometimes as
 *  numbers, and uses 0 as a "never" sentinel — never as the Unix epoch. */
function isoFromEpoch(v: unknown): string | null {
  const ms = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Normalizes one raw ClickUp member. Returns null when the payload carries no
 *  usable user id — that row is unjoinable to anything and is dropped. */
export function mapWorkspaceMember(raw: unknown): WorkspaceMemberDto | null {
  const member = (raw ?? {}) as { user?: Record<string, unknown>; invited_by?: Record<string, unknown> | null };
  const user = member.user ?? {};
  const rawId = user.id;
  if (typeof rawId !== 'string' && typeof rawId !== 'number') return null;
  const id = String(rawId);
  if (id === '') return null;

  return {
    id,
    name: str(user.username),
    email: str(user.email),
    profilePicture: str(user.profilePicture),
    color: str(user.color),
    initials: str(user.initials),
    role: typeof user.role === 'number' ? (ROLES[user.role] ?? null) : null,
    lastActive: isoFromEpoch(user.last_active),
    dateJoined: isoFromEpoch(user.date_joined),
    dateInvited: isoFromEpoch(user.date_invited),
    invitedByName: str(member.invited_by?.username),
  };
}
