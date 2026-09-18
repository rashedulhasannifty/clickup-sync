import { buildTimeEntryWhere, csvList, NO_TASK_ID, taskSearchOr, timeEntryTaskSearchOr } from './report-filter.util';
import { buildTaskWhere } from './task-filter.util';
import { resolveScope } from '../access/access-scope';

/** The task column each clause targets, e.g. `{ taskName: {...} }` -> 'taskName'. */
const fieldsOf = (clauses: Record<string, unknown>[]) => clauses.map((c) => Object.keys(c)[0]).sort();

// Shared scopes for every `buildTimeEntryWhere`/`buildTaskWhere` call in this file:
// ADMIN is unrestricted (adds no clause), NONE is a scoped MEMBER of no team (an
// empty scope, which must pin to `{ in: [] }` rather than "no filter").
const ADMIN = resolveScope({
  role: 'ADMIN', scopingEnabled: true, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [],
});
const NONE = resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [],
});

describe('taskSearchOr', () => {
  it('searches every short task column the dashboard exposes as a filter', () => {
    expect(fieldsOf(taskSearchOr('x'))).toEqual(
      [
        'assigneesEmails',
        'assigneesNames',
        'client',
        'department',
        'executiveName',
        'listName',
        'spaceName',
        'sprintName',
        'taskId',
        'taskName',
      ].sort(),
    );
  });

  it('matches case-insensitively on a substring', () => {
    taskSearchOr('Clean').forEach((clause) => {
      expect(Object.values(clause)[0]).toEqual({ contains: 'Clean', mode: 'insensitive' });
    });
  });

  it('never searches description or raw JSON (ILIKE on those is expensive)', () => {
    const fields = fieldsOf(taskSearchOr('x'));
    expect(fields).not.toContain('description');
    expect(fields).not.toContain('markdownDescription');
    expect(fields).not.toContain('raw');
  });
});

describe('timeEntryTaskSearchOr', () => {
  it('reaches the task through the relation', () => {
    timeEntryTaskSearchOr('x').forEach((clause) => {
      expect(Object.keys(clause)).toEqual(['task']);
    });
  });

  it('covers EXACTLY the same task columns as the Tasks page', () => {
    // The regression this guards: Tasks searched ten task columns while Time
    // Entries searched only task.taskName, so the same query resolved a
    // different task set on each page — and a task renamed in ClickUp could
    // silently drop out of one page's results while staying in the other's.
    const viaRelation = timeEntryTaskSearchOr('x').map(
      (c) => Object.keys((c as { task: Record<string, unknown> }).task)[0],
    );
    expect(viaRelation.sort()).toEqual(fieldsOf(taskSearchOr('x')));
  });

  it('passes the query through unchanged', () => {
    const [first] = timeEntryTaskSearchOr('Clean') as { task: Record<string, unknown> }[];
    expect(Object.values(first.task)[0]).toEqual({ contains: 'Clean', mode: 'insensitive' });
  });
});

describe('csvList', () => {
  it('treats absent, empty, and commas-only as no selection', () => {
    expect(csvList(undefined)).toBeUndefined();
    expect(csvList('')).toBeUndefined();
    expect(csvList(' , , ')).toBeUndefined();
  });

  it('trims, drops blanks, and de-duplicates', () => {
    expect(csvList(' Acme , Beta ,, Acme ')).toEqual(['Acme', 'Beta']);
  });

  it('parses a pre-existing single-value deep-link as a one-element list', () => {
    expect(csvList('Acme')).toEqual(['Acme']);
  });
});

