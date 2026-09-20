import { Injectable } from '@nestjs/common';
import { InvitationStatus } from '@prisma/client';
import { WorkspaceMembersService } from '../clickup/workspace-members.service';
import { UserRepository } from './user.repository';
import { InvitationRepository } from './invitation.repository';
import { annotateWorkspaceMembers, type AnnotatedWorkspaceMember } from './workspace-directory';

/**
 * The ClickUp workspace directory as the Users page shows it: every ClickUp
 * member, annotated with whether that person already has an account here, has a
 * pending invitation, or is still invitable. Backs `GET /users/clickup-members`.
 */
@Injectable()
export class WorkspaceDirectoryService {
  constructor(
    private readonly members: WorkspaceMembersService,
    private readonly users: UserRepository,
    private readonly invitations: InvitationRepository,
  ) {}

  /** `refresh` discards the 10-minute member cache — a person added in ClickUp
   *  is otherwise invisible here until it expires. */
  async list(orgId: string, opts?: { refresh?: boolean }): Promise<AnnotatedWorkspaceMember[]> {
    const [members, users, invites] = await Promise.all([
      this.members.getFullDirectory({ refresh: opts?.refresh ?? false }),
      this.users.listByOrg(orgId),
      this.invitations.listByOrg(orgId, InvitationStatus.PENDING),
    ]);
    return annotateWorkspaceMembers(
      members,
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        clickupUserId: u.clickupUserId,
      })),
      invites
        .filter((i) => i.status === InvitationStatus.PENDING)
        .map((i) => ({ id: i.id, email: i.email, role: i.role, clickupUserId: i.clickupUserId })),
    );
  }
}
