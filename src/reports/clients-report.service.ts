import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AccessScope } from '../access/access-scope';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { leadScopeSql, taskScopeSql } from '../access/scope-query';
import {
  assembleClients,
  type ClientAggRow,
  type ClientAssigneeRow,
  type ClientEndpointRow,
  type ClientGroupRow,
  type ClientHoursRow,
  type ClientOverview,
  type ClientSort,
} from './clients.assemble';

/** Top assignees shown per card; the rest are reported as an overflow count. */
const ASSIGNEE_LIMIT = 6;

const SORTS: ClientSort[] = ['name', 'tasks', 'hours', 'recent'];

/** Space names by id, for rows whose `space_name` was never synced — the same
 *  configured-space merge the Spaces page does. */
const CONFIGURED_SPACE_NAMES = new Map<string, string>(CLICKUP_SPACES.map((s) => [s.id, s.name]));

/**
 * The Clients page (`GET /reports/clients/overview`): one card per client with
 * its first and last task (including the space/folder/list/sprint each sat in),
 * task counts, tracked hours and cost, the spaces and folders its work spans,
 * and who worked on it.
 *
 * Deliberately lifetime-wide — "first task" is a lifetime question, and a date
 * window would silently redefine it as "first in range". Grouping is by client
 * NAME, matching `/reports/clients` and every other per-client report here.
 *
 * No `requireLeadView`: like `time-entries/by-client`, this is scoped and
 * cost-masked rather than lead-gated, so a scoped MEMBER sees their clients'
 * cards with hours but a null cost.
 */
