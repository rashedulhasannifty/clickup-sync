/**
 * One-off backfill for `clickup_tasks.client_option_id` and `scope_client_option_id`.
 * Pass 1 re-extracts the Client option id from each stored `raw` payload (no API calls).
 * Pass 2 derives scope: own id, else parent's (one level — ClickUp subtasks of subtasks
 * inherit through their direct parent, so pass 2 loops until no row changes).
 *
 *   npm run backfill:client-option-ids -- --dry-run
 * Production:
 *   docker compose -f docker-compose.prod.yml exec app-worker node dist/scripts/backfill-client-option-ids.js --dry-run
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
  let changed = 0;
  for (;;) {
    const rows = await prisma.clickupTask.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { taskId: cursor } } : {}),
      orderBy: { taskId: 'asc' },
      select: { taskId: true, raw: true, clientOptionId: true },
    });
    if (!rows.length) break;
    for (const r of rows) {
      const next = r.raw ? extractor.extract(r.raw as unknown as ClickUpTask).clientOptionId : null;
      if (next !== r.clientOptionId) {
        changed++;
        if (!dryRun) await prisma.clickupTask.update({ where: { taskId: r.taskId }, data: { clientOptionId: next } });
      }
    }
    cursor = rows[rows.length - 1].taskId;
  }
  console.log(`client_option_id: ${changed} row(s) ${dryRun ? 'would change' : 'updated'}`);
  if (dryRun) {
    await prisma.$disconnect();
    return;
  }

  const own = await prisma.$executeRaw`
    UPDATE clickup_tasks SET scope_client_option_id = client_option_id
    WHERE client_option_id IS NOT NULL AND scope_client_option_id IS DISTINCT FROM client_option_id`;
  // A task whose own client was cleared (pass 1 set client_option_id NULL) and
  // that has no resolvable parent can't be reached by "own" (needs client_option_id
  // NOT NULL) or by the inheritance UPDATE below (needs a joinable parent row), so
  // its old scope would otherwise survive stale. Clear it explicitly.
  const cleared = await prisma.$executeRaw`
    UPDATE clickup_tasks SET scope_client_option_id = NULL
    WHERE client_option_id IS NULL AND scope_client_option_id IS NOT NULL
      AND (parent_task_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM clickup_tasks p WHERE p.task_id = clickup_tasks.parent_task_id))`;
  let inherited = 0;
  const MAX_PASSES = 5;
  let lastPassChanged = 0;
  let passesRun = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const n = await prisma.$executeRaw`
      UPDATE clickup_tasks c SET scope_client_option_id = p.scope_client_option_id
      FROM clickup_tasks p
      WHERE c.parent_task_id = p.task_id AND c.client_option_id IS NULL
        AND c.scope_client_option_id IS DISTINCT FROM p.scope_client_option_id`;
    inherited += n;
    lastPassChanged = n;
    passesRun = pass + 1;
    if (n === 0) break;
  }
  if (passesRun === MAX_PASSES && lastPassChanged > 0) {
    console.warn(
      `scope_client_option_id: inheritance may be incomplete — hit the ${MAX_PASSES}-pass cap while the last pass still changed ${lastPassChanged} row(s); rerun the script`,
    );
  }
  console.log(`scope_client_option_id: ${own} own, ${cleared} cleared, ${inherited} inherited`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
