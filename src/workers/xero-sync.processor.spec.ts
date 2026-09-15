import { UnrecoverableError } from 'bullmq';
import { XeroSyncProcessor } from './xero-sync.processor';
import { XeroReconnectRequiredError } from '../xero/xero-errors';

function setup() {
  const sync = {
    runSync: jest.fn().mockResolvedValue({ stopped: null, entities: [], attachmentsFetched: 0 }),
    reconcileOpen: jest.fn().mockResolvedValue({ stopped: null, entities: [], attachmentsFetched: 0 }),
  };
  const tokens = { getAccessToken: jest.fn().mockResolvedValue({ accessToken: 'a', tenantId: 't' }) };
  const jobLogs = { started: jest.fn().mockResolvedValue({ id: 7n }), finished: jest.fn(), failed: jest.fn() };
  const deadLetters = { recordIfExhausted: jest.fn() };
  const p = new XeroSyncProcessor(sync as never, tokens as never, jobLogs as never, deadLetters as never);
  return { p, sync, tokens, jobLogs, deadLetters };
}
const job = (name: string, data: Record<string, unknown> = { entity: 'all' }) => ({ id: '1', name, data }) as never;

describe('XeroSyncProcessor', () => {
  it('routes a sync run and passes the full flag', async () => {
    const { p, sync, jobLogs } = setup();
    await p.process(job('xero-sync-run', { entity: 'all', full: true }));
    expect(sync.runSync).toHaveBeenCalledWith({ full: true });
    expect(jobLogs.finished).toHaveBeenCalledWith(7n);
  });

  it('routes the nightly reconcile', async () => {
    const { p, sync } = setup();
    await p.process(job('xero-reconcile-open'));
    expect(sync.reconcileOpen).toHaveBeenCalled();
  });

  it('keep-alive forces a refresh, and a reconnect-required answer is not a failure', async () => {
    const { p, tokens, jobLogs } = setup();
    await p.process(job('xero-token-keepalive'));
    expect(tokens.getAccessToken).toHaveBeenCalledWith({ force: true });
    tokens.getAccessToken.mockRejectedValueOnce(new XeroReconnectRequiredError());
    await expect(p.process(job('xero-token-keepalive'))).resolves.toEqual({ keepalive: 'needs_reconnect' });
    expect(jobLogs.failed).not.toHaveBeenCalled();
  });

  it('logs a cleanly-stopped run as partial', async () => {
    const { p, sync, jobLogs } = setup();
    sync.runSync.mockResolvedValueOnce({ stopped: 'rate_limited', entities: [], attachmentsFetched: 0 });
    await p.process(job('xero-sync-run'));
    expect(jobLogs.finished).toHaveBeenCalledWith(7n, {}, 'partial', expect.stringContaining('rate_limited'));
  });

  it('rejects unknown job names as unrecoverable', async () => {
    const { p } = setup();
    await expect(p.process(job('nope'))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('logs failures, rethrows, and dead-letters when retries are exhausted', async () => {
    const { p, sync, jobLogs, deadLetters } = setup();
    sync.runSync.mockRejectedValueOnce(new Error('boom'));
    await expect(p.process(job('xero-sync-run'))).rejects.toThrow('boom');
    expect(jobLogs.failed).toHaveBeenCalled();
    const err = new Error('x');
    await p.onFailed(job('xero-sync-run'), err);
    expect(deadLetters.recordIfExhausted).toHaveBeenCalledWith(expect.anything(), err);
  });
});
