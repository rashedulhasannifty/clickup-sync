import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type HistoryItem =
  | { kind: 'job'; id: string; at: Date | null; queueName: string; jobName: string; status: string; error: string | null }
  | { kind: 'event'; id: string; at: Date; eventType: string; changedByUserName: string | null; before: unknown; after: unknown };

@Injectable()
export class TaskHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async forTask(taskId: string): Promise<HistoryItem[]> {
    const [jobs, events] = await Promise.all([
      this.prisma.syncJobLog.findMany({
        where: { entityType: 'task', entityId: taskId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.clickupTaskEvent.findMany({
        where: { taskId },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      }),
    ]);

    const jobItems: HistoryItem[] = jobs.map((j) => ({
      kind: 'job',
      id: j.id.toString(),
      at: j.finishedAt ?? j.startedAt ?? j.createdAt,
      queueName: j.queueName,
      jobName: j.jobName,
      status: j.status,
      error: j.errorMessage,
    }));
    const eventItems: HistoryItem[] = events.map((e) => ({
      kind: 'event',
      id: e.id.toString(),
      at: e.occurredAt,
      eventType: e.eventType,
      changedByUserName: e.changedByUserName,
      before: e.before,
      after: e.after,
    }));

    return [...jobItems, ...eventItems].sort(
      (a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0),
    );
  }
}
