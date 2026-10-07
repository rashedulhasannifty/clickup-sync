import { PeopleSyncService } from './people-sync.service';
import { DummyAttendanceProvider } from './dummy-attendance.provider';
import { dhakaInstant } from './people-dates';

const NOW = dhakaInstant('2026-10-07', 18 * 60);

function make(provider = new DummyAttendanceProvider(() => NOW)) {
  const emps = [
    {
      id: 'e1',
      email: 'a@x.test',
      joinDate: new Date('2026-01-01T00:00:00Z'),
      exitDate: null,
    },
    {
      id: 'e2',
      email: 'b@x.test',
      joinDate: new Date('2026-01-01T00:00:00Z'),
      exitDate: null,
    },
  ];
  const stores = {
    attendance: new Map<string, unknown>(),
    leaves: new Map<string, { decided: boolean; status: string }>(),
  };
  const employees = { listForSync: jest.fn().mockResolvedValue(emps) };
  const attendance = {
    upsertAttendance: jest
      .fn()
      .mockImplementation(
        async (rows: { employeeId: string; date: string }[]) => {
          for (const r of rows)
            stores.attendance.set(`${r.employeeId}|${r.date}`, r);
          return rows.length;
        },
      ),
    // Same semantics as the real repo: decided rows are never overwritten.
    upsertProviderLeaves: jest
      .fn()
      .mockImplementation(
        async (
          _s: string,
          leaves: { externalId: string; status: string }[],
        ) => {
          const out = { created: 0, updated: 0, preserved: 0 };
          for (const l of leaves) {
            const cur = stores.leaves.get(l.externalId);
            if (!cur) {
              stores.leaves.set(l.externalId, {
                decided: false,
                status: l.status,
              });
              out.created++;
            } else if (cur.decided) out.preserved++;
            else if (cur.status !== l.status) {
              cur.status = l.status;
              out.updated++;
            }
          }
          return out;
        },
      ),
  };
  const queues = { get: jest.fn(), defaultJobOptions: () => ({}) };
  jest.useFakeTimers({ now: NOW });
  return {
    svc: new PeopleSyncService(
      employees as never,
      attendance as never,
      queues as never,
      provider,
    ),
    employees,
    attendance,
    stores,
    queues,
  };
}

afterEach(() => jest.useRealTimers());

describe('PeopleSyncService.run', () => {
  it('writes provider rows keyed by employee id, stamped with the provider source, and computes minutes in office', async () => {
    const { svc, attendance } = make();
    const r = await svc.run(30);
    expect(r).toMatchObject({
      source: 'dummy',
      from: '2026-09-08',
      to: '2026-10-07',
      employees: 2,
    });
    const rows = attendance.upsertAttendance.mock.calls[0][0];
    expect(rows.length).toBe(r.attendanceRows);
    expect(
      rows.every(
        (x: { source: string; employeeId: string }) =>
          x.source === 'dummy' && ['e1', 'e2'].includes(x.employeeId),
      ),
    ).toBe(true);
    const full = rows.find((x: { lastOut: Date | null }) => x.lastOut);
    expect(full.minutesInOffice).toBe(
      Math.round((full.lastOut.getTime() - full.firstIn.getTime()) / 60000),
    );
    expect(attendance.upsertProviderLeaves).toHaveBeenCalledWith(
      'dummy',
      expect.any(Array),
    );
  });

  it('is idempotent: a second run writes the same attendance keys and no new leave', async () => {
    const { svc, stores } = make();
    const first = await svc.run(30);
    const keys = new Set(stores.attendance.keys());
    const second = await svc.run(30);
    expect(new Set(stores.attendance.keys())).toEqual(keys);
    expect(second.attendanceRows).toBe(first.attendanceRows);
    expect(second.leavesCreated).toBe(0);
    expect(second.leavesUpdated).toBe(0);
  });

  it('a decided leave survives a re-sync', async () => {
    const provider = {
      source: 'dummy',
      fetch: jest.fn().mockResolvedValue({
        attendance: [],
        leaves: [
          {
            email: 'a@x.test',
            externalId: 'dummy:pending:a@x.test:2026-10-12',
            type: 'CASUAL',
            startDate: '2026-10-12',
            endDate: '2026-10-12',
            days: 1,
            status: 'PENDING',
          },
        ],
      }),
    };
    const { svc, stores } = make(provider as never);
    expect((await svc.run(30)).leavesCreated).toBe(1);
    const row = stores.leaves.get('dummy:pending:a@x.test:2026-10-12')!;
    row.decided = true;
    row.status = 'REJECTED';
    const again = await svc.run(30);
    expect(row.status).toBe('REJECTED');
    expect(again).toMatchObject({
      leavesCreated: 0,
      leavesUpdated: 0,
      leavesPreserved: 1,
    });
  });

  it('skips provider rows for emails it does not know and no-ops with no employees', async () => {
    const provider = {
      source: 'dummy',
      fetch: jest.fn().mockResolvedValue({
        attendance: [
          {
            email: 'ghost@x.test',
            date: '2026-10-06',
            firstIn: NOW,
            lastOut: null,
          },
        ],
        leaves: [],
      }),
    };
    const { svc } = make(provider as never);
    expect((await svc.run(7)).attendanceRows).toBe(0);
  });

  it('with the none provider a run changes nothing', async () => {
    const { NoneAttendanceProvider } =
      await import('./none-attendance.provider');
    const { svc, attendance } = make(new NoneAttendanceProvider() as never);
    const r = await svc.run(7);
    expect(r).toMatchObject({
      source: 'none',
      attendanceRows: 0,
      leavesCreated: 0,
    });
    expect(attendance.upsertAttendance).toHaveBeenCalledWith([]);
  });
});

describe('PeopleSyncService.enqueueDaily', () => {
  it('enqueues the 7-day job on the people-sync queue, not maintenance, and skips when one is live', async () => {
    const { svc, queues } = make();
    const queue = {
      add: jest.fn().mockResolvedValue({ id: '1' }),
      getJobs: jest.fn().mockResolvedValue([]),
    };
    queues.get.mockReturnValue(queue);
    expect(await svc.enqueueDaily()).toBe(true);
    expect(queues.get).toHaveBeenCalledWith('people-sync');
    expect(queue.add).toHaveBeenCalledWith(
      'sync-attendance',
      { entity: 'attendance', lookbackDays: 7, trigger: 'cron' },
      {},
    );
    queue.getJobs.mockResolvedValue([{ name: 'sync-attendance' }]);
    queue.add.mockClear();
    expect(await svc.enqueueDaily()).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not enqueue at all when no provider is configured', async () => {
    const { NoneAttendanceProvider } =
      await import('./none-attendance.provider');
    const { svc, queues } = make(new NoneAttendanceProvider() as never);
    expect(await svc.enqueueDaily()).toBe(false);
    expect(queues.get).not.toHaveBeenCalled();
  });
});
