import {
  assembleClients,
  type ClientAggRow,
  type ClientEndpointRow,
  type ClientHoursRow,
  type ClientGroupRow,
  type ClientSprintRow,
  type ClientAssigneeRow,
} from './clients.assemble';

const agg = (over: Partial<ClientAggRow> = {}): ClientAggRow => ({
  client: 'Acme',
  clientOptionId: 'opt-a',
  taskCount: 10,
  openCount: 3,
  closedCount: 7,
  hasLedCost: true,
  costPartial: false,
  ...over,
});

const endpoint = (over: Partial<ClientEndpointRow> = {}): ClientEndpointRow => ({
  client: 'Acme',
  position: 'first',
  taskId: 't1',
  taskName: 'Brand audit',
  url: 'https://app.clickup.com/t/t1',
  createdDate: new Date('2025-03-12T00:00:00Z'),
  status: 'complete',
  spaceName: 'R&D Apps',
  folderName: 'Q1',
  listName: 'Sprint 4',
  sprintName: 'Sprint 4',
  ...over,
});

const input = (over: Partial<Parameters<typeof assembleClients>[0]> = {}) => ({
  aggregates: [agg()],
  endpoints: [] as ClientEndpointRow[],
  hours: [] as ClientHoursRow[],
  groups: [] as ClientGroupRow[],
  sprints: [] as ClientSprintRow[],
  assignees: [] as ClientAssigneeRow[],
  sort: 'name' as const,
  ...over,
});

