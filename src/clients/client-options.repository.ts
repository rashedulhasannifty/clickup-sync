import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ClientOptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert one field's options. Options of THIS field no longer returned by ClickUp
   * are marked archived — never deleted, so a team keeps its mapping and history.
   */
  async upsertForField(fieldId: string, options: { optionId: string; name: string }[]) {
    return this.prisma.$transaction(async (tx) => {
      for (const o of options) {
        await tx.clickupClientOption.upsert({
          where: { optionId: o.optionId },
          create: { optionId: o.optionId, fieldId, name: o.name },
          update: { fieldId, name: o.name, archived: false },
        });
      }
      const { count } = await tx.clickupClientOption.updateMany({
        where: { fieldId, archived: false, optionId: { notIn: options.map((o) => o.optionId) } },
        data: { archived: true },
      });
      return { upserted: options.length, archived: count };
    });
  }

  async list() {
    const rows = await this.prisma.clickupClientOption.findMany({
      orderBy: { name: 'asc' },
      include: { team: { select: { teamId: true } } },
    });
    return rows.map((r) => ({
      optionId: r.optionId,
      fieldId: r.fieldId,
      name: r.name,
      archived: r.archived,
      teamId: r.team?.teamId ?? null,
    }));
  }

  findByIds(ids: string[]) {
    return this.prisma.clickupClientOption.findMany({ where: { optionId: { in: ids } } });
  }
}
