import { ClickupEventProcessor } from '../src/workers/clickup-event.processor';

function makeQueues() {
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  return {
    get: jest.fn().mockReturnValue(queue),
    defaultJobOptions: jest.fn().mockReturnValue({}),
    _queue: queue,
  } as any;
}

function makeEvents() {
  return {
    markProcessed: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeDeadLetters(exhausted = false) {
  return { recordIfExhausted: jest.fn().mockResolvedValue(exhausted) } as any;
}

function makePrisma() {
  return {
    clickupTaskEvent: { upsert: jest.fn().mockResolvedValue(undefined) },
  } as any;
}

function makeParser(records: any[] = []) {
  return { extractStatusChanges: jest.fn().mockReturnValue(records) } as any;
}

describe('ClickupEventProcessor — taskStatusUpdated', () => {
  it('upserts one row per status change with deterministic fingerprint', async () => {
    const prisma = makePrisma();
    const parser = makeParser([
      {
        occurredAt: new Date(1716470400000),
        changedByUserId: '12345',
        changedByUserName: 'Rashedul',
        before: { status: 'open' },
        after: { status: 'in progress' },
        raw: { id: 'hist_1' },
      },
    ]);
    const proc = new ClickupEventProcessor(makeQueues(), makeEvents(), parser, prisma, makeDeadLetters());
    await proc.process({
      data: { eventType: 'taskStatusUpdated', taskId: '86abcdef0', fingerprint: 'id:hist_1', loggedUserId: null, payload: { history_items: [{ field: 'status' }] } },
    } as any);
    expect(prisma.clickupTaskEvent.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.clickupTaskEvent.upsert.mock.calls[0][0];
    expect(call.where.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(call.create.taskId).toBe('86abcdef0');
    expect(call.create.eventType).toBe('taskStatusUpdated');
    expect(call.create.before).toEqual({ status: 'open' });
    expect(call.create.after).toEqual({ status: 'in progress' });
    expect(call.update).toEqual({});
  });

  it('survives a parser/upsert error on one item and continues with the rest', async () => {
    const prisma = makePrisma();
    prisma.clickupTaskEvent.upsert
      .mockRejectedValueOnce(new Error('one fails'))
      .mockResolvedValueOnce(undefined);
    const parser = makeParser([
      { occurredAt: new Date(1), changedByUserId: null, changedByUserName: null, before: {}, after: {}, raw: {} },
      { occurredAt: new Date(2), changedByUserId: null, changedByUserName: null, before: {}, after: {}, raw: {} },
    ]);
    const proc = new ClickupEventProcessor(makeQueues(), makeEvents(), parser, prisma, makeDeadLetters());
    await proc.process({
      data: { eventType: 'taskStatusUpdated', taskId: 't1', fingerprint: 'fp', loggedUserId: null, payload: {} },
    } as any);
    expect(prisma.clickupTaskEvent.upsert).toHaveBeenCalledTimes(2);
  });

  it('does not enqueue a task sync for taskStatusUpdated (separate concern)', async () => {
    const queues = makeQueues();
    const proc = new ClickupEventProcessor(queues, makeEvents(), makeParser([]), makePrisma(), makeDeadLetters());
    await proc.process({
      data: { eventType: 'taskStatusUpdated', taskId: 't1', fingerprint: 'fp', loggedUserId: null, payload: {} },
    } as any);
    expect(queues._queue.add).not.toHaveBeenCalled();
  });
});

describe('ClickupEventProcessor — failure handling', () => {
  it('marks the webhook event failed once retries are exhausted', async () => {
    const events = makeEvents();
    const deadLetters = makeDeadLetters(true); // exhausted
    const proc = new ClickupEventProcessor(makeQueues(), events, makeParser([]), makePrisma(), deadLetters);

    await proc.onFailed(
      { data: { fingerprint: 'fp-1' } } as any,
      new Error('downstream boom'),
    );

    expect(deadLetters.recordIfExhausted).toHaveBeenCalled();
    expect(events.markFailed).toHaveBeenCalledWith('fp-1', 'downstream boom');
  });

  it('does NOT mark failed while retries remain', async () => {
    const events = makeEvents();
    const deadLetters = makeDeadLetters(false); // still retrying
    const proc = new ClickupEventProcessor(makeQueues(), events, makeParser([]), makePrisma(), deadLetters);

    await proc.onFailed({ data: { fingerprint: 'fp-1' } } as any, new Error('transient'));

    expect(events.markFailed).not.toHaveBeenCalled();
  });
});
