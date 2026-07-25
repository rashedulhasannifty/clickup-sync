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

const DAY_MS = 24 * 60 * 60 * 1000;

function urlOf(call: any[]): string {
  return call[0].url as string;
}

function windowOf(url: string): { start: number; end: number } {
  const qs = new URLSearchParams(url.split('?')[1]);
  return { start: Number(qs.get('start_date')), end: Number(qs.get('end_date')) };
}

describe('ClickupClient.getTimeEntries — multi-year window chunking', () => {
  it('sends a single request when the window is within one year', async () => {
    const request = jest.fn().mockReturnValue(of({ data: { data: [{ id: 'e1' }] } }));
    const client = build(request);

    const end = Date.now();
    const start = end - 300 * DAY_MS; // < 365 days
    const entries = await client.getTimeEntries('3450636', 'task-1', { startDate: start, endDate: end });

    expect(request).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(1);
    const win = windowOf(urlOf(request.mock.calls[0]));
    expect(win.start).toBe(start);
    expect(win.end).toBe(end);
  });

  it('splits a 3-year window into yearly slices covering the full range without gaps', async () => {
    const request = jest.fn().mockReturnValue(of({ data: { data: [] } }));
    const client = build(request);

    const end = Date.now();
    const start = end - 1095 * DAY_MS; // exactly 3 years
    await client.getTimeEntries('3450636', 'task-1', { startDate: start, endDate: end });

    expect(request).toHaveBeenCalledTimes(3);
    const wins = request.mock.calls.map((c) => windowOf(urlOf(c))).sort((a, b) => a.start - b.start);
    // first slice starts at the window start, last slice ends at the window end
    expect(wins[0].start).toBe(start);
    expect(wins[wins.length - 1].end).toBe(end);
    // contiguous, non-overlapping slices
    for (let i = 1; i < wins.length; i++) {
      expect(wins[i].start).toBe(wins[i - 1].end);
    }
  });

  it('dedupes entries that appear in more than one slice', async () => {
    const request = jest
      .fn()
      .mockReturnValueOnce(of({ data: { data: [{ id: 'e1' }, { id: 'shared' }] } }))
      .mockReturnValueOnce(of({ data: { data: [{ id: 'shared' }, { id: 'e2' }] } }))
      .mockReturnValueOnce(of({ data: { data: [{ id: 'e3' }] } }));
    const client = build(request);

    const end = Date.now();
    const start = end - 1095 * DAY_MS;
    const entries = await client.getTimeEntries('3450636', 'task-1', { startDate: start, endDate: end });

    const ids = entries.map((e: any) => e.id).sort();
    expect(ids).toEqual(['e1', 'e2', 'e3', 'shared']);
  });
});

describe('ClickupClient.getAllTasksBySpace — truncation signal', () => {
  it('returns the tasks plus truncated=false when pagination ends on a short page', async () => {
    // One full page (100) then a short page (1) → normal end, not truncated.
    const fullPage = { tasks: Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` })) };
    const shortPage = { tasks: [{ id: 'last' }] };
    const request = jest
      .fn()
      .mockReturnValueOnce(of({ data: fullPage }))
      .mockReturnValueOnce(of({ data: shortPage }));
    const client = build(request);

    const res = await client.getAllTasksBySpace('3577824', { teamId: '3450636' });

    expect(res.truncated).toBe(false);
    expect(res.tasks).toHaveLength(101);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('ClickupClient.getAllTasksBySpace — archived per-list pass', () => {
  // The team endpoint caps archived=true at ~100 rows and won't paginate, so
  // the archived pass must scan each list via /list/{id}/task instead.
  it('fetches archived tasks per-list and never asks the team endpoint for archived', async () => {
    const request = jest
      .fn()
      // 1) active pass: one short page ends it
      .mockReturnValueOnce(of({ data: { tasks: [{ id: 'a1' }] } }))
      // 2) list enumeration: list?archived=false, folder?archived=false,
      //    list?archived=true, folder?archived=true
      .mockReturnValueOnce(of({ data: { lists: [{ id: 'L1' }] } }))
      .mockReturnValueOnce(of({ data: { folders: [{ lists: [{ id: 'L2' }] }] } }))
      .mockReturnValueOnce(of({ data: { lists: [] } }))
      .mockReturnValueOnce(of({ data: { folders: [] } }))
      // 3) per-list archived tasks
      .mockReturnValueOnce(of({ data: { tasks: [{ id: 'arch1' }] } }))
      .mockReturnValueOnce(of({ data: { tasks: [{ id: 'arch2' }] } }));
    const client = build(request);

    const res = await client.getAllTasksBySpace('3525433', {
      teamId: '3450636',
      includeArchived: true,
      dateUpdatedGt: 111,
    });

    expect(res.tasks.map((t: any) => t.id).sort()).toEqual(['a1', 'arch1', 'arch2']);
    expect(res.truncated).toBe(false);

    const urls = request.mock.calls.map((c) => urlOf(c));
    // No team-endpoint call ever requests archived tasks.
    expect(urls.some((u) => u.includes('/team/') && u.includes('archived=true'))).toBe(false);
    // The active pass hits the team endpoint with archived=false.
    expect(urls.some((u) => u.includes('/team/3450636/task') && u.includes('archived=false'))).toBe(true);
    // Archived tasks come from the list endpoint, carrying the lookback window.
    expect(urls.some((u) => u.endsWith('/list/L1/task?archived=true&include_closed=true&subtasks=true&date_updated_gt=111&page=0'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/list/L2/task?archived=true&include_closed=true&subtasks=true&date_updated_gt=111&page=0'))).toBe(true);
  });

  it('skips the archived pass entirely when includeArchived is false', async () => {
    const request = jest
      .fn()
      .mockReturnValueOnce(of({ data: { tasks: [{ id: 'a1' }] } }));
    const client = build(request);

    const res = await client.getAllTasksBySpace('3525433', { teamId: '3450636' });

    expect(res.tasks).toHaveLength(1);
    // Only the active team-endpoint page — no list enumeration, no /list calls.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('dedupes a task that appears in both the active and archived passes', async () => {
    const request = jest
      .fn()
      .mockReturnValueOnce(of({ data: { tasks: [{ id: 'dup' }, { id: 'a1' }] } }))
      .mockReturnValueOnce(of({ data: { lists: [{ id: 'L1' }] } }))
      .mockReturnValueOnce(of({ data: { folders: [] } }))
      .mockReturnValueOnce(of({ data: { lists: [] } }))
      .mockReturnValueOnce(of({ data: { folders: [] } }))
      .mockReturnValueOnce(of({ data: { tasks: [{ id: 'dup' }, { id: 'arch1' }] } }));
    const client = build(request);

    const res = await client.getAllTasksBySpace('3525433', {
      teamId: '3450636',
      includeArchived: true,
    });

    expect(res.tasks.map((t: any) => t.id).sort()).toEqual(['a1', 'arch1', 'dup']);
  });
});
