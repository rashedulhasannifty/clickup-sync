import { ClientsReportService } from './clients-report.service';
import type { AccessScope } from '../access/access-scope';

const unrestricted: AccessScope = { kind: 'unrestricted', canEdit: true };
// A member of a team that owns 'opt-a', leading nothing — sees the client, not its cost.
const scopedMember: AccessScope = {
  kind: 'scoped',
  clients: new Map([['opt-a', 'MEMBER']]),
  ledUserClickupIds: [],
  selfClickupId: null,
  ledTeamIds: [],
};

/** The five result sets the service fetches, keyed by a phrase unique to each
 *  query, so the stub does not depend on the order they are issued in. */
function makePrisma(sets: {
  aggregates?: unknown[];
  endpoints?: unknown[];
  hours?: unknown[];
  groups?: unknown[];
  sprints?: unknown[];
  assignees?: unknown[];
}) {
  const $queryRaw = jest.fn().mockImplementation((sql: { text?: string; strings?: string[] }) => {
    const text = sql.text ?? (sql.strings ?? []).join('?');
    if (text.includes('ROW_NUMBER')) return Promise.resolve(sets.endpoints ?? []);
    if (text.includes('duration_hours')) {
      if (text.includes('user_id')) return Promise.resolve(sets.assignees ?? []);
      return Promise.resolve(sets.hours ?? []);
    }
    if (text.includes('clickup_lists')) return Promise.resolve(sets.sprints ?? []);
    if (text.includes('folder_id')) return Promise.resolve(sets.groups ?? []);
    return Promise.resolve(sets.aggregates ?? []);
  });
  return { prisma: { $queryRaw } as any, $queryRaw };
}

const aggRow = {
  client: 'Acme',
  client_option_id: 'opt-a',
  task_count: BigInt(10),
  open_count: BigInt(3),
  closed_count: BigInt(7),
  has_led_cost: true,
  cost_partial: false,
};

