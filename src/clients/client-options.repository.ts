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

  /** `option_id` → current name, for canonicalizing task rows as they are written. */
  async nameByOptionId(): Promise<Map<string, string>> {
    const rows = await this.prisma.clickupClientOption.findMany({ select: { optionId: true, name: true } });
    return new Map(rows.map((r) => [r.optionId, r.name]));
  }

  /**
   * Rewrite stored client NAMES to the catalog's current label wherever they
   * disagree. Repairs rows that predate a rename: ClickUp embeds a snapshot of
   * the Client field in every task payload, so a task not edited since the
   * rename keeps reporting the old name however often it is re-synced, and no
   * amount of task syncing converges. Only the catalog knows the current name.
   *
   * `client_budgets` is name-keyed (`@@unique([client, validFrom])`) with no
   * option id of its own, so it is carried across in the SAME transaction —
   * otherwise a rename silently orphans a budget from the client it was set
   * for. The old→new mapping is derived from the task rows *before* they are
   * updated, since that join is the only record of what the old name meant. A
   * budget that would collide with one already under the new name is left
   * alone and reported, rather than aborting the repair.
   */
  async repairClientNames(): Promise<{ tasks: number; budgets: number; conflicts: number; renames: { from: string; to: string }[] }> {
    return this.prisma.$transaction(async (tx) => {
      const renames = await tx.$queryRaw<{ from: string; to: string }[]>`
        SELECT DISTINCT t.client AS "from", o.name AS "to"
        FROM clickup_tasks t
        JOIN clickup_client_options o ON o.option_id = t.client_option_id
        WHERE t.client IS NOT NULL AND t.client IS DISTINCT FROM o.name
      `;

      let budgets = 0;
      let conflicts = 0;
      for (const { from, to } of renames) {
        budgets += await tx.$executeRaw`
          UPDATE client_budgets b SET client = ${to}
          WHERE b.client = ${from}
            AND NOT EXISTS (
              SELECT 1 FROM client_budgets x WHERE x.client = ${to} AND x.valid_from = b.valid_from
            )
        `;
        conflicts += await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count FROM client_budgets WHERE client = ${from}
        `.then((r) => Number(r[0]?.count ?? 0));
      }

      // Includes rows whose name is NULL while the option id resolves: an
      // all-whitespace option label normalizes to NULL on extraction, and the
      // catalog can still name it.
      const tasks = await tx.$executeRaw`
        UPDATE clickup_tasks t SET client = o.name
        FROM clickup_client_options o
        WHERE t.client_option_id = o.option_id AND t.client IS DISTINCT FROM o.name
      `;

      return { tasks, budgets, conflicts, renames };
    },
    // `client_option_id` carries no index, so both statements scan
    // `clickup_tasks` (~51k rows). That is well inside Prisma's 5s default, but
    // this runs behind the nightly catalog cron where a slow disk should delay
    // the repair, not abort it and leave names split until tomorrow.
    { timeout: 30_000 });
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
