import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DeadLetterRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { queueName: string; jobName: string; entityType?: string; entityId?: string; payload: unknown; error: unknown; attemptsMade?: number }) {
    const e = data.error as any;
    return this.prisma.deadLetterJob.create({
      data: {
        queueName: data.queueName,
        jobName: data.jobName,
        entityType: data.entityType,
        entityId: data.entityId,
        payload: data.payload as any,
        errorMessage: e?.message || String(data.error),
        errorStack: e?.stack,
        attemptsMade: data.attemptsMade,
      },
    });
  }

  async findPending(limit: number, offset: number) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.deadLetterJob.findMany({
        where: { retriedAt: null, resolvedAt: null },
        orderBy: { failedAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          queueName: true,
          jobName: true,
          entityType: true,
          entityId: true,
          errorMessage: true,
          failedAt: true,
          retriedAt: true,
          attemptsMade: true,
        },
      }),
      this.prisma.deadLetterJob.count({ where: { retriedAt: null, resolvedAt: null } }),
    ]);
    return { items, total };
  }

  findById(id: bigint) {
    return this.prisma.deadLetterJob.findUnique({ where: { id } });
  }

  markRetried(id: bigint) {
    return this.prisma.deadLetterJob.update({ where: { id }, data: { retriedAt: new Date() } });
  }
}
