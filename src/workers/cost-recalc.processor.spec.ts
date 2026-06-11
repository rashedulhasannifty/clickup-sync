import { CostRecalcProcessor } from './cost-recalc.processor';

function makeDeps() {
  const recalculate = jest.fn().mockResolvedValue({ scanned: 3, updated: 3 });
  const started = jest.fn().mockResolvedValue({ id: 1n });
  const finished = jest.fn().mockResolvedValue({});
  const failed = jest.fn().mockResolvedValue({});
  const recordIfExhausted = jest.fn().mockResolvedValue(false);
  const proc = new CostRecalcProcessor(
    { recalculate } as any,
    { started, finished, failed } as any,
    { recordIfExhausted } as any,
  );
  return { proc, recalculate, started, finished, failed, recordIfExhausted };
}

describe('CostRecalcProcessor', () => {
  it('runs the recalculation and logs success', async () => {
    const { proc, recalculate, finished } = makeDeps();
    const res = await proc.process({ id: '42', name: 'recalculate-costs', data: { assigneeId: 'u1' } } as any);
    expect(recalculate).toHaveBeenCalledWith({ assigneeId: 'u1' });
    expect(finished).toHaveBeenCalledWith(1n, { timeEntriesSynced: 3 });
    expect(res).toEqual({ scanned: 3, updated: 3 });
  });

  it('logs failure and rethrows', async () => {
    const { proc, recalculate, failed } = makeDeps();
    const err = new Error('boom');
    recalculate.mockRejectedValueOnce(err);
    await expect(proc.process({ id: '1', name: 'recalculate-costs', data: {} } as any)).rejects.toThrow('boom');
    expect(failed).toHaveBeenCalledWith(1n, err);
  });
});
