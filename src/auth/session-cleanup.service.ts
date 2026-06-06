import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionRepository } from './session.repository';

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);
  constructor(private readonly sessions: SessionRepository) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep() {
    const { count } = await this.sessions.deleteExpired();
    if (count > 0) this.logger.log(`Swept ${count} expired session(s)`);
  }
}