describe('ClientsReportService.overview', () => {
  it('maps the raw rows into client cards', async () => {
    const { prisma } = makePrisma({
      aggregates: [aggRow],
      endpoints: [
        {
          client: 'Acme',
          position: 'first',
          task_id: 't1',
          task_name: 'Brand audit',
          url: 'https://app.clickup.com/t/t1',
          created_date: new Date('2025-03-12T00:00:00Z'),
          status: 'complete',
          space_name: 'R&D Apps',
          folder_name: 'Q1',
          list_name: 'Sprint 4',
          sprint_name: 'Sprint 4',
        },
      ],
      hours: [{ client: 'Acme', total_hours: 1204.5, total_cost_cents: 8431500 }],
      groups: [{ client: 'Acme', kind: 'space', name: 'R&D Apps', task_count: BigInt(100) }],
      // 79% of this workspace's tasks carry a space_id but no space_name, so the
      // rollup groups by id and resolves the name — a row whose name never got
      // synced still counts, under its id.
      
      sprints: [{ client: 'Acme', sprint_count: BigInt(31) }],
      assignees: [{ client: 'Acme', user_id: '9', user_name: 'Ahmad', hours: 310.25 }],
    });
    const svc = new ClientsReportService(prisma);

    const [row] = await svc.overview({}, unrestricted);

    expect(row).toMatchObject({
      client: 'Acme',
      clientOptionId: 'opt-a',
      taskCount: 10,
      openCount: 3,
      closedCount: 7,
      totalHours: 1204.5,
      totalCostAud: 84315,
      sprintCount: 31,
      assigneeOverflow: 0,
    });
    expect(row.firstTask).toMatchObject({ taskId: 't1', taskName: 'Brand audit', spaceName: 'R&D Apps' });
    expect(row.lastTask).toBeNull();
    expect(row.spaces).toEqual([{ name: 'R&D Apps', taskCount: 100 }]);
    expect(row.assignees).toEqual([{ userId: '9', userName: 'Ahmad', hours: 310.25 }]);
  });

  it('counts a space whose name never synced, rather than dropping its tasks', async () => {
    // The rollup groups by space_id and resolves MAX(space_name); a group with
    // no name at all still has to appear, or the footer under-reports.
    const { prisma } = makePrisma({
      aggregates: [{ ...aggRow, task_count: BigInt(106), open_count: BigInt(10), closed_count: BigInt(96) }],
      groups: [
        { client: 'Acme', kind: 'space', name: 'R&D Apps', task_count: BigInt(42) },
        { client: 'Acme', kind: 'space', name: null, task_count: BigInt(64) },
      ],
    });
    const svc = new ClientsReportService(prisma);

    const [row] = await svc.overview({}, unrestricted);

    expect(row.spaces).toEqual([
      { name: 'Unnamed space', taskCount: 64 },
      { name: 'R&D Apps', taskCount: 42 },
    ]);
    // 42 + 64 = the client's whole task count, nothing silently dropped.
    expect(row.spaces.reduce((s, x) => s + x.taskCount, 0)).toBe(row.taskCount);
  });

  it('names an unnamed space from the configured-space list when it can', async () => {
    // Space 3525433 is "Projects" in CLICKUP_SPACES. Every one of its tasks in
    // this workspace was synced without a space_name, so the id is the only
    // thing left to resolve it by — falling back to "Unnamed space" would put
    // a meaningless label on the largest group on the card.
    const { prisma } = makePrisma({
      aggregates: [aggRow],
      groups: [{ client: 'Acme', kind: 'space', id: '3525433', name: null, task_count: BigInt(64) }],
    });
    const svc = new ClientsReportService(prisma);

    const [row] = await svc.overview({}, unrestricted);

    expect(row.spaces).toEqual([{ name: 'Projects', taskCount: 64 }]);
  });

  it('falls back to a generic label for an unnamed space that is not configured', async () => {
    const { prisma } = makePrisma({
      aggregates: [aggRow],
      groups: [
        { client: 'Acme', kind: 'space', id: '999', name: null, task_count: BigInt(2) },
        { client: 'Acme', kind: 'folder', id: '888', name: null, task_count: BigInt(1) },
      ],
    });
    const svc = new ClientsReportService(prisma);

    const [row] = await svc.overview({}, unrestricted);

    expect(row.spaces).toEqual([{ name: 'Unnamed space', taskCount: 2 }]);
    expect(row.folders).toEqual([{ name: 'Unnamed folder', taskCount: 1 }]);
  });

  it('masks cost for a client the viewer does not lead, keeping hours', async () => {
    const { prisma } = makePrisma({
      aggregates: [{ ...aggRow, has_led_cost: false, cost_partial: true }],
      hours: [{ client: 'Acme', total_hours: 40, total_cost_cents: 0 }],
    });
    const svc = new ClientsReportService(prisma);

    const [row] = await svc.overview({}, scopedMember);

    expect(row.totalCostAud).toBeNull();
    expect(row.totalHours).toBe(40);
    expect(row.costPartial).toBe(true);
  });

  it('sorts by the requested key', async () => {
    const { prisma } = makePrisma({
      aggregates: [aggRow, { ...aggRow, client: 'Beta', client_option_id: 'opt-b', task_count: BigInt(99) }],
    });
    const svc = new ClientsReportService(prisma);

    expect((await svc.overview({ sort: 'tasks' }, unrestricted)).map((r) => r.client)).toEqual(['Beta', 'Acme']);
    expect((await svc.overview({ sort: 'name' }, unrestricted)).map((r) => r.client)).toEqual(['Acme', 'Beta']);
  });

  it('falls back to name order for an unrecognised sort', async () => {
    const { prisma } = makePrisma({
      aggregates: [{ ...aggRow, client: 'Zeta' }, { ...aggRow, client: 'Acme' }],
    });
    const svc = new ClientsReportService(prisma);
    expect((await svc.overview({ sort: 'bogus' as never }, unrestricted)).map((r) => r.client)).toEqual(['Acme', 'Zeta']);
  });

  it('returns nothing rather than failing when the viewer has no clients in scope', async () => {
    const { prisma } = makePrisma({});
    const svc = new ClientsReportService(prisma);
    expect(await svc.overview({}, scopedMember)).toEqual([]);
  });
});