describe('buildTimeEntryWhere', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-02-01T00:00:00.000Z');
  /** `sprintStatusListIds` is the only part of the builder that touches the DB. */
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as never;
  const clausesOf = (where: Record<string, unknown>) =>
    (where.AND ?? []) as Record<string, unknown>[];

  it('matches taskId exactly rather than by substring', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, taskId: '86abc' }, ADMIN);
    expect(where.taskId).toBe('86abc');
  });

  it('resolves the no-task sentinel to entries with a null taskId', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, taskId: NO_TASK_ID }, ADMIN);
    expect(where.taskId).toBeNull();
  });

  it('leaves taskId unconstrained when the caller passes none', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to }, ADMIN);
    expect(where.taskId).toBeUndefined();
  });

  it('windows on start_time inclusively at both ends', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to }, ADMIN);
    expect(where.startTime).toEqual({ gte: from, lte: to });
  });

  it('splits comma-separated multi-select params into IN clauses', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, client: 'Acme, Beta', userId: 'u1,u2' }, ADMIN);
    expect(where.userId).toEqual({ in: ['u1', 'u2'] });
    expect(clausesOf(where)).toContainEqual({ task: { client: { in: ['Acme', 'Beta'] } } });
  });

  it('filters sub-projects through the task relation with hasSome (exact, any-of)', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, subProject: 'Mobile App,Website' }, ADMIN);
    expect(clausesOf(where)).toContainEqual({ task: { subProjects: { hasSome: ['Mobile App', 'Website'] } } });
  });

  it('adds no sub-project clause when none is selected', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, subProject: '' }, ADMIN);
    expect(JSON.stringify(where)).not.toContain('subProjects');
  });

  it('lets missingOnly override an explicit status selection', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, status: 'COST_CALCULATED', missingOnly: 'true' }, ADMIN);
    expect(where.status).toBe('NO_RATE_FOUND');
  });

  it("keeps task-less entries when archived='exclude'", async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, archived: 'exclude' }, ADMIN);
    expect(clausesOf(where)).toContainEqual({ NOT: { task: { archived: true } } });
  });

  it('still constrains to an empty list when sprintStatus matches no sprints', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, sprintStatus: 'completed' }, ADMIN);
    expect(clausesOf(where)).toContainEqual({ task: { listId: { in: [] } } });
  });
});

// Everything asserting on the `chargeable` query param lives in this one
// block (it used to be split across two overlapping describes: one here and
// a near-duplicate under `buildTimeEntryWhere` above).
describe('chargeable filter', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-02-01T00:00:00.000Z');
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as never;
  const clausesOf = (where: Record<string, unknown>) => (where.AND ?? []) as Record<string, unknown>[];

  it('filters chargeability on the entry column, not through the task join', async () => {
    // The column defaults to true, so this plain `{ isChargeable: true }`
    // clause also keeps a task-less entry chargeable without any special-
    // casing — that's what the old `NOT { task: { isChargeable: false } }`
    // form achieved by hand, and why the old task-join form must be gone: it
    // cannot see a per-assignee rule. The task-less default itself is a DB
    // column default (`prisma/schema.prisma`, `isChargeable @default(true)`),
    // asserted at the resolver level by `resolveChargeability({})` in
    // `chargeability.spec.ts` — a mocked `where` object here can't observe
    // what the database does with it.
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'true' }, ADMIN);
    expect(clausesOf(where)).toContainEqual({ isChargeable: true });
    expect(JSON.stringify(clausesOf(where))).not.toContain('task');
  });

  it('selects only entries flagged non-chargeable', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'false' }, ADMIN);
    expect(clausesOf(where)).toContainEqual({ isChargeable: false });
  });

  it('no longer constrains the entry\'s own billable column', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'false' }, ADMIN);
    expect(where.billable).toBeUndefined();
  });
});

describe('buildTimeEntryWhere scope', () => {
  const win = { from: new Date('2026-01-01'), to: new Date('2026-02-01') };

  it('unrestricted adds no scope clause', async () => {
    const w = await buildTimeEntryWhere({ $queryRaw: jest.fn().mockResolvedValue([]) } as never, win, ADMIN);
    expect(JSON.stringify(w)).not.toContain('scopeClientOptionId');
  });

  it('empty scope pins to an empty id list (matches nothing)', async () => {
    const w = await buildTimeEntryWhere({ $queryRaw: jest.fn().mockResolvedValue([]) } as never, win, NONE);
    expect(w.AND).toContainEqual({ task: { scopeClientOptionId: { in: [] } } });
  });
});

describe('buildTaskWhere scope', () => {
  it('empty scope pins to an empty id list', async () => {
    const w = await buildTaskWhere({ $queryRaw: jest.fn().mockResolvedValue([]) } as never, {}, NONE);
    expect(w.AND).toContainEqual({ scopeClientOptionId: { in: [] } });
  });
});