describe('assembleClients', () => {
  it('joins the first and last task onto their client', () => {
    const [row] = assembleClients(
      input({
        endpoints: [
          endpoint(),
          endpoint({
            position: 'last',
            taskId: 't9',
            taskName: 'Landing page v3',
            createdDate: new Date('2026-09-18T00:00:00Z'),
            spaceName: 'Digital Marketing',
            folderName: 'Web',
            listName: 'Sprint 31',
            sprintName: 'Sprint 31',
          }),
        ],
      }),
    );
    expect(row.client).toBe('Acme');
    expect(row.firstTask).toMatchObject({ taskId: 't1', taskName: 'Brand audit', spaceName: 'R&D Apps', sprintName: 'Sprint 4' });
    expect(row.lastTask).toMatchObject({ taskId: 't9', spaceName: 'Digital Marketing', listName: 'Sprint 31' });
  });

  it('leaves both endpoints null when no task has a created date', () => {
    const [row] = assembleClients(input({ endpoints: [] }));
    expect(row.firstTask).toBeNull();
    expect(row.lastTask).toBeNull();
    expect(row.taskCount).toBe(10);
  });

  it('reports the same task as first and last for a single-task client', () => {
    const [row] = assembleClients(
      input({
        aggregates: [agg({ taskCount: 1, openCount: 1, closedCount: 0 })],
        endpoints: [endpoint(), endpoint({ position: 'last' })],
      }),
    );
    expect(row.firstTask?.taskId).toBe('t1');
    expect(row.lastTask?.taskId).toBe('t1');
  });

  it('converts cost cents to a currency amount for a client the viewer leads', () => {
    const [row] = assembleClients(input({ hours: [{ client: 'Acme', totalHours: 1204.5, totalCostCents: 8431500 }] }));
    expect(row.totalHours).toBe(1204.5);
    expect(row.totalCostAud).toBe(84315);
    expect(row.costPartial).toBe(false);
  });

  it('nulls cost — never zeroes it — for a client the viewer does not lead', () => {
    const [row] = assembleClients(
      input({
        aggregates: [agg({ hasLedCost: false })],
        hours: [{ client: 'Acme', totalHours: 1204.5, totalCostCents: 0 }],
      }),
    );
    expect(row.totalCostAud).toBeNull();
    // Hours are never masked.
    expect(row.totalHours).toBe(1204.5);
  });

  it('carries the partial-cost flag through', () => {
    const [row] = assembleClients({ ...input({ aggregates: [agg({ costPartial: true })] }) });
    expect(row.costPartial).toBe(true);
  });

  it('shows zero — not null — cost for a led client with no tracked time', () => {
    const [row] = assembleClients(input({ hours: [] }));
    expect(row.totalHours).toBe(0);
    expect(row.totalCostAud).toBe(0);
  });

  it('splits spaces from folders and orders each by task count', () => {
    const [row] = assembleClients(
      input({
        groups: [
          { client: 'Acme', kind: 'space', name: 'R&D Apps', taskCount: 100 },
          { client: 'Acme', kind: 'space', name: 'Projects', taskCount: 300 },
          { client: 'Acme', kind: 'folder', name: 'Q1', taskCount: 120 },
        ],
        sprints: [{ client: 'Acme', sprintCount: 31 }],
      }),
    );
    expect(row.spaces).toEqual([
      { name: 'Projects', taskCount: 300 },
      { name: 'R&D Apps', taskCount: 100 },
    ]);
    expect(row.folders).toEqual([{ name: 'Q1', taskCount: 120 }]);
    expect(row.sprintCount).toBe(31);
  });

  it('defaults the sprint count to zero when the client has no sprints', () => {
    const [row] = assembleClients(input());
    expect(row.sprintCount).toBe(0);
    expect(row.spaces).toEqual([]);
  });

  it('ranks assignees by hours and reports the overflow beyond the limit', () => {
    const [row] = assembleClients(
      input({
        assignees: [
          { client: 'Acme', userId: '1', userName: 'Ahmad', hours: 10 },
          { client: 'Acme', userId: '2', userName: 'Chisty', hours: 90 },
          { client: 'Acme', userId: '3', userName: 'Fahim', hours: 50 },
        ],
        assigneeLimit: 2,
      }),
    );
    expect(row.assignees.map((a) => a.userName)).toEqual(['Chisty', 'Fahim']);
    expect(row.assigneeOverflow).toBe(1);
  });

  it('reports no overflow when everyone fits', () => {
    const [row] = assembleClients(
      input({ assignees: [{ client: 'Acme', userId: '1', userName: 'Ahmad', hours: 10 }], assigneeLimit: 6 }),
    );
    expect(row.assigneeOverflow).toBe(0);
  });

  it('keeps each client’s rows to itself', () => {
    const rows = assembleClients(
      input({
        aggregates: [agg(), agg({ client: 'Beta', clientOptionId: 'opt-b', taskCount: 2 })],
        endpoints: [endpoint(), endpoint({ client: 'Beta', taskId: 'b1', taskName: 'Kickoff' })],
        assignees: [{ client: 'Beta', userId: '7', userName: 'Sayem', hours: 4 }],
      }),
    );
    const acme = rows.find((r) => r.client === 'Acme')!;
    const beta = rows.find((r) => r.client === 'Beta')!;
    expect(acme.firstTask?.taskId).toBe('t1');
    expect(acme.assignees).toEqual([]);
    expect(beta.firstTask?.taskName).toBe('Kickoff');
    expect(beta.assignees).toHaveLength(1);
  });

  describe('sorting', () => {
    const three = {
      aggregates: [
        agg({ client: 'Beta', taskCount: 5 }),
        agg({ client: 'Acme', taskCount: 50 }),
        agg({ client: 'Gamma', taskCount: 20 }),
      ],
      hours: [
        { client: 'Beta', totalHours: 900, totalCostCents: 0 },
        { client: 'Acme', totalHours: 100, totalCostCents: 0 },
      ],
      endpoints: [
        endpoint({ client: 'Beta', position: 'last', createdDate: new Date('2026-09-18T00:00:00Z') }),
        endpoint({ client: 'Acme', position: 'last', createdDate: new Date('2025-01-01T00:00:00Z') }),
      ],
    };

    it('sorts by name', () => {
      expect(assembleClients(input({ ...three, sort: 'name' })).map((r) => r.client)).toEqual(['Acme', 'Beta', 'Gamma']);
    });

    it('sorts by task count, busiest first', () => {
      expect(assembleClients(input({ ...three, sort: 'tasks' })).map((r) => r.client)).toEqual(['Acme', 'Gamma', 'Beta']);
    });

    it('sorts by hours, most logged first', () => {
      expect(assembleClients(input({ ...three, sort: 'hours' })).map((r) => r.client)).toEqual(['Beta', 'Acme', 'Gamma']);
    });

    it('sorts by most recent task, and a client with no dated task sorts last', () => {
      expect(assembleClients(input({ ...three, sort: 'recent' })).map((r) => r.client)).toEqual(['Beta', 'Acme', 'Gamma']);
    });
  });
});
