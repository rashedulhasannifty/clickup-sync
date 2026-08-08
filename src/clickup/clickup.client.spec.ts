import { ClickupClient } from './clickup.client';

function makeClient(): ClickupClient {
  // Only getApiToken() is exercised by these tests; the rest is unused.
  return new ClickupClient({} as never, { getApiToken: () => 'tok' } as never);
}

describe('ClickupClient.getTasksBySpace', () => {
  it('sends archived=false by default and archived=true when requested', async () => {
    const client = makeClient();
    const request = jest
      .spyOn(client as unknown as { request: (...a: unknown[]) => Promise<unknown> }, 'request')
      .mockResolvedValue({ tasks: [] });

    await client.getTasksBySpace('sp1', { teamId: 'team1' });
    await client.getTasksBySpace('sp1', { teamId: 'team1', archived: true });

    const url1 = request.mock.calls[0][1] as string;
    const url2 = request.mock.calls[1][1] as string;
    expect(url1).toContain('archived=false');
    expect(url2).toContain('archived=true');
  });
});

describe('ClickupClient.getAllTasksBySpace', () => {
  it('runs a single active pass when includeArchived is not set', async () => {
    const client = makeClient();
    const spy = jest
      .spyOn(client, 'getTasksBySpace')
      .mockResolvedValue({ tasks: [{ id: 'a' }] } as never);

    const res = await client.getAllTasksBySpace('sp1', { teamId: 'team1' });

    expect(spy).toHaveBeenCalledTimes(1); // one short page => one call, no archived pass
    expect((spy.mock.calls[0][1] as { archived?: boolean }).archived).toBe(false);
    expect(res.tasks.map((t) => (t as { id: string }).id)).toEqual(['a']);
    expect(res.truncated).toBe(false);
  });

  it('paginates a pass until a short page', async () => {
    const client = makeClient();
    const fullPage = { tasks: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })) };
    const shortPage = { tasks: [{ id: 'last' }] };
    const spy = jest
      .spyOn(client, 'getTasksBySpace')
      .mockResolvedValueOnce(fullPage as never)
      .mockResolvedValueOnce(shortPage as never);

    const res = await client.getAllTasksBySpace('sp1', { teamId: 'team1' });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.tasks).toHaveLength(101);
  });

  it('runs the archived pass per-list (never the team endpoint) and dedupes by id when includeArchived', async () => {
    const client = makeClient();
    // The team endpoint caps archived=true at ~100 and won't paginate, so the
    // archived pass scans each list via /list/{id}/task instead. Active pass
    // still uses getTasksBySpace; archived work goes through the raw request().
    const request = jest
      .spyOn(client as unknown as { request: (...a: unknown[]) => Promise<unknown> }, 'request')
      .mockImplementation((...args: unknown[]) => {
        const path = args[1] as string;
        if (path.includes('/team/')) return Promise.resolve({ tasks: [{ id: 'a' }] }); // active short page
        if (path.includes('/list?archived=false')) return Promise.resolve({ lists: [{ id: 'L1' }] });
        if (path.includes('/folder?archived')) return Promise.resolve({ folders: [] });
        if (path.includes('/list?archived=true')) return Promise.resolve({ lists: [] });
        if (path.startsWith('/list/L1/task')) return Promise.resolve({ tasks: [{ id: 'b' }, { id: 'a' }] }); // 'a' overlaps
        return Promise.resolve({ tasks: [] });
      });

    const res = await client.getAllTasksBySpace('sp1', { teamId: 'team1', includeArchived: true });

    const paths = request.mock.calls.map((c) => c[1] as string);
    expect(paths.some((p) => p.includes('/team/') && p.includes('archived=true'))).toBe(false);
    expect(paths.some((p) => p.startsWith('/list/L1/task'))).toBe(true);
    expect(res.tasks.map((t) => (t as { id: string }).id).sort()).toEqual(['a', 'b']);
  });
});

describe('getTimeEntriesWindow', () => {
  it('queries the team endpoint with space_id, assignee and window; dedupes by id', async () => {
    const client = makeClient();
    const req = jest
      .spyOn(client as unknown as { request: (...a: unknown[]) => Promise<unknown> }, 'request')
      .mockResolvedValue({
        data: [{ id: 'te1' }, { id: 'te1' }, { id: 'te2' }],
      });

    const out = await client.getTimeEntriesWindow('team1', {
      spaceId: 'sp1',
      assigneeIds: ['u1', 'u2'],
      startDate: 1000,
      endDate: 2000,
    });

    expect(out.map((e) => e.id)).toEqual(['te1', 'te2']);
    const path = req.mock.calls[0][1] as string;
    expect(path).toContain('/team/team1/time_entries?');
    expect(path).toContain('space_id=sp1');
    expect(path).toContain('assignee=u1%2Cu2');
    expect(path).not.toContain('task_id=');
  });
});
