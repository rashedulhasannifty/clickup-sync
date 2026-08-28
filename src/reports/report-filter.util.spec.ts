import { buildTimeEntryWhere, csvList, NO_TASK_ID, taskSearchOr, timeEntryTaskSearchOr } from './report-filter.util';

/** The task column each clause targets, e.g. `{ taskName: {...} }` -> 'taskName'. */
const fieldsOf = (clauses: Record<string, unknown>[]) => clauses.map((c) => Object.keys(c)[0]).sort();

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
    const where = await buildTimeEntryWhere(prisma, { from, to, taskId: '86abc' });
    expect(where.taskId).toBe('86abc');
  });

  it('resolves the no-task sentinel to entries with a null taskId', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, taskId: NO_TASK_ID });
    expect(where.taskId).toBeNull();
  });

  it('leaves taskId unconstrained when the caller passes none', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to });
    expect(where.taskId).toBeUndefined();
  });

  it('windows on start_time inclusively at both ends', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to });
    expect(where.startTime).toEqual({ gte: from, lte: to });
  });

  it('splits comma-separated multi-select params into IN clauses', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, client: 'Acme, Beta', userId: 'u1,u2' });
    expect(where.userId).toEqual({ in: ['u1', 'u2'] });
    expect(clausesOf(where)).toContainEqual({ task: { client: { in: ['Acme', 'Beta'] } } });
  });

  it('lets missingOnly override an explicit status selection', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, status: 'COST_CALCULATED', missingOnly: 'true' });
    expect(where.status).toBe('NO_RATE_FOUND');
  });

  it("keeps task-less entries when archived='exclude'", async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, archived: 'exclude' });
    expect(clausesOf(where)).toContainEqual({ NOT: { task: { archived: true } } });
  });

  it('still constrains to an empty list when sprintStatus matches no sprints', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, sprintStatus: 'completed' });
    expect(clausesOf(where)).toContainEqual({ task: { listId: { in: [] } } });
  });

  it('filters chargeability on the entry column, not through the task join', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'true' });
    expect(clausesOf(where)).toContainEqual({ isChargeable: true });
    // The old task-join form must be gone: it cannot see a per-assignee rule.
    expect(JSON.stringify(clausesOf(where))).not.toContain('task');
  });

  it('keeps task-less entries chargeable', async () => {
    // The column defaults to true for an entry with no task, which is what the
    // old `NOT { task: { isChargeable: false } }` achieved by hand.
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'false' });
    expect(clausesOf(where)).toContainEqual({ isChargeable: false });
  });
});

describe('chargeable filter', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-02-01T00:00:00.000Z');
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as never;
  const clausesOf = (where: Record<string, unknown>) => (where.AND ?? []) as Record<string, unknown>[];

  it('keeps task-less entries on the chargeable side', async () => {
    // The column defaults to true, so an entry with no task still passes a
    // plain `{ isChargeable: true }` clause without any special-casing.
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'true' });
    expect(clausesOf(where)).toContainEqual({ isChargeable: true });
  });

  it('selects only entries flagged non-chargeable', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'false' });
    expect(clausesOf(where)).toContainEqual({ isChargeable: false });
  });

  it('no longer constrains the entry\'s own billable column', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'false' });
    expect(where.billable).toBeUndefined();
  });
});
