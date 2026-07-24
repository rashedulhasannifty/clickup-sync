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

  it('runs a second archived pass and dedupes by id when includeArchived', async () => {
    const client = makeClient();
    const spy = jest
      .spyOn(client, 'getTasksBySpace')
      .mockImplementation((_sp, opts) =>
        (opts as { archived?: boolean }).archived
          ? (Promise.resolve({ tasks: [{ id: 'b' }, { id: 'a' }] }) as never) // 'a' overlaps
          : (Promise.resolve({ tasks: [{ id: 'a' }] }) as never),
      );

    const res = await client.getAllTasksBySpace('sp1', { teamId: 'team1', includeArchived: true });

    expect(spy.mock.calls.some((c) => (c[1] as { archived?: boolean }).archived === true)).toBe(true);
    expect(res.tasks.map((t) => (t as { id: string }).id).sort()).toEqual(['a', 'b']);
  });
});
