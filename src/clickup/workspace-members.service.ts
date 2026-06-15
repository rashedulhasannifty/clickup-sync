import { Injectable } from '@nestjs/common';
import { ClickupClient } from './clickup.client';
import { SettingsService } from '../settings/settings.service';

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
 */
@Injectable()
export class WorkspaceMembersService {
  private cache?: { members: MemberDto[]; expiresAt: number };
  private inFlight?: Promise<MemberDto[]>;

  constructor(
    private readonly clickup: ClickupClient,
    private readonly settings: SettingsService,
  ) {}

  async getDirectory(): Promise<MemberDto[]> {
    if (this.cache && Date.now() < this.cache.expiresAt) return this.cache.members;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const teamId = this.settings.getTeamId();
        const raw = await this.clickup.getTeamMembers(teamId);
        const members: MemberDto[] = raw
          .filter((m) => m?.user?.id !== null && m?.user?.id !== undefined)
          .map((m) => ({
            id: String(m.user.id),
            name: m.user.username ?? null,
            email: m.user.email ?? null,
            profilePicture: m.user.profilePicture ?? null,
            color: m.user.color ?? null,
            initials: m.user.initials ?? null,
          }));
        this.cache = { members, expiresAt: Date.now() + TTL_MS };
        return members;
      } finally {
        this.inFlight = undefined;
      }
    })();
    return this.inFlight;
  }

  async getMemberIds(): Promise<string[]> {
    return (await this.getDirectory()).map((m) => m.id);
  }
}
