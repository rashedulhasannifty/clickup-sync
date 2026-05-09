import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DeadLetterRepository {
  constructor(private readonly prisma: PrismaService) {}
  create(data: { queueName: string; jobName: string; entityType?: string; entityId?: string; payload: unknown; error: unknown; attemptsMade?: number }) {
    const e = data.error as any;
    return this.prisma.deadLetterJob.create({ data: { queueName: data.queueName, jobName: data.jobName, entityType: data.entityType, entityId: data.entityId, payload: data.payload as any, errorMessage: e?.message || String(data.error), errorStack: e?.stack, attemptsMade: data.attemptsMade } });
  }
}
