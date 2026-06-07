import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { SessionRepository } from './session.repository';
import { TokenService } from './token.service';

@Injectable()
export class SessionService {
  constructor(
    private readonly repo: SessionRepository,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  private maxAgeDays() { return this.config.get<number>('SESSION_MAX_AGE_DAYS', 30); }
  private idleDays() { return this.config.get<number>('SESSION_IDLE_TIMEOUT_DAYS', 7); }

  /** Create a session row, return the plaintext token for the cookie. */
  async issue(userId: string, ip: string | null, userAgent: string | null): Promise<{ token: string; expiresAt: Date }> {
    const { token, tokenHash } = this.tokens.generate();
    const expiresAt = this.tokens.expiryFromDays(this.maxAgeDays());
    await this.repo.create({ userId, tokenHash, expiresAt, ip, userAgent });
    return { token, expiresAt };
  }

  /** Validate a plaintext cookie token. Returns the row+user or null. Sliding idle refresh. */
  async validate(token: string) {
    const row = await this.repo.findByTokenHash(this.tokens.hash(token));
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) {
      await this.repo.deleteByTokenHash(row.tokenHash);
      return null;
    }
    // Idle timeout: a session untouched for longer than SESSION_IDLE_TIMEOUT_DAYS
    // is dead even though the absolute 30-day cap hasn't been reached — this is
    // what bounds the lifetime of a stolen cookie on an abandoned session.
    // `lastSeenAt` is null until the first touch, so fall back to createdAt.
    const lastActivity = (row.lastSeenAt ?? row.createdAt)?.getTime() ?? 0;
    if (Date.now() - lastActivity > this.idleDays() * 24 * 60 * 60 * 1000) {
      await this.repo.deleteByTokenHash(row.tokenHash);
      return null;
    }
    if (!row.user || row.user.status === UserStatus.DISABLED) return null;
    // Throttled sliding refresh: only write once an hour to avoid amplifying
    // writes under the dashboard's frequent polling.
    const lastSeen = row.lastSeenAt?.getTime() ?? 0;
    if (Date.now() - lastSeen > 60 * 60 * 1000) await this.repo.touch(row.id);
    return row;
  }

  async revoke(token: string) {
    await this.repo.deleteByTokenHash(this.tokens.hash(token));
  }

  async revokeAll(userId: string) {
    await this.repo.deleteAllForUser(userId);
  }

  cookieMaxAgeMs() {
    return this.maxAgeDays() * 24 * 60 * 60 * 1000;
  }
}
