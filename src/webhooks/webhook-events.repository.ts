import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ParsedWebhook } from './webhook-parser.service';

@Injectable()
export class WebhookEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveReceived(parsed: ParsedWebhook): Promise<{ duplicate: boolean; id?: bigint }> {
    try {
      const event = await this.prisma.clickupWebhookEvent.create({ data: { fingerprint: parsed.fingerprint, eventType: parsed.eventType, taskId: parsed.taskId, rawPayload: parsed.payload as any } });
      await this.prisma.clickupWebhookSeen.create({ data: { fingerprint: parsed.fingerprint } }).catch(() => undefined);
      return { duplicate: false, id: event.id };
    } catch (error: any) {
      if (error?.code === 'P2002') return { duplicate: true };
      throw error;
    }
  }

  markProcessed(fingerprint: string) { return this.prisma.clickupWebhookEvent.update({ where: { fingerprint }, data: { status: 'processed', processedAt: new Date(), errorMessage: null } }); }
  markFailed(fingerprint: string, message: string) { return this.prisma.clickupWebhookEvent.update({ where: { fingerprint }, data: { status: 'failed', processedAt: new Date(), errorMessage: message } }); }
}
