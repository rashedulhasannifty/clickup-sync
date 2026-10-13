import { PeopleSyncService } from './people-sync.service';
import { DummyAttendanceProvider } from './dummy-attendance.provider';
import { dhakaInstant } from './people-dates';

const NOW = dhakaInstant('2026-10-07', 18 * 60);

function make(
  provider = new DummyAttendanceProvider(() => NOW),
  realKeys: Set<string> = new Set(),
) {
  const emps = [
    {
      id: 'e1',
      email: 'a@x.test',
      attendanceId: '66',
      joinDate: new Date('2026-01-01T00:00:00Z'),
      exitDate: null,
    },
    {
      id: 'e2',
      email: 'b@x.test',
      attendanceId: null,
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
    realAttendanceKeys: jest.fn().mockResolvedValue(realKeys),
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
          x.source === 'DUMMY' && ['e1', 'e2'].includes(x.employeeId),
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
      attendanceSource: 'DUMMY',
      canSync: true,
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
      attendanceSource: 'DUMMY',
      canSync: true,
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
    expect(attendance.upsertAttendance).not.toHaveBeenCalled();
  });

  it('never invents simulated leave on a day that has real (imported) attendance', async () => {
    const leave = (date: string) => ({
      email: 'a@x.test',
      externalId: `dummy:a@x.test:${date}`,
      type: 'SICK',
      startDate: date,
      endDate: date,
      days: 1,
      status: 'APPROVED',
    });
    const provider = {
      source: 'dummy',
      attendanceSource: 'DUMMY',
      canSync: true,
      fetch: jest.fn().mockResolvedValue({
        attendance: [],
        leaves: [leave('2026-10-05'), leave('2026-10-06')],
      }),
    };
    const { svc, stores } = make(
      provider as never,
      new Set(['e1|2026-10-05']),
    );
    expect((await svc.run(7)).leavesCreated).toBe(1);
    expect([...stores.leaves.keys()]).toEqual(['dummy:a@x.test:2026-10-06']);
  });

  it('with the stellar provider and no API credentials a run fetches and writes nothing', async () => {
    const { StellarAttendanceProvider } =
      await import('./stellar/stellar-attendance.provider');
    const { StellarApiClient } = await import('./stellar/stellar-api.client');
    const provider = new StellarAttendanceProvider(
      new StellarApiClient(null, () => Promise.reject(new Error('unused'))),
    );
    const fetch = jest.spyOn(provider, 'fetch');
    const { svc, attendance } = make(provider as never);
    const r = await svc.run(7);
    expect(r).toMatchObject({ source: 'stellar', attendanceRows: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(attendance.upsertAttendance).not.toHaveBeenCalled();
  });
});

describe('PeopleSyncService.enqueueDaily', () => {
  it('enqueues the 7 days up to yesterday on the people-sync queue, not maintenance, and skips when one is live', async () => {
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
      // NOW is Wed 7 Oct: the window ends yesterday.
      { entity: 'attendance', lookbackDays: 7, trigger: 'cron', from: '2026-09-30', to: '2026-10-06' },
      {},
    );
    queue.getJobs.mockResolvedValue([{ name: 'sync-attendance' }]);
    queue.add.mockClear();
    expect(await svc.enqueueDaily()).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('a provider limited per fetch gets exactly one fetch: yesterday and the two days before', async () => {
    const provider = {
      source: 'stellar',
      attendanceSource: 'STELLAR_API' as const,
      canSync: true,
      maxDaysPerFetch: 3,
      fetch: jest.fn(),
    };
    const { svc, queues } = make(provider as never);
    const queue = { add: jest.fn().mockResolvedValue({ id: '1' }), getJobs: jest.fn().mockResolvedValue([]) };
    queues.get.mockReturnValue(queue);
    expect(await svc.enqueueDaily()).toBe(true);
    expect(queue.add.mock.calls[0][1]).toEqual({
      entity: 'attendance',
      lookbackDays: 3,
      trigger: 'cron',
      from: '2026-10-04',
      to: '2026-10-06',
    });
  });

  it('intraday enqueues a today-only job, with the same in-flight skip', async () => {
    const { svc, queues } = make();
    const queue = {
      add: jest.fn().mockResolvedValue({ id: '2' }),
      getJobs: jest.fn().mockResolvedValue([]),
    };
    queues.get.mockReturnValue(queue);
    expect(await svc.enqueueIntraday()).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      'sync-attendance',
      { entity: 'attendance', lookbackDays: 1, trigger: 'cron-intraday' },
      {},
    );
    queue.getJobs.mockResolvedValue([{ name: 'sync-attendance' }]);
    queue.add.mockClear();
    expect(await svc.enqueueIntraday()).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not enqueue at all when no provider is configured', async () => {
    const { NoneAttendanceProvider } =
      await import('./none-attendance.provider');
    const { svc, queues } = make(new NoneAttendanceProvider() as never);
    expect(await svc.enqueueDaily()).toBe(false);
    expect(queues.get).not.toHaveBeenCalled();
  });

  it('logs and skips the crons under the stellar provider without API credentials', async () => {
    const { StellarAttendanceProvider } =
      await import('./stellar/stellar-attendance.provider');
    const { StellarApiClient } = await import('./stellar/stellar-api.client');
    const { svc, queues } = make(
      new StellarAttendanceProvider(
        new StellarApiClient(null, () => Promise.reject(new Error('unused'))),
      ) as never,
    );
    expect(await svc.enqueueDaily()).toBe(false);
    expect(await svc.enqueueIntraday()).toBe(false);
    expect(queues.get).not.toHaveBeenCalled();
  });
});

describe('PeopleSyncService with a provider limited to a few days per fetch', () => {
  function limited() {
    const calls: [string, string][] = [];
    const provider = {
      source: 'stellar',
      attendanceSource: 'STELLAR_API' as const,
      canSync: true,
      maxDaysPerFetch: 3,
      fetch: jest.fn(async (people: { email: string; attendanceId: string | null }[], from: string, to: string) => {
        calls.push([from, to]);
        return {
          attendance: [
            { email: people[0].email, date: to, firstIn: null, lastOut: null, sessions: 2, workedMinutes: 300, missingOut: true, note: null },
          ],
          leaves: [],
          unmatchedIds: ['100'],
        };
      }),
    };
    return { provider, calls, ...make(provider as never) };
  }

  it('fetches the newest days first and hands the older part back as `remaining`', async () => {
    const { svc, calls, attendance } = limited();
    const r = await svc.run(7);
    expect(calls).toEqual([['2026-10-05', '2026-10-07']]);
    expect(r).toMatchObject({ from: '2026-10-05', to: '2026-10-07', remaining: { from: '2026-10-01', to: '2026-10-04' } });
    // Door detail reaches the table.
    expect(attendance.upsertAttendance.mock.calls[0][0][0]).toMatchObject({
      sessions: 2,
      workedMinutes: 300,
      missingOut: true,
      source: 'STELLAR_API',
    });

    const next = await svc.run(7, r.remaining!);
    expect(calls[1]).toEqual(['2026-10-02', '2026-10-04']);
    expect(next.remaining).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    const last = await svc.run(7, next.remaining!);
    expect(calls[2]).toEqual(['2026-10-01', '2026-10-01']);
    expect(last.remaining).toBeNull();
  });

  it('a manual sync defaults to a week, and passes the employees’ door ids to the provider', async () => {
    const { svc, provider } = limited();
    expect(svc.defaultLookbackDays).toBe(7);
    await svc.run(1);
    expect(provider.fetch.mock.calls[0][0]).toEqual([
      expect.objectContaining({ email: 'a@x.test', attendanceId: '66' }),
      expect.objectContaining({ email: 'b@x.test', attendanceId: null }),
    ]);
  });
});
