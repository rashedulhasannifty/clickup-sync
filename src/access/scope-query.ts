import { Prisma } from '@prisma/client';
import { AccessScope, leadClientIds, visibleClientIds } from './access-scope';

const IDENT = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i;
function ident(name: string): Prisma.Sql {
  if (!IDENT.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return Prisma.raw(name);
}

/** Prisma filter for `clickup_tasks`. `{}` = no constraint; an empty id list matches nothing. */
export function taskScopeWhere(s: AccessScope): Prisma.ClickupTaskWhereInput {
  const ids = visibleClientIds(s);
  return ids === null ? {} : { scopeClientOptionId: { in: ids } };
}

/** Prisma filter for `clickup_time_entries`, through the task. Task-less entries are excluded when scoped. */
export function timeEntryScopeWhere(s: AccessScope): Prisma.ClickupTimeEntryWhereInput {
  const ids = visibleClientIds(s);
  return ids === null ? {} : { task: { scopeClientOptionId: { in: ids } } };
}

function inIds(ids: string[] | null, column: Prisma.Sql): Prisma.Sql {
  if (ids === null) return Prisma.sql`TRUE`;
  if (ids.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${column} = ANY(${ids}::text[])`;
}

/** `<alias>.scope_client_option_id` is in scope. A NULL (no client / no task on a LEFT JOIN) is out of scope. */
export function taskScopeSql(s: AccessScope, alias: string): Prisma.Sql {
  return inIds(visibleClientIds(s), Prisma.sql`${ident(alias)}.scope_client_option_id`);
}

/** Same, restricted to clients the viewer LEADS — use inside `CASE WHEN ... THEN cost_cents` sums. */
export function leadScopeSql(s: AccessScope, alias: string): Prisma.Sql {
  return inIds(leadClientIds(s), Prisma.sql`${ident(alias)}.scope_client_option_id`);
}

/** For queries with no `clickup_tasks` join (e.g. `clickup_task_events`): `<column> IN (in-scope task ids)`. */
export function taskIdInScopeSql(s: AccessScope, column: string): Prisma.Sql {
  const ids = visibleClientIds(s);
  if (ids === null) return Prisma.sql`TRUE`;
  if (ids.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${ident(column)} IN (SELECT task_id FROM clickup_tasks WHERE scope_client_option_id = ANY(${ids}::text[]))`;
}
