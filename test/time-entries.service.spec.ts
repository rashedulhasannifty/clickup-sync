import { TimeEntriesService } from '../src/time-entries/time-entries.service';

// Bare-minimum collaborators for `syncTaskTimeEntries`. Each test patches
// what it needs to assert. The self-heal under test is the
// `tasksRepo.exists` → `tasksService.syncTask` branch that prevents the FK
// violation we observed in production (Foreign key constraint violated on
// clickup_time_entries_task_id_fkey).
function makeService(overrides: Partial<{
  exists: jest.Mock;
  syncTask: jest.Mock;
  getMemberIds: jest.Mock;
  getTimeEntries: jest.Mock;
  upsert: jest.Mock;
  costs: jest.Mock;
  findAllActive: jest.Mock;
}> = {}) {
  const exists = overrides.exists ?? jest.fn().mockResolvedValue(true);
  const syncTask = overrides.syncTask ?? jest.fn().mockResolvedValue({});
  const getMemberIds = overrides.getMemberIds ?? jest.fn().mockResolvedValue(['u1']);
  const getTimeEntries = overrides.getTimeEntries ?? jest.fn().mockResolvedValue([]);
  const upsert = overrides.upsert ?? jest.fn().mockResolvedValue({});
  const costs = overrides.costs ?? jest.fn().mockResolvedValue({
    rateId: null, currency: 'AUD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND',
  });
  const findAllActive = overrides.findAllActive ?? jest.fn().mockResolvedValue([]);

  const clickup = { getTimeEntries } as any;
  const normalizer = {
    normalizeTimeEntry: (e: any) => ({
      timeEntryId: e.id, taskId: e.task?.id ?? null, taskName: null,
      userId: e.user?.id ?? null, userName: null, userEmail: null,
      startTime: new Date(0), endTime: new Date(0), durationHours: 1,
      billable: false, description: null, raw: e,
    }),
  } as any;
  const repo = { upsert } as any;
  const costsService = { calculate: costs } as any;
  const queues = { get: jest.fn().mockReturnValue({ add: jest.fn() }), defaultJobOptions: jest.fn().mockReturnValue({}) } as any;
  const members = { getMemberIds } as any;
  const tagAssigneeMap = { findAllActive } as any;
  const tasksRepo = { exists } as any;
  const tasksService = { syncTask } as any;

  const service = new TimeEntriesService(
    clickup, normalizer, repo, costsService, queues, members, tagAssigneeMap, tasksRepo, tasksService,
    { getTeamId: () => '3450636' } as any,
  );

  return { service, exists, syncTask, getMemberIds, getTimeEntries, upsert, costs, findAllActive };
}

describe('TimeEntriesService.syncTaskTimeEntries — task self-heal', () => {
  it('does NOT pre-sync the task when it already exists locally', async () => {
    const { service, exists, syncTask } = makeService({
      exists: jest.fn().mockResolvedValue(true),
    });

    await service.syncTaskTimeEntries('86exjakgc');

    expect(exists).toHaveBeenCalledWith('86exjakgc');
    expect(syncTask).not.toHaveBeenCalled();
  });

  it('pre-syncs the task BEFORE fetching time entries when missing locally', async () => {
    const callOrder: string[] = [];
    const syncTask = jest.fn().mockImplementation(async () => {
      callOrder.push('syncTask');
    });
    const getTimeEntries = jest.fn().mockImplementation(async () => {
      callOrder.push('getTimeEntries');
      return [];
    });
    // First exists() = gate into self-heal (false). Second exists() = the
    // post-pre-sync recheck — true means syncTask successfully populated the
    // row, so we continue with the normal flow.
    const exists = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { service } = makeService({ exists, syncTask, getTimeEntries });

    await service.syncTaskTimeEntries('86exjakgc');

    expect(syncTask).toHaveBeenCalledWith('86exjakgc');
    expect(getTimeEntries).toHaveBeenCalled();
    // Order matters: task row must be inserted before any time-entry upsert
    // could FK against it.
    expect(callOrder).toEqual(['syncTask', 'getTimeEntries']);
  });

  it('skips time-entry sync entirely when the task is still unresolved after pre-sync (avoids FK violation)', async () => {
    // First exists() is the gate that enters the self-heal branch; the second
    // is the re-check after syncTask fails. Both false → bail before any
    // ClickUp/upsert work.
    const exists = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const { service, syncTask, getTimeEntries, upsert } = makeService({
      exists,
      syncTask: jest.fn().mockRejectedValue(new Error('ClickUp 404 task not found')),
    });

    // No throw — the job log row should land as completed, not failed,
    // because the failure here is "data not in our domain" not "we broke".
    await expect(service.syncTaskTimeEntries('86exjakgc')).resolves.toBe(0);
    expect(syncTask).toHaveBeenCalled();
    expect(getTimeEntries).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('proceeds when pre-sync succeeds and the task is then present', async () => {
    // exists() returns false initially, then true after syncTask inserts the
    // row. Worker should continue with the normal time-entry sync flow.
    const exists = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { service, syncTask, getTimeEntries } = makeService({
      exists,
      syncTask: jest.fn().mockResolvedValue({}),
    });

    await service.syncTaskTimeEntries('86exjakgc');
    expect(syncTask).toHaveBeenCalled();
    expect(getTimeEntries).toHaveBeenCalled();
  });
});
