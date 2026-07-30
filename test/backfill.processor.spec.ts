import { BackfillProcessor } from '../src/workers/backfill.processor';
import { JOBS } from '../src/queues/queue.constants';

function makeDeps() {
  const backfillSpace = jest.fn().mockResolvedValue({ total: 5, parents: 3, subtasks: 2, truncated: false });
  const backfills = { backfillSpace } as any;
  const started = jest.fn().mockResolvedValue({ id: 1n });
  const finished = jest.fn().mockResolvedValue({});
  const failed = jest.fn().mockResolvedValue({});
  const jobLogs = { started, finished, failed } as any;
  const recordIfExhausted = jest.fn().mockResolvedValue(false);
  const deadLetters = { recordIfExhausted } as any;
  const process = jest.fn().mockResolvedValue({ synced: 4 });
  const listCatalog = { process } as any;
  const proc = new BackfillProcessor(backfills, jobLogs, deadLetters, listCatalog);
  return { proc, backfillSpace, started, finished, failed, recordIfExhausted, process };
}

describe('BackfillProcessor', () => {
  it('runs a backfill job and logs tasksSynced', async () => {
    const { proc, backfillSpace, finished } = makeDeps();
    const res = await proc.process({ id: '1', name: JOBS.BACKFILL_CLICKUP_SPACE, data: { spaceId: 's1' } } as any);
    expect(backfillSpace).toHaveBeenCalledWith('s1', undefined, undefined, undefined);
    expect(finished).toHaveBeenCalledWith(1n, { tasksSynced: 5 });
    expect(res).toEqual({ total: 5, parents: 3, subtasks: 2, truncated: false });
  });

  // Regression guard for the shared-queue routing hazard: CLICKUP_BACKFILLS
  // now also carries SYNC_LIST_CATALOG jobs. A misrouted catalog job must
  // NEVER fall through to a full space backfill (risk: OOM on the 1.9GB prod
  // host from an unbounded backfill triggered by what should be a cheap
  // list-catalog sync).
  it('routes a SYNC_LIST_CATALOG job to the list-catalog handler, not backfillSpace', async () => {
    const { proc, backfillSpace, process, finished } = makeDeps();
    const res = await proc.process({ id: '2', name: JOBS.SYNC_LIST_CATALOG, data: { spaceId: 's1' } } as any);
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ data: { spaceId: 's1' } }));
    expect(backfillSpace).not.toHaveBeenCalled();
    // No tasksSynced count written for a catalog job — see comment at the
    // call site: that field feeds a task-count progress denominator elsewhere.
    expect(finished).toHaveBeenCalledWith(1n);
    expect(res).toEqual({ synced: 4 });
  });

  it('logs failure and rethrows on a failed backfill', async () => {
    const { proc, backfillSpace, failed } = makeDeps();
    const err = new Error('boom');
    backfillSpace.mockRejectedValueOnce(err);
    await expect(proc.process({ id: '1', name: JOBS.BACKFILL_CLICKUP_SPACE, data: { spaceId: 's1' } } as any)).rejects.toThrow('boom');
    expect(failed).toHaveBeenCalledWith(1n, err);
  });

  it('logs failure and rethrows on a failed list-catalog sync', async () => {
    const { proc, process, failed } = makeDeps();
    const err = new Error('catalog boom');
    process.mockRejectedValueOnce(err);
    await expect(proc.process({ id: '2', name: JOBS.SYNC_LIST_CATALOG, data: { spaceId: 's1' } } as any)).rejects.toThrow('catalog boom');
    expect(failed).toHaveBeenCalledWith(1n, err);
  });

  it('routes exhausted jobs to dead-letter storage via the failed hook', async () => {
    const { proc, recordIfExhausted } = makeDeps();
    const job = { data: { spaceId: 's1' } } as any;
    const err = new Error('boom');
    await proc.onFailed(job, err);
    expect(recordIfExhausted).toHaveBeenCalledWith(job, err);
  });
});
