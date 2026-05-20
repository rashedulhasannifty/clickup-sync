import { Injectable } from '@nestjs/common';
import { ClickupClient } from './clickup.client';

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_TEAM_ID = '3450636';

/**
 * Cached resolver for the workspace's member user ids. Used by the
 * time-entry sync to pass `assignee=<all members>` to ClickUp's
 * `/team/{team}/time_entries` endpoint, which is the only way to capture
 * tracked time logged on tasks the loggers are not assignees of. ClickUp
 * is hit at most once per TTL window; concurrent callers share the in-
 * flight promise.
 */
@Injectable()
export class WorkspaceMembersService {
  private cache?: { ids: string[]; expiresAt: number };
  private inFlight?: Promise<string[]>;

  constructor(private readonly clickup: ClickupClient) {}

  async getMemberIds(): Promise<string[]> {
    if (this.cache && Date.now() < this.cache.expiresAt) return this.cache.ids;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const teamId = process.env.CLICKUP_TEAM_ID || DEFAULT_TEAM_ID;
        const members = await this.clickup.getTeamMembers(teamId);
        const ids = members
          .map((m) => m?.user?.id)
          .filter((v): v is string | number => v !== null && v !== undefined)
          .map(String);
        this.cache = { ids, expiresAt: Date.now() + TTL_MS };
        return ids;
      } finally {
        this.inFlight = undefined;
      }
    })();
    return this.inFlight;
  }
}
