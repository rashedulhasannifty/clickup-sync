import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface SearchResult {
  tasks: { taskId: string; taskName: string; status: string | null; client: string | null }[];
  assignees: { userId: string; name: string | null; email: string | null }[];
}

@Injectable()
export class SearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(qRaw: string): Promise<SearchResult> {
    const q = (qRaw ?? '').trim();
    if (q.length < 2) return { tasks: [], assignees: [] };

    const [tasks, rates] = await Promise.all([
      this.prisma.clickupTask.findMany({
        where: {
          isDeleted: false,
          OR: [
            { taskName: { contains: q, mode: 'insensitive' } },
            { taskId: q },
          ],
        },
        select: { taskId: true, taskName: true, status: true, client: true },
        orderBy: { updatedDate: 'desc' },
        take: 8,
      }),
      this.prisma.assigneeRate.findMany({
        where: {
          OR: [
            { assigneeName: { contains: q, mode: 'insensitive' } },
            { assigneeEmail: { contains: q, mode: 'insensitive' } },
            { assigneeId: q },
          ],
        },
        select: { assigneeId: true, assigneeName: true, assigneeEmail: true },
        orderBy: { assigneeName: 'asc' },
        take: 20,
      }),
    ]);

    const seen = new Set<string>();
    const assignees: SearchResult['assignees'] = [];
    for (const r of rates) {
      if (seen.has(r.assigneeId)) continue;
      seen.add(r.assigneeId);
      assignees.push({ userId: r.assigneeId, name: r.assigneeName, email: r.assigneeEmail });
      if (assignees.length >= 6) break;
    }

    return { tasks, assignees };
  }
}
