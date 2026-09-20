import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';
import { PasswordResetRepository } from './password-reset.repository';
import { UserRepository } from './user.repository';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
import { MailerService } from './mailer.service';
import { SessionService } from './session.service';
import { PermissionsService } from './permissions.service';
import { AuthPrincipal } from './auth.types';

/** A reset link is a live credential, not an onboarding invite — it lives for an
 *  hour, not the invitation's seven days. */
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly resets: PasswordResetRepository,
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly mailer: MailerService,
    private readonly sessions: SessionService,
    private readonly perms: PermissionsService,
  ) {}

  /** Issue a fresh single-use link, killing any outstanding one for that user. */
  private async issue(user: { id: string; email: string }, ip: string | null): Promise<void> {
    const { token, tokenHash } = this.tokens.generate();
    await this.resets.deleteActiveForUser(user.id);
    await this.resets.create({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
      requestedIp: ip,
    });
    await this.mailer.sendPasswordReset(user.email, token);
  }

  /**
   * Self-serve request. Always resolves `{ ok: true }` — telling the caller
   * whether an address has an account turns this endpoint into an account
   * enumerator.
   */
  async request(email: string, ip: string | null): Promise<{ ok: true }> {
    const user = await this.users.findByEmail(email.toLowerCase());
    if (!user || user.status === UserStatus.DISABLED) {
      this.logger.log(`Password reset requested for an unknown or disabled address; nothing sent.`);
      return { ok: true };
    }
    await this.issue(user, ip);
    return { ok: true };
  }

  /** The row behind a plaintext token, or a uniform 400. */
  private async load(token: string) {
    const row = await this.resets.findByTokenHash(this.tokens.hash(token));
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This password reset link is invalid or has expired.');
    }
    // A user disabled between the send and the click must not be able to walk
    // back in through a link that was valid when it was mailed.
    if (!row.user || row.user.status === UserStatus.DISABLED) {
      throw new BadRequestException('This password reset link is invalid or has expired.');
    }
    return row;
  }

  /** Public lookup for the reset screen: whose password is about to change. */
  async preview(token: string): Promise<{ email: string }> {
    const row = await this.load(token);
    return { email: row.user.email };
  }

  async reset(token: string, password: string): Promise<User> {
    const row = await this.load(token);
    const passwordHash = await this.passwords.hash(password);
    const user = await this.users.update(row.user.id, { passwordHash });
    await this.resets.markUsed(row.id);
    // A reset is the remedy for a possibly-compromised account, so every
    // existing session dies with it. The caller re-issues one for this request.
    await this.sessions.revokeAll(row.user.id);
    this.logger.log(`Password reset completed for user ${row.user.id}; all sessions revoked.`);
    return user;
  }

  /** Owner/Admin sends a reset link on a user's behalf. */
  async sendForUser(actor: AuthPrincipal, userId: string): Promise<{ ok: true }> {
    const user = await this.users.findById(userId);
    // Org-scope first: another org's user must be unaddressable by id, and
    // indistinguishable from one that doesn't exist.
    if (!user || user.orgId !== actor.orgId) throw new BadRequestException('User not found.');
    if (user.status === UserStatus.DISABLED) throw new BadRequestException('That user is disabled.');
    if (!this.perms.canManageUser(actor.role, user.role)) {
      throw new ForbiddenException('You cannot send a password reset to that user.');
    }
    await this.issue(user, null);
    return { ok: true };
  }

  /** Signed-in change: proves the current password instead of an emailed token. */
  async changePassword(userId: string, current: string, next: string): Promise<{ ok: true }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid credentials.');
    if (!(await this.passwords.verify(current, user.passwordHash))) {
      throw new UnauthorizedException('Your current password is incorrect.');
    }
    if (current === next) throw new BadRequestException('Choose a password you have not used here before.');
    const passwordHash = await this.passwords.hash(next);
    await this.users.update(user.id, { passwordHash });
    // Same reasoning as reset(); the caller re-issues a session for this request
    // so the person changing their password isn't logged out of the tab they're in.
    await this.sessions.revokeAll(user.id);
    return { ok: true };
  }
}
