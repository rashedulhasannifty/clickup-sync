import { AssigneeReplacementService, ReplacementJobData } from '../src/time-entries/assignee-replacement.service';

const SAMPLE_JOB: ReplacementJobData = {
  timeEntryId: 'entry-123',
  taskId: 'task-456',
  startMs: 1700000000000,
  endMs: 1700003600000,
  durationHours: 1,
  billable: true,
  description: 'Work done',
};

const ACTIVE_MAPPINGS = [
  {
    id: BigInt(1),
    tagName: 'chisty',
    clickupUserId: '242630708',
    clickupUserName: 'Chishty',
    clickupEmail: 'chishty@test.com',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

function buildMocks(
  overrides: Partial<{
    findByOriginalEntryId: jest.Mock;
    createReplacement: jest.Mock;
    findAllActive: jest.Mock;
    getTask: jest.Mock;
    createTimeEntry: jest.Mock;
    deleteTimeEntry: jest.Mock;
    costs: jest.Mock;
    upsert: jest.Mock;
  }> = {},
) {
  const findByOriginalEntryId =
    overrides.findByOriginalEntryId ?? jest.fn().mockResolvedValue(null);
  const createReplacement =
    overrides.createReplacement ?? jest.fn().mockResolvedValue({ id: BigInt(1) });
  const findAllActive =
    overrides.findAllActive ?? jest.fn().mockResolvedValue(ACTIVE_MAPPINGS);
  const getTask =
    overrides.getTask ??
    jest.fn().mockResolvedValue({ id: 'task-456', tags: [{ name: 'chisty' }] });
  const createTimeEntry =
    overrides.createTimeEntry ??
    jest.fn().mockResolvedValue({ id: 'new-entry-789', task: { id: 'task-456' } });
  const deleteTimeEntry =
    overrides.deleteTimeEntry ?? jest.fn().mockResolvedValue(undefined);
  const costs =
    overrides.costs ??
    jest.fn().mockResolvedValue({
      rateId: null,
      currency: 'AUD',
      hourlyRateCents: 0n,
      costCents: 0n,
      status: 'NO_RATE_FOUND',
    });
  const upsert = overrides.upsert ?? jest.fn().mockResolvedValue({});

  const clickup = { getTask, createTimeEntry, deleteTimeEntry } as any;
  const tagAssigneeMap = { findAllActive, findByTagName: jest.fn() } as any;
  const replacements = { findByOriginalEntryId, create: createReplacement } as any;
  const costsService = { calculate: costs } as any;
  const timeEntriesRepo = { upsert } as any;

  const service = new AssigneeReplacementService(
    clickup,
    tagAssigneeMap,
    replacements,
    costsService,
    timeEntriesRepo,
  );

  return {
    service,
    clickup,
    tagAssigneeMap,
    replacements,
    costsService,
    timeEntriesRepo,
    findByOriginalEntryId,
    createReplacement,
    findAllActive,
    getTask,
    createTimeEntry,
    deleteTimeEntry,
    costs,
    upsert,
  };
}

describe('AssigneeReplacementService.replaceEntry', () => {
  beforeEach(() => {
    process.env.CLICKUP_AGENCY_USER_ID = '3584055';
  });

  afterEach(() => {
    delete process.env.CLICKUP_AGENCY_USER_ID;
  });

  it('returns skipped when entry was already replaced', async () => {
    const { service, getTask, createTimeEntry, deleteTimeEntry } = buildMocks({
      findByOriginalEntryId: jest.fn().mockResolvedValue({ id: BigInt(99) }),
    });

    const result = await service.replaceEntry(SAMPLE_JOB);

    expect(result).toEqual({ status: 'skipped' });
    expect(getTask).not.toHaveBeenCalled();
    expect(createTimeEntry).not.toHaveBeenCalled();
    expect(deleteTimeEntry).not.toHaveBeenCalled();
  });

  it('returns no_mapping when task tags do not match any active mapping', async () => {
    const { service, createTimeEntry, deleteTimeEntry } = buildMocks({
      getTask: jest.fn().mockResolvedValue({ id: 'task-456', tags: [{ name: 'design' }] }),
      findAllActive: jest.fn().mockResolvedValue(ACTIVE_MAPPINGS), // only 'chisty' is active
    });

    const result = await service.replaceEntry(SAMPLE_JOB);

    expect(result).toEqual({ status: 'no_mapping' });
    expect(createTimeEntry).not.toHaveBeenCalled();
    expect(deleteTimeEntry).not.toHaveBeenCalled();
  });

  it('returns no_mapping when task has no tags', async () => {
    const { service, createTimeEntry, deleteTimeEntry } = buildMocks({
      getTask: jest.fn().mockResolvedValue({ id: 'task-456', tags: [] }),
    });

    const result = await service.replaceEntry(SAMPLE_JOB);

    expect(result).toEqual({ status: 'no_mapping' });
    expect(createTimeEntry).not.toHaveBeenCalled();
    expect(deleteTimeEntry).not.toHaveBeenCalled();
  });

  it('performs successful replacement: creates entry, saves audit row, then deletes original', async () => {
    const callOrder: string[] = [];

    const createReplacement = jest.fn().mockImplementation(async () => {
      callOrder.push('create');
      return { id: BigInt(1) };
    });
    const deleteTimeEntry = jest.fn().mockImplementation(async () => {
      callOrder.push('delete');
    });

    const { service, createTimeEntry, upsert } = buildMocks({
      createReplacement,
      deleteTimeEntry,
    });

    const result = await service.replaceEntry(SAMPLE_JOB);

    expect(result).toEqual({ status: 'replaced' });
    expect(createTimeEntry).toHaveBeenCalled();
    expect(createReplacement).toHaveBeenCalled();
    expect(deleteTimeEntry).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalled();

    // Audit row MUST be created before original is deleted
    expect(callOrder[0]).toBe('create');
    expect(callOrder[1]).toBe('delete');
  });

  it('passes correct payload to createTimeEntry', async () => {
    const teamId = process.env.CLICKUP_TEAM_ID || '3450636';
    const { service, createTimeEntry } = buildMocks();

    await service.replaceEntry(SAMPLE_JOB);

    expect(createTimeEntry).toHaveBeenCalledWith(teamId, {
      start: SAMPLE_JOB.startMs,
      stop: SAMPLE_JOB.endMs,
      description: SAMPLE_JOB.description,
      billable: SAMPLE_JOB.billable,
      tid: SAMPLE_JOB.taskId,
      assignee: Number(ACTIVE_MAPPINGS[0].clickupUserId),
    });
  });

  it('passes correct payload to replacements.create audit row', async () => {
    const { service, createReplacement } = buildMocks();

    await service.replaceEntry(SAMPLE_JOB);

    expect(createReplacement).toHaveBeenCalledWith(
      expect.objectContaining({
        originalEntryId: SAMPLE_JOB.timeEntryId,
        replacementEntryId: 'new-entry-789',
        taskId: SAMPLE_JOB.taskId,
        originalUserId: '3584055',
        replacedUserId: ACTIVE_MAPPINGS[0].clickupUserId,
        tagName: 'chisty',
        status: 'replaced',
      }),
    );
  });

  it('calls deleteTimeEntry with team id and original entry id', async () => {
    const teamId = process.env.CLICKUP_TEAM_ID || '3450636';
    const { service, deleteTimeEntry } = buildMocks();

    await service.replaceEntry(SAMPLE_JOB);

    expect(deleteTimeEntry).toHaveBeenCalledWith(teamId, SAMPLE_JOB.timeEntryId);
  });

  it('upserts replacement entry into local DB after deletion', async () => {
    const { service, upsert } = buildMocks();

    await service.replaceEntry(SAMPLE_JOB);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        timeEntryId: 'new-entry-789',
        taskId: SAMPLE_JOB.taskId,
        userId: ACTIVE_MAPPINGS[0].clickupUserId,
        userName: ACTIVE_MAPPINGS[0].clickupUserName,
        userEmail: ACTIVE_MAPPINGS[0].clickupEmail,
        durationHours: SAMPLE_JOB.durationHours,
        billable: SAMPLE_JOB.billable,
        description: SAMPLE_JOB.description,
      }),
      expect.objectContaining({ status: 'NO_RATE_FOUND' }),
    );
  });

  it('throws when CLICKUP_AGENCY_USER_ID is not set', async () => {
    delete process.env.CLICKUP_AGENCY_USER_ID;

    const { service } = buildMocks();

    await expect(service.replaceEntry(SAMPLE_JOB)).rejects.toThrow(
      'CLICKUP_AGENCY_USER_ID env var is not set',
    );
  });

  it('returns no_mapping when getTask throws', async () => {
    const { service, createTimeEntry, deleteTimeEntry } = buildMocks({
      getTask: jest.fn().mockRejectedValue(new Error('ClickUp API unavailable')),
    });

    const result = await service.replaceEntry(SAMPLE_JOB);

    expect(result).toEqual({ status: 'no_mapping' });
    expect(createTimeEntry).not.toHaveBeenCalled();
    expect(deleteTimeEntry).not.toHaveBeenCalled();
  });
});