@Injectable()
export class ClientsReportService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(
    opts: { spaceId?: string; archived?: string; sort?: ClientSort } = {},
    scope: AccessScope,
  ): Promise<ClientOverview[]> {
    const { spaceId, archived } = opts;
    const sort = SORTS.includes(opts.sort as ClientSort) ? (opts.sort as ClientSort) : 'name';

    // Same convention as `tasksClients`: 'only' → archived only, 'exclude' →
    // hide archived, anything else → no clause.
    const archivedSql =
      archived === 'only' ? Prisma.sql`AND t.archived = true`
      : archived === 'exclude' ? Prisma.sql`AND t.archived = false`
      : Prisma.empty;
    const spaceSql = spaceId ? Prisma.sql`AND t.space_id = ${spaceId}` : Prisma.empty;
    // Every query starts from the same set of tasks, so the counts, the
    // endpoints and the rollups can never describe different populations.
    const inScope = Prisma.sql`
      t.is_deleted = false
      AND t.client IS NOT NULL
      AND t.client <> ''
      AND ${taskScopeSql(scope, 't')}
      ${spaceSql}
      ${archivedSql}
    `;

    type AggRaw = {
      client: string; client_option_id: string | null; task_count: bigint; open_count: bigint;
      closed_count: bigint; has_led_cost: boolean; cost_partial: boolean;
    };
    type EndpointRaw = {
      client: string; position: 'first' | 'last'; task_id: string; task_name: string; url: string | null;
      created_date: Date | null; status: string | null; space_name: string | null; folder_name: string | null;
      list_name: string | null; sprint_name: string | null;
    };
    type HoursRaw = { client: string; total_hours: number; total_cost_cents: number };
    type GroupRaw = { client: string; kind: 'space' | 'folder'; id: string | null; name: string | null; task_count: bigint };
    type SprintRaw = { client: string; sprint_count: bigint };
    type AssigneeRaw = { client: string; user_id: string | null; user_name: string | null; hours: number };

    const [aggRaw, endpointRaw, hoursRaw, groupRaw, sprintRaw, assigneeRaw] = await Promise.all([
      // Counts, plus whether the viewer leads this client — computed over TASKS
      // so a led client with no tracked time still reports a real zero cost.
      this.prisma.$queryRaw<AggRaw[]>(Prisma.sql`
        SELECT t.client,
               MAX(t.client_option_id) AS client_option_id,
               COUNT(*)::bigint AS task_count,
               COUNT(*) FILTER (WHERE t.status_type NOT IN ('done', 'closed') OR t.status_type IS NULL)::bigint AS open_count,
               COUNT(*) FILTER (WHERE t.status_type IN ('done', 'closed'))::bigint AS closed_count,
               BOOL_OR(${leadScopeSql(scope, 't')}) AS has_led_cost,
               BOOL_OR(NOT ${leadScopeSql(scope, 't')}) AS cost_partial
        FROM clickup_tasks t
        WHERE ${inScope}
        GROUP BY t.client
      `),
      // The oldest and newest task per client, with the detail the card shows.
      // A task with no created_date can never win either end (ranked last in
      // both directions by NULLS LAST).
      this.prisma.$queryRaw<EndpointRaw[]>(Prisma.sql`
        WITH ranked AS (
          SELECT t.client, t.task_id, t.task_name, t.url, t.created_date, t.status,
                 t.space_name, t.folder_name, t.list_name, t.sprint_name,
                 ROW_NUMBER() OVER (PARTITION BY t.client ORDER BY t.created_date ASC NULLS LAST, t.task_id ASC) AS first_rank,
                 ROW_NUMBER() OVER (PARTITION BY t.client ORDER BY t.created_date DESC NULLS LAST, t.task_id DESC) AS last_rank
          FROM clickup_tasks t
          WHERE ${inScope} AND t.created_date IS NOT NULL
        )
        SELECT 'first' AS position, client, task_id, task_name, url, created_date, status,
               space_name, folder_name, list_name, sprint_name
        FROM ranked WHERE first_rank = 1
        UNION ALL
        SELECT 'last' AS position, client, task_id, task_name, url, created_date, status,
               space_name, folder_name, list_name, sprint_name
        FROM ranked WHERE last_rank = 1
      `),
      // Hours and cost. Cost sums LEAD-visible rows only; whether that sum is
      // shown at all is decided by `has_led_cost` above.
      this.prisma.$queryRaw<HoursRaw[]>(Prisma.sql`
        SELECT t.client,
               COALESCE(SUM(e.duration_hours), 0)::float AS total_hours,
               COALESCE(SUM(CASE WHEN ${leadScopeSql(scope, 't')} THEN e.cost_cents ELSE 0 END), 0)::float AS total_cost_cents
        FROM clickup_time_entries e
        JOIN clickup_tasks t ON e.task_id = t.task_id
        WHERE ${inScope}
        GROUP BY t.client
      `),
      // Grouped by ID, with the name resolved via MAX — most of this
      // workspace's tasks carry a space_id whose space_name was never synced
      // (the same quirk `tasksSummary` documents). Grouping by name instead
      // would silently drop every one of those tasks from the rollup.
      this.prisma.$queryRaw<GroupRaw[]>(Prisma.sql`
        SELECT client, kind, id, MAX(name) AS name, COUNT(*)::bigint AS task_count
        FROM (
          SELECT t.client, 'space' AS kind, t.space_id AS id,
                 NULLIF(t.space_name, '') AS name
            FROM clickup_tasks t WHERE ${inScope} AND t.space_id IS NOT NULL
          UNION ALL
          SELECT t.client, 'folder' AS kind, t.folder_id AS id,
                 NULLIF(t.folder_name, '') AS name
            FROM clickup_tasks t WHERE ${inScope} AND t.folder_id IS NOT NULL
        ) g
        GROUP BY client, kind, id
      `),
      // A sprint is a LIST with start/due dates in the catalog, which is how
      // `/reports/sprints` defines one. The `sprint_name` column is empty in
      // this workspace — counting it reported 0 sprints for every client.
      this.prisma.$queryRaw<SprintRaw[]>(Prisma.sql`
        SELECT t.client, COUNT(DISTINCT t.list_id)::bigint AS sprint_count
        FROM clickup_tasks t
        JOIN clickup_lists l ON l.list_id = t.list_id
        WHERE ${inScope} AND (l.start_date IS NOT NULL OR l.due_date IS NOT NULL)
        GROUP BY t.client
      `),
      // Who actually logged time against this client, most hours first.
      this.prisma.$queryRaw<AssigneeRaw[]>(Prisma.sql`
        SELECT t.client, e.user_id, MAX(e.user_name) AS user_name,
               COALESCE(SUM(e.duration_hours), 0)::float AS hours
        FROM clickup_time_entries e
        JOIN clickup_tasks t ON e.task_id = t.task_id
        WHERE ${inScope}
        GROUP BY t.client, e.user_id
      `),
    ]);

    const aggregates: ClientAggRow[] = aggRaw.map((r) => ({
      client: r.client,
      clientOptionId: r.client_option_id,
      taskCount: Number(r.task_count),
      openCount: Number(r.open_count),
      closedCount: Number(r.closed_count),
      hasLedCost: !!r.has_led_cost,
      costPartial: !!r.cost_partial,
    }));
    const endpoints: ClientEndpointRow[] = endpointRaw.map((r) => ({
      client: r.client,
      position: r.position,
      taskId: r.task_id,
      taskName: r.task_name,
      url: r.url,
      createdDate: r.created_date,
      status: r.status,
      spaceName: r.space_name,
      folderName: r.folder_name,
      listName: r.list_name,
      sprintName: r.sprint_name,
    }));
    const hours: ClientHoursRow[] = hoursRaw.map((r) => ({
      client: r.client,
      totalHours: Number(r.total_hours),
      totalCostCents: Number(r.total_cost_cents),
    }));
    const groups: ClientGroupRow[] = groupRaw.map((r) => ({
      client: r.client,
      kind: r.kind,
      // A space/folder whose name never synced still has to be counted. A
      // space we have configured can still be named from its id; anything else
      // gets a generic label rather than being dropped.
      name:
        r.name ??
        (r.kind === 'space' ? (CONFIGURED_SPACE_NAMES.get(r.id ?? '') ?? 'Unnamed space') : 'Unnamed folder'),
      taskCount: Number(r.task_count),
    }));
    const sprints = sprintRaw.map((r) => ({ client: r.client, sprintCount: Number(r.sprint_count) }));
    const assignees: ClientAssigneeRow[] = assigneeRaw.map((r) => ({
      client: r.client,
      userId: r.user_id,
      userName: r.user_name,
      hours: Number(r.hours),
    }));

    return assembleClients({
      aggregates,
      endpoints,
      hours,
      groups,
      sprints,
      assignees,
      sort,
      assigneeLimit: ASSIGNEE_LIMIT,
    });
  }
}
