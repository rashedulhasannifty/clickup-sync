import { of, throwError } from 'rxjs';
import { ClickupClient } from '../src/clickup/clickup.client';

function build(httpRequest: jest.Mock) {
  const http = { request: httpRequest } as any;
  const settings = { getApiToken: () => 'pk_test', getTeamId: () => '3450636' } as any;
  return new ClickupClient(http, settings);
}

function err429(retryAfter: string) {
  return { response: { status: 429, headers: { 'retry-after': retryAfter } }, message: 'rate limited' };
}

describe('ClickupClient — 429 / Retry-After handling', () => {
  it('retries after the Retry-After delay and returns the eventual result', async () => {
    const request = jest
      .fn()
      .mockReturnValueOnce(throwError(() => err429('0')))
      .mockReturnValueOnce(of({ data: { id: 'task-1' } }));

    const client = build(request);
    const task = await client.getTask('task-1');

    expect(task).toEqual({ id: 'task-1' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and rethrows the 429', async () => {
    const request = jest.fn().mockReturnValue(throwError(() => err429('0')));
    const client = build(request);

    await expect(client.getTask('task-1')).rejects.toMatchObject({ response: { status: 429 } });
    // initial attempt + bounded retries (does not loop forever)
    expect(request.mock.calls.length).toBeGreaterThan(1);
    expect(request.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('does not retry non-429 errors', async () => {
    const request = jest
      .fn()
      .mockReturnValue(throwError(() => ({ response: { status: 500 }, message: 'server error' })));
    const client = build(request);

    await expect(client.getTask('task-1')).rejects.toMatchObject({ response: { status: 500 } });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
