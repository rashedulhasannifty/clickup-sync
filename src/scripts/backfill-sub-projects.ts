/**
 * One-off backfill for `clickup_tasks.sub_projects`.
 *
 * Re-extracts the "Sub-Project" custom field from each task's stored `raw`
 * ClickUp payload — no ClickUp API calls. Only rows whose value actually
 * changes are written, so it is safe to re-run.
 *
 *   npm run backfill:sub-projects             # local (tsx), write
 *   npm run backfill:sub-projects -- --dry-run
 *
 * Production (VPS, as deploy, in /srv/clickup-sync/current — see docs/DEPLOYMENT.md):
 *   node /srv/clickup-sync/shared/with-env.cjs /srv/clickup-sync/shared/.env \
 *     node dist/scripts/backfill-sub-projects.js --dry-run
 *
 * Tasks whose `raw` predates the field being set simply stay empty; the next
 * webhook or scheduled sync for that task fills them in.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildPgPoolConfig } from '../config/connection.config';
import { CustomFieldExtractor } from '../clickup/custom-field-extractor';
import type { ClickUpTask } from '../clickup/clickup.types';

const BATCH = 500;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient({ adapter: new PrismaPg(buildPgPoolConfig(process.env.DATABASE_URL ?? '')) });
  const extractor = new CustomFieldExtractor();
  let cursor: string | undefined;
  let scanned = 0;
  let changed = 0;
  try {
    for (;;) {
      const rows = await prisma.clickupTask.findMany({
        select: { taskId: true, raw: true, subProjects: true },
        orderBy: { taskId: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { taskId: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) break;
      for (const row of rows) {
        scanned++;
        if (!row.raw || typeof row.raw !== 'object' || Array.isArray(row.raw)) continue;
        const next = extractor.extract(row.raw as unknown as ClickUpTask).subProjects;
        if (JSON.stringify(next) === JSON.stringify(row.subProjects)) continue;
        changed++;
        console.log(`${row.taskId}: [${row.subProjects.join(', ')}] -> [${next.join(', ')}]`);
        if (!dryRun) await prisma.clickupTask.update({ where: { taskId: row.taskId }, data: { subProjects: next } });
      }
      cursor = rows[rows.length - 1].taskId;
    }
    console.log(`${dryRun ? '[dry-run] ' : ''}scanned ${scanned} tasks, ${changed} ${dryRun ? 'would change' : 'updated'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
