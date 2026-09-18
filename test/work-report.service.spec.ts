import { WorkReportService } from '../src/reports/work-report.service';
import { resolveScope } from '../src/access/access-scope';

const dec = (n: number) => ({ toNumber: () => n });

/** A Prisma `groupBy` row for time entries, as the service receives it. */
function grp(taskId: string | null, over: Partial<{ userId: string; isChargeable: boolean; status: string; count: number; hours: number; cost: bigint }> = {}) {
  return {
    taskId, userId: over.userId ?? 'u1', userName: 'Rashedul', status: over.status ?? 'COST_CALCULATED',
    currency: 'USD', isChargeable: over.isChargeable ?? true,
    _count: over.count ?? 1,
    _sum: { durationHours: dec(over.hours ?? 1), costCents: over.cost ?? 100n },
    _max: { startTime: new Date('2026-09-10T00:00:00Z') },
  };
}

function cand(taskId: string, over: Partial<{ updatedDate: Date | null; isDeleted: boolean; isChargeable: boolean; taskName: string; scopeClientOptionId: string | null }> = {}) {
  return {
    taskId, taskName: over.taskName ?? taskId, updatedDate: over.updatedDate ?? new Date('2026-09-05T00:00:00Z'),
    isDeleted: over.isDeleted ?? false, isChargeable: over.isChargeable ?? true,
    scopeClientOptionId: over.scopeClientOptionId ?? null,
  };
}

/**
 * Call order inside the service is fixed, so the mocks answer positionally:
 * clickupTimeEntry.groupBy -> [0] in-range entries, [1] all-time counts (only when needed);
 * clickupTask.findMany     -> [0] candidates, [1] full columns for the page.
 */
