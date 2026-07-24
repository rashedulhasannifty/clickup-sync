import { BackfillService } from './backfill.service';

function makeService(getIncludeArchived: () => boolean) {
  const clickup = {
    getAllTasksBySpace: jest.fn().mockResolvedValue({ tasks: [], truncated: false }),
  };
  const tasks = {
    syncTasks: jest.fn().mockResolvedValue(0),
    syncMissingParents: jest.fn().mockResolvedValue(0),
    patchSpaceNames: jest.fn().mockResolvedValue(0),
  };
  const checkpoints = { markAttempt: jest.fn(), markSuccess: jest.fn() };
  const queues = { get: () => ({ add: jest.fn() }), defaultJobOptions: () => ({}) };
  const settings = { getTeamId: () => 'team1', getIncludeArchived };
  const service = new BackfillService(
    clickup as never,
    tasks as never,
    checkpoints as never,
    queues as never,
    settings as never,
  );
  return { service, clickup };
}

describe('BackfillService.backfillSpace', () => {
  it('passes includeArchived from settings into getAllTasksBySpace', async () => {
    const { service, clickup } = makeService(() => true);
    await service.backfillSpace('3577824', 30);
    expect(clickup.getAllTasksBySpace).toHaveBeenCalledWith(
      '3577824',
      expect.objectContaining({ includeArchived: true }),
    );
  });

  it('passes includeArchived=false when the setting is off', async () => {
    const { service, clickup } = makeService(() => false);
    await service.backfillSpace('3577824', 30);
    expect(clickup.getAllTasksBySpace).toHaveBeenCalledWith(
      '3577824',
      expect.objectContaining({ includeArchived: false }),
    );
  });
});
