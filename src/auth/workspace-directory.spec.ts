import { annotateWorkspaceMembers, type AppUserRef, type InviteRef } from './workspace-directory';
import type { WorkspaceMemberDto } from '../clickup/workspace-member.mapper';

function member(over: Partial<WorkspaceMemberDto> & { id: string }): WorkspaceMemberDto {
  return {
    name: null,
    email: null,
    profilePicture: null,
    color: null,
    initials: null,
    role: null,
    lastActive: null,
    dateJoined: null,
    dateInvited: null,
    invitedByName: null,
    ...over,
  };
}

const user = (over: Partial<AppUserRef> = {}): AppUserRef => ({
  id: 'u1',
  name: 'Ada',
  email: 'ada@x.com',
  role: 'MEMBER',
  status: 'ACTIVE',
  clickupUserId: null,
  ...over,
});

const invite = (over: Partial<InviteRef> = {}): InviteRef => ({
  id: 'i1',
  email: 'bo@x.com',
  role: 'MEMBER',
  clickupUserId: null,
  ...over,
});

describe('annotateWorkspaceMembers', () => {
  it('marks a member with no matching account as invitable', () => {
    const [row] = annotateWorkspaceMembers([member({ id: '1', email: 'new@x.com' })], [], []);
    expect(row.linkStatus).toBe('none');
    expect(row.appUser).toBeNull();
    expect(row.invite).toBeNull();
    expect(row.canInvite).toBe(true);
  });

  it('matches an existing account by ClickUp id even when the emails differ', () => {
    const [row] = annotateWorkspaceMembers(
      [member({ id: '1', email: 'work@x.com' })],
      [user({ email: 'personal@x.com', clickupUserId: '1' })],
      [],
    );
    expect(row.linkStatus).toBe('member');
    expect(row.appUser).toEqual({ id: 'u1', name: 'Ada', email: 'personal@x.com', role: 'MEMBER', status: 'ACTIVE' });
    expect(row.canInvite).toBe(false);
  });

  it('falls back to a case-insensitive email match when nothing is linked by id', () => {
    const [row] = annotateWorkspaceMembers([member({ id: '1', email: 'ADA@x.com' })], [user()], []);
    expect(row.linkStatus).toBe('member');
    expect(row.appUser?.id).toBe('u1');
  });

  it('does not match a different account by email when this member is linked to another id', () => {
    // 'ada@x.com' belongs to u1, but u1 is linked to ClickUp user 99 — so member
    // 1 is a different person who happens to share the address in ClickUp.
    const [row] = annotateWorkspaceMembers(
      [member({ id: '1', email: 'ada@x.com' })],
      [user({ clickupUserId: '99' })],
      [],
    );
    expect(row.linkStatus).toBe('none');
    expect(row.canInvite).toBe(true);
  });

  it('reports a pending invite when there is no account yet', () => {
    const [row] = annotateWorkspaceMembers([member({ id: '2', email: 'bo@x.com' })], [], [invite()]);
    expect(row.linkStatus).toBe('invited');
    expect(row.invite).toEqual({ id: 'i1', email: 'bo@x.com', role: 'MEMBER' });
    expect(row.canInvite).toBe(false);
  });

  it('matches a pending invite by ClickUp id as well as by email', () => {
    const [row] = annotateWorkspaceMembers(
      [member({ id: '2', email: 'other@x.com' })],
      [],
      [invite({ clickupUserId: '2' })],
    );
    expect(row.linkStatus).toBe('invited');
  });

  it('prefers an existing account over a stale pending invite', () => {
    const [row] = annotateWorkspaceMembers(
      [member({ id: '1', email: 'ada@x.com' })],
      [user()],
      [invite({ email: 'ada@x.com' })],
    );
    expect(row.linkStatus).toBe('member');
    expect(row.invite).toBeNull();
  });

  it('still reports a disabled account as a member rather than offering an invite', () => {
    const [row] = annotateWorkspaceMembers([member({ id: '1', email: 'ada@x.com' })], [user({ status: 'DISABLED' })], []);
    expect(row.linkStatus).toBe('member');
    expect(row.appUser?.status).toBe('DISABLED');
    expect(row.canInvite).toBe(false);
  });

  it('cannot invite a member ClickUp gives no email for', () => {
    const [row] = annotateWorkspaceMembers([member({ id: '3', name: 'Guest' })], [], []);
    expect(row.linkStatus).toBe('none');
    expect(row.canInvite).toBe(false);
  });

  it('preserves the ClickUp detail fields and the input order', () => {
    const rows = annotateWorkspaceMembers(
      [member({ id: '2', name: 'Bo', role: 'admin', dateJoined: '2025-03-12T00:00:00.000Z' }), member({ id: '1' })],
      [],
      [],
    );
    expect(rows.map((r) => r.id)).toEqual(['2', '1']);
    expect(rows[0].role).toBe('admin');
    expect(rows[0].dateJoined).toBe('2025-03-12T00:00:00.000Z');
  });
});