function makePrisma(opts: {
  groups?: unknown[]; candidates?: unknown[]; pageTasks?: unknown[]; counts?: unknown[]; rules?: unknown[];
}) {
  const groupBy = jest.fn()
    .mockResolvedValueOnce(opts.groups ?? [])
    .mockResolvedValue(opts.counts ?? []);
  const taskFind = jest.fn()
    .mockResolvedValueOnce(opts.candidates ?? [])
    .mockImplementation((args: { where: { taskId: { in: string[] } } }) =>
      Promise.resolve((opts.pageTasks ?? []).filter((t) => args.where.taskId.in.includes((t as { taskId: string }).taskId))));
  return {
    clickupTimeEntry: { groupBy, findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    clickupTask: { findMany: taskFind },
    taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue(opts.rules ?? []) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as any;
}

const base = { from: '2026-09-01T00:00:00Z', to: '2026-09-14T23:59:59Z' };

describe('WorkReportService.work', () => {
  it('lists updated-only, logged-only and both; totals cover every row', async () => {
    const prisma = makePrisma({
      groups: [grp('t2', { hours: 2 }), grp('t3', { hours: 3 })],
      candidates: [cand('t1'), cand('t2', { updatedDate: new Date('2026-08-01T00:00:00Z') }), cand('t3')],
      pageTasks: [cand('t1'), cand('t2'), cand('t3')],
    });
    const res = await new WorkReportService(prisma).work({ ...base });
    const byId = Object.fromEntries(res.items.map((r) => [r.taskId, r]));
    expect(byId.t1.inRangeBecause).toBe('updated');
    expect(byId.t1.logged).toBeNull();
    expect(byId.t2.inRangeBecause).toBe('logged');
    expect(byId.t3.inRangeBecause).toBe('both');
    expect(res.total).toBe(3);
    expect(res.totals.hours).toBe(5);
    // Candidate query: task filters AND (updated in range & not deleted OR has entries).
    const where = prisma.clickupTask.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"taskId":{"in":["t2","t3"]}');
    expect(JSON.stringify(where)).toContain('"isDeleted":false');
  });

  it('with an entry filter, only tasks with matching entries are candidates', async () => {
    const prisma = makePrisma({ groups: [grp('t2')], candidates: [cand('t2')], pageTasks: [cand('t2')] });
    await new WorkReportService(prisma).work({ ...base, loggedBy: 'u1' });
    const where = prisma.clickupTask.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('updatedDate');
    expect(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where.userId).toEqual({ in: ['u1'] });
  });

  it('space filter: entry side scopes by the task space without excluding deleted tasks', async () => {
    const prisma = makePrisma({ groups: [grp('t9')], candidates: [cand('t9', { isDeleted: true })], pageTasks: [cand('t9', { isDeleted: true })] });
    const res = await new WorkReportService(prisma).work({ ...base, spaceId: 's1' });
    const entryWhere = JSON.stringify(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where);
    expect(entryWhere).toContain('"spaceId":"s1"');
    expect(entryWhere).not.toContain('"isDeleted":false');
    expect(res.items[0].isDeleted).toBe(true);
    expect(res.totals.hours).toBe(1);
  });

  it('archived defaults to include on BOTH sides', async () => {
    const prisma = makePrisma({});
    await new WorkReportService(prisma).work({ ...base });
    expect(JSON.stringify(prisma.clickupTask.findMany.mock.calls[0][0].where)).not.toContain('"archived"');
    expect(JSON.stringify(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where)).not.toContain('archived');
  });

  it('chargeable=partial is applied BEFORE paging (total and every page agree)', async () => {
    const groups = [
      grp('p1', { isChargeable: true }), grp('p1', { userId: 'u2', isChargeable: false }),
      grp('p2', { isChargeable: true }), grp('p2', { userId: 'u2', isChargeable: false }),
      grp('p3', { isChargeable: true }), grp('p3', { userId: 'u2', isChargeable: false }),
      grp('y1', { isChargeable: true }), grp('n1', { isChargeable: false }),
    ];
    const ids = ['p1', 'p2', 'p3', 'y1', 'n1'];
    const mk = () => makePrisma({ groups, candidates: ids.map((i) => cand(i)), pageTasks: ids.map((i) => cand(i)) });
    const page1 = await new WorkReportService(mk()).work({ ...base, chargeable: 'partial', limit: 2, offset: 0 });
    const page2 = await new WorkReportService(mk()).work({ ...base, chargeable: 'partial', limit: 2, offset: 2 });
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    expect([...page1.items, ...page2.items].map((r) => r.chargeable)).toEqual(['partial', 'partial', 'partial']);
    expect(page1.totals.entries).toBe(6);
  });

  it('chargeable=constructor is not an own property of PILL_FOR and behaves like no filter', async () => {
    const prisma = makePrisma({
      groups: [grp('t1'), grp('t2')],
      candidates: [cand('t1'), cand('t2')],
      pageTasks: [cand('t1'), cand('t2')],
    });
    const res = await new WorkReportService(prisma).work({ ...base, chargeable: 'constructor' });
    expect(res.items.map((r) => r.taskId).sort()).toEqual(['t1', 't2']);
    expect(res.total).toBe(2);
  });

  it('updated-only row uses the task inputs: every entry overridden against the flag -> partial', async () => {
    const prisma = makePrisma({
      candidates: [cand('t1', { isChargeable: true })],
      pageTasks: [cand('t1')],
      counts: [{ taskId: 't1', isChargeable: false, _count: 2 }],
    });
    const res = await new WorkReportService(prisma).work({ ...base });
    expect(res.items[0]).toMatchObject({ chargeable: 'partial', chargeableSource: 'task' });
  });

  it('"(No task)" row appears only when no task-only filter is set, with the full item shape defaulted', async () => {
    const mk = () => makePrisma({ groups: [grp(null)], candidates: [], pageTasks: [] });
    const plain = await new WorkReportService(mk()).work({ ...base });
    expect(plain.items.map((r) => r.taskId)).toEqual(['__none__']);
    // No `clickup_tasks` row backs this synthetic id, so every spec-declared
    // task field must still come back with an explicit default rather than
    // `undefined` — a frontend built against the non-nullable `subProjects`/
    // `archived` types would crash calling `.map`/reading a boolean off `undefined`.
    expect(plain.items[0]).toMatchObject({
      taskId: '__none__',
      taskName: null,
      parentTaskId: null,
      status: null,
      statusColor: null,
      priority: null,
      assigneesNames: null,
      client: null,
      subProjects: [],
      listName: null,
      sprintName: null,
      sprintPoints: null,
      updatedDate: null,
      archived: false,
      isDeleted: false,
      url: null,
    });
    const filtered = await new WorkReportService(mk()).work({ ...base, status: 'complete' });
    expect(filtered.items).toEqual([]);
  });

  it('sorts logged desc by default and pages after sorting', async () => {
    const prisma = makePrisma({
      groups: [grp('a', { hours: 1 }), grp('b', { hours: 5 })],
      candidates: [cand('a'), cand('b')], pageTasks: [cand('a'), cand('b')],
    });
    const res = await new WorkReportService(prisma).work({ ...base, limit: 1 });
    expect(res.items.map((r) => r.taskId)).toEqual(['b']);
    expect(res.totals.hours).toBe(6);
  });

  it('clamps a negative limit/offset instead of passing them through to slice', async () => {
    const prisma = makePrisma({
      groups: [grp('a', { hours: 1 }), grp('b', { hours: 5 })],
      candidates: [cand('a'), cand('b')], pageTasks: [cand('a'), cand('b')],
    });
    const res = await new WorkReportService(prisma).work({ ...base, limit: -5, offset: -10 });
    expect(res.limit).toBe(1);
    expect(res.offset).toBe(0);
    // Same result as limit:1/offset:0 against the same sorted (logged desc) rows.
    expect(res.items.map((r) => r.taskId)).toEqual(['b']);
  });

  it('converts the page task lifetime BigInt columns to hours', async () => {
    const prisma = makePrisma({
      groups: [grp('t1')],
      candidates: [cand('t1')],
      pageTasks: [{ ...cand('t1'), timeEstimate: 7_200_000n, timeSpent: 3_600_000n }],
    });
    const res = await new WorkReportService(prisma).work({ ...base });
    expect(res.items[0]).toMatchObject({ timeEstimateHours: 2, lifetimeSpentHours: 1 });
  });
});

describe('WorkReportService.work (access scope)', () => {
  // A MEMBER of exactly zero teams: `visibleClientIds` resolves to `[]`, so
  // the candidate query must pin to an empty IN list (matches nothing) rather
  // than fall through to "no filter".
  const NONE = resolveScope({
    role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
    memberships: [], teamClients: [], teamMembers: [],
  });
  // LEAD of team A (client 'acme'), plain MEMBER of team B (client 'bolt').
  const LEAD_A_MEMBER_B = resolveScope({
    role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
    memberships: [
      { teamId: 'A', role: 'LEAD' },
      { teamId: 'B', role: 'MEMBER' },
    ],
    teamClients: [
      { teamId: 'A', optionId: 'acme' },
      { teamId: 'B', optionId: 'bolt' },
    ],
    teamMembers: [],
  });

  it('an empty scope pins the candidate query to an empty id list', async () => {
    const prisma = makePrisma({});
    await new WorkReportService(prisma).work({ ...base, scope: NONE });
    const where = prisma.clickupTask.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"scopeClientOptionId":{"in":[]}');
  });

  it('masks logged.costCents on rows outside the clients the viewer LEADS; totals sum only visible cost and flag costPartial', async () => {
    const prisma = makePrisma({
      groups: [grp('t-acme', { cost: 500n }), grp('t-bolt', { cost: 700n })],
      candidates: [cand('t-acme', { scopeClientOptionId: 'acme' }), cand('t-bolt', { scopeClientOptionId: 'bolt' })],
      pageTasks: [cand('t-acme', { scopeClientOptionId: 'acme' }), cand('t-bolt', { scopeClientOptionId: 'bolt' })],
    });
    const res = await new WorkReportService(prisma).work({ ...base, scope: LEAD_A_MEMBER_B });
    const byId = Object.fromEntries(res.items.map((r: any) => [r.taskId, r]));
    expect(byId['t-acme'].logged.costCents).toBe(500);
    expect(byId['t-bolt'].logged.costCents).toBeNull();
    expect(res.totals.costCents).toBe(500);
    expect((res.totals as any).costPartial).toBe(true);
  });
});

describe('WorkReportService.workEntries', () => {
  it('uses the same entry where as the aggregation, limited to the listed tasks', async () => {
    const prisma = makePrisma({ groups: [grp('t2')], candidates: [cand('t2')] });
    await new WorkReportService(prisma).workEntries({ ...base, loggedBy: 'u1' });
    const aggWhere = prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where;
    const listWhere = prisma.clickupTimeEntry.findMany.mock.calls[0][0].where;
    expect(listWhere.AND[0]).toEqual(aggWhere);
    expect(listWhere.AND[1]).toEqual({ OR: [{ taskId: { in: ['t2'] } }] });
  });

  it('maps a non-empty result: Decimal/BigInt conversions, taskName, truncated:false', async () => {
    const prisma = makePrisma({ groups: [grp('t2')], candidates: [cand('t2')] });
    const entries = [
      {
        timeEntryId: 'e1', taskId: 't2', userId: 'u1', userName: 'Rashedul', userEmail: 'r@x.com',
        startTime: new Date('2026-09-10T00:00:00Z'), endTime: null, durationHours: dec(2.5),
        hourlyRateCents: 1500n, costCents: 3750n, currency: 'USD', status: 'COST_CALCULATED',
        isChargeable: true, chargeableOverride: null, description: 'work', task: { taskName: 't2 name' },
      },
      {
        timeEntryId: 'e2', taskId: 't2', userId: 'u1', userName: 'Rashedul', userEmail: 'r@x.com',
        startTime: new Date('2026-09-11T00:00:00Z'), endTime: null, durationHours: dec(1),
        hourlyRateCents: 1500n, costCents: 1500n, currency: 'USD', status: 'COST_CALCULATED',
        isChargeable: false, chargeableOverride: false, description: null, task: { taskName: 't2 name' },
      },
    ];
    prisma.clickupTimeEntry.findMany.mockResolvedValue(entries);
    const res = await new WorkReportService(prisma).workEntries({ ...base });
    expect(res.truncated).toBe(false);
    expect(res.items).toEqual([
      {
        timeEntryId: 'e1', taskId: 't2', taskName: 't2 name', userId: 'u1', userName: 'Rashedul',
        userEmail: 'r@x.com', startTime: entries[0].startTime, endTime: null, durationHours: 2.5,
        hourlyRateCents: 1500, costCents: 3750, currency: 'USD', status: 'COST_CALCULATED',
        chargeable: true, chargeableOverride: null, description: 'work',
      },
      {
        timeEntryId: 'e2', taskId: 't2', taskName: 't2 name', userId: 'u1', userName: 'Rashedul',
        userEmail: 'r@x.com', startTime: entries[1].startTime, endTime: null, durationHours: 1,
        hourlyRateCents: 1500, costCents: 1500, currency: 'USD', status: 'COST_CALCULATED',
        chargeable: false, chargeableOverride: false, description: null,
      },
    ]);
  });

  it('over the 5000 cap returns no entries and truncated:true (never a partial sheet)', async () => {
    const prisma = makePrisma({ groups: [grp('t2')], candidates: [cand('t2')] });
    const entry = {
      timeEntryId: 'e', taskId: 't2', userId: 'u1', userName: 'R', userEmail: null,
      startTime: new Date(), endTime: null, durationHours: dec(1), hourlyRateCents: 0n,
      costCents: 0n, currency: 'USD', status: 'COST_CALCULATED', isChargeable: true,
      chargeableOverride: null, description: null, task: { taskName: 't2' },
    };
    prisma.clickupTimeEntry.findMany.mockResolvedValue(Array.from({ length: 5001 }, (_, i) => ({ ...entry, timeEntryId: `e${i}` })));
    const res = await new WorkReportService(prisma).workEntries({ ...base });
    expect(res).toEqual({ items: [], truncated: true });
    expect(prisma.clickupTimeEntry.findMany.mock.calls[0][0].take).toBe(5001);
  });

  it('masks hourlyRateCents/costCents on entries outside the clients the viewer LEADS', async () => {
    // LEAD of team A (client 'acme'), plain MEMBER of team B (client 'bolt').
    const LEAD_A_MEMBER_B = resolveScope({
      role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
      memberships: [
        { teamId: 'A', role: 'LEAD' },
        { teamId: 'B', role: 'MEMBER' },
      ],
      teamClients: [
        { teamId: 'A', optionId: 'acme' },
        { teamId: 'B', optionId: 'bolt' },
      ],
      teamMembers: [],
    });
    const prisma = makePrisma({ groups: [grp('t-acme'), grp('t-bolt')], candidates: [cand('t-acme'), cand('t-bolt')] });
    prisma.clickupTimeEntry.findMany.mockResolvedValue([
      {
        timeEntryId: 'e-acme', taskId: 't-acme', userId: 'u1', userName: 'A', userEmail: null,
        startTime: new Date(), endTime: null, durationHours: dec(1), hourlyRateCents: 1500n,
        costCents: 1500n, currency: 'USD', status: 'COST_CALCULATED', isChargeable: true,
        chargeableOverride: null, description: null, task: { taskName: 'A', scopeClientOptionId: 'acme' },
      },
      {
        timeEntryId: 'e-bolt', taskId: 't-bolt', userId: 'u1', userName: 'A', userEmail: null,
        startTime: new Date(), endTime: null, durationHours: dec(1), hourlyRateCents: 1500n,
        costCents: 1500n, currency: 'USD', status: 'COST_CALCULATED', isChargeable: true,
        chargeableOverride: null, description: null, task: { taskName: 'B', scopeClientOptionId: 'bolt' },
      },
    ]);
    const res = await new WorkReportService(prisma).workEntries({ ...base, scope: LEAD_A_MEMBER_B });
    const acme = res.items.find((e) => e.timeEntryId === 'e-acme')!;
    const bolt = res.items.find((e) => e.timeEntryId === 'e-bolt')!;
    expect(acme.hourlyRateCents).toBe(1500);
    expect(acme.costCents).toBe(1500);
    expect(bolt.hourlyRateCents).toBeNull();
    expect(bolt.costCents).toBeNull();
    // Non-cost fields survive the mask.
    expect(bolt.durationHours).toBe(1);
  });
});
