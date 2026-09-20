import { Injectable } from '@nestjs/common';
import { ClickupClient } from './clickup.client';
import { SettingsService } from '../settings/settings.service';
import { mapWorkspaceMember, type WorkspaceMemberDto } from './workspace-member.mapper';

const TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface MemberDto {
  id: string;
  name: string | null;
  email: string | null;
  profilePicture: string | null;
  color: string | null;
  initials: string | null;
}

/**
 * Cached resolver for the workspace's members. Used by the time-entry sync to
 * pass `assignee=<all members>` to ClickUp's `/team/{team}/time_entries`
 * endpoint (the only way to capture tracked time on tasks the loggers are not
 * assignees of), and by the dashboard to render member profile photos. ClickUp
 * is hit at most once per TTL window; concurrent callers share the in-flight
 * promise.
 *
 * One cache holds the full member records; `getDirectory` projects them down to
 * the lean avatar shape served by the un-role-gated `GET /clickup/members`, so
 * the detail fields (role, last active, joined, invited by) reach only the
 * Owner/Admin-gated `GET /admin/workspace-members`.
 */
@Injectable()
export class WorkspaceMembersService {
  private cache?: { members: WorkspaceMemberDto[]; expiresAt: number };
  private inFlight?: Promise<WorkspaceMemberDto[]>;

  constructor(
    private readonly clickup: ClickupClient,
    private readonly settings: SettingsService,
  ) {}

  /** Full member records, including detail fields. `refresh` discards a warm
   *  cache and refetches — the "Refresh" affordance on the members screen,
   *  since a person added in ClickUp is otherwise invisible for up to the TTL. */
  async getFullDirectory(opts?: { refresh?: boolean }): Promise<WorkspaceMemberDto[]> {
    if (opts?.refresh) {
      this.cache = undefined;
      this.inFlight = undefined;
    } else {
      if (this.cache && Date.now() < this.cache.expiresAt) return this.cache.members;
      if (this.inFlight) return this.inFlight;
    }
    this.inFlight = (async () => {
      try {
        const teamId = this.settings.getTeamId();
        const raw = await this.clickup.getTeamMembers(teamId);
        const members = raw
          .map((m) => mapWorkspaceMember(m))
          .filter((m): m is WorkspaceMemberDto => m !== null);
        this.cache = { members, expiresAt: Date.now() + TTL_MS };
        return members;
      } finally {
        this.inFlight = undefined;
      }
    })();
    return this.inFlight;
  }

  async getDirectory(): Promise<MemberDto[]> {
    const members = await this.getFullDirectory();
    return members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      profilePicture: m.profilePicture,
      color: m.color,
      initials: m.initials,
    }));
  }

  async getMemberIds(): Promise<string[]> {
    return (await this.getFullDirectory()).map((m) => m.id);
  }
}
