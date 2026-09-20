import type { WorkspaceMemberDto } from '../clickup/workspace-member.mapper';

export interface AppUserRef {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  clickupUserId: string | null;
}

export interface InviteRef {
  id: string;
  email: string;
  role: string;
  clickupUserId: string | null;
}

export type MemberLinkStatus = 'member' | 'invited' | 'none';

export interface AnnotatedWorkspaceMember extends WorkspaceMemberDto {
  linkStatus: MemberLinkStatus;
  appUser: { id: string; name: string | null; email: string; role: string; status: string } | null;
  invite: { id: string; email: string; role: string } | null;
  /** False when the member already has an account or a pending invite, and also
   *  when ClickUp gives no email — there is nothing to send the invitation to. */
  canInvite: boolean;
}

/** Indexes a list by ClickUp id and by lowercased email. An entry that carries a
 *  ClickUp id is deliberately left out of the email index: it belongs to a known
 *  ClickUp identity, so a *different* member sharing that address must not
 *  match it. */
function index<T extends { email: string; clickupUserId: string | null }>(rows: T[]) {
  const byClickupId = new Map<string, T>();
  const byEmail = new Map<string, T>();
  for (const row of rows) {
    if (row.clickupUserId) byClickupId.set(row.clickupUserId, row);
    else if (row.email) byEmail.set(row.email.toLowerCase(), row);
  }
  return {
    find(member: WorkspaceMemberDto): T | undefined {
      return byClickupId.get(member.id) ?? (member.email ? byEmail.get(member.email.toLowerCase()) : undefined);
    },
  };
}

/**
 * Joins the ClickUp workspace directory to this org's accounts and pending
 * invitations, so the members screen can say, per row, whether that person is
 * already here, already invited, or still invitable. Pure: the caller loads the
 * three lists.
 *
 * A live account always wins over a pending invitation — an invite that was
 * already accepted (or superseded) must not offer to be resent.
 */
export function annotateWorkspaceMembers(
  members: WorkspaceMemberDto[],
  users: AppUserRef[],
  pendingInvites: InviteRef[],
): AnnotatedWorkspaceMember[] {
  const userIndex = index(users);
  const inviteIndex = index(pendingInvites);

  return members.map((member) => {
    const user = userIndex.find(member);
    const invite = user ? undefined : inviteIndex.find(member);
    return {
      ...member,
      linkStatus: user ? 'member' : invite ? 'invited' : 'none',
      appUser: user ? { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } : null,
      invite: invite ? { id: invite.id, email: invite.email, role: invite.role } : null,
      canInvite: !user && !invite && member.email !== null,
    };
  });
}
