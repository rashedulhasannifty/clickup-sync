/**
 * Pure assembly for `GET /reports/clients/overview`. The service runs the
 * scoped SQL; everything that decides what a client row *says* — the first and
 * last task, cost masking, the space/folder/assignee rollups, sort — lives
 * here, Prisma-free, so it is tested directly.
 */

export type ClientSort = 'name' | 'tasks' | 'hours' | 'recent';

/** Per-client task aggregate. `hasLedCost` is computed over TASKS, not entries,
 *  so a client the viewer leads that has no tracked time still reports a real
 *  zero rather than a masked null. */
export interface ClientAggRow {
  client: string;
  clientOptionId: string | null;
  taskCount: number;
  openCount: number;
  closedCount: number;
  hasLedCost: boolean;
  costPartial: boolean;
}

export interface ClientEndpointRow {
  client: string;
  position: 'first' | 'last';
  taskId: string;
  taskName: string;
  url: string | null;
  createdDate: Date | null;
  status: string | null;
  spaceName: string | null;
  folderName: string | null;
  listName: string | null;
  sprintName: string | null;
}

export interface ClientHoursRow {
  client: string;
  totalHours: number;
  /** Already summed over LEAD-visible rows only — see `leadScopeSql`. */
  totalCostCents: number;
}

export interface ClientGroupRow {
  client: string;
  kind: 'space' | 'folder';
  name: string;
  taskCount: number;
}

export interface ClientSprintRow {
  client: string;
  sprintCount: number;
}

export interface ClientAssigneeRow {
  client: string;
  userId: string | null;
  userName: string | null;
  hours: number;
}

export interface ClientEndpointTask {
  taskId: string;
  taskName: string;
  url: string | null;
  createdDate: Date | null;
  status: string | null;
  spaceName: string | null;
  folderName: string | null;
  listName: string | null;
  sprintName: string | null;
}

export interface ClientOverview {
  client: string;
  clientOptionId: string | null;
  taskCount: number;
  openCount: number;
  closedCount: number;
  totalHours: number;
  /** Null — never zero — when the viewer leads nothing in this client. */
  totalCostAud: number | null;
  costPartial: boolean;
  firstTask: ClientEndpointTask | null;
  lastTask: ClientEndpointTask | null;
  spaces: { name: string; taskCount: number }[];
  folders: { name: string; taskCount: number }[];
  sprintCount: number;
  assignees: { userId: string | null; userName: string | null; hours: number }[];
  assigneeOverflow: number;
}

const DEFAULT_ASSIGNEE_LIMIT = 6;

function groupByClient<T extends { client: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = out.get(row.client);
    if (bucket) bucket.push(row);
    else out.set(row.client, [row]);
  }
  return out;
}

function toTask(row: ClientEndpointRow | undefined): ClientEndpointTask | null {
  if (!row) return null;
  const { client: _client, position: _position, ...task } = row;
  return task;
}

function byTaskCountDesc(a: { taskCount: number }, b: { taskCount: number }) {
  return b.taskCount - a.taskCount;
}

export function assembleClients(input: {
  aggregates: ClientAggRow[];
  endpoints: ClientEndpointRow[];
  hours: ClientHoursRow[];
  groups: ClientGroupRow[];
  sprints: ClientSprintRow[];
  assignees: ClientAssigneeRow[];
  sort: ClientSort;
  assigneeLimit?: number;
}): ClientOverview[] {
  const limit = input.assigneeLimit ?? DEFAULT_ASSIGNEE_LIMIT;
  const endpoints = groupByClient(input.endpoints);
  const hours = new Map(input.hours.map((h) => [h.client, h]));
  const groups = groupByClient(input.groups);
  const sprints = new Map(input.sprints.map((s) => [s.client, s.sprintCount]));
  const assignees = groupByClient(input.assignees);

  const rows: ClientOverview[] = input.aggregates.map((a) => {
    const ends = endpoints.get(a.client) ?? [];
    const clientGroups = groups.get(a.client) ?? [];
    const ranked = (assignees.get(a.client) ?? []).slice().sort((x, y) => y.hours - x.hours);
    const totals = hours.get(a.client);

    return {
      client: a.client,
      clientOptionId: a.clientOptionId,
      taskCount: a.taskCount,
      openCount: a.openCount,
      closedCount: a.closedCount,
      totalHours: totals?.totalHours ?? 0,
      totalCostAud: a.hasLedCost ? (totals?.totalCostCents ?? 0) / 100 : null,
      costPartial: a.costPartial,
      firstTask: toTask(ends.find((e) => e.position === 'first')),
      lastTask: toTask(ends.find((e) => e.position === 'last')),
      spaces: clientGroups.filter((g) => g.kind === 'space').map((g) => ({ name: g.name, taskCount: g.taskCount })).sort(byTaskCountDesc),
      folders: clientGroups.filter((g) => g.kind === 'folder').map((g) => ({ name: g.name, taskCount: g.taskCount })).sort(byTaskCountDesc),
      sprintCount: sprints.get(a.client) ?? 0,
      assignees: ranked.slice(0, limit).map((r) => ({ userId: r.userId, userName: r.userName, hours: r.hours })),
      assigneeOverflow: Math.max(0, ranked.length - limit),
    };
  });

  return sortClients(rows, input.sort);
}

function sortClients(rows: ClientOverview[], sort: ClientSort): ClientOverview[] {
  const sorted = rows.slice();
  switch (sort) {
    case 'tasks':
      sorted.sort((a, b) => b.taskCount - a.taskCount || a.client.localeCompare(b.client));
      break;
    case 'hours':
      sorted.sort((a, b) => b.totalHours - a.totalHours || a.client.localeCompare(b.client));
      break;
    case 'recent':
      // A client whose tasks carry no created date has no "most recent" to sort
      // by; it goes last rather than pretending to be the oldest.
      sorted.sort((a, b) => {
        const at = a.lastTask?.createdDate?.getTime();
        const bt = b.lastTask?.createdDate?.getTime();
        if (at === undefined && bt === undefined) return a.client.localeCompare(b.client);
        if (at === undefined) return 1;
        if (bt === undefined) return -1;
        return bt - at || a.client.localeCompare(b.client);
      });
      break;
    default:
      sorted.sort((a, b) => a.client.localeCompare(b.client));
  }
  return sorted;
}
