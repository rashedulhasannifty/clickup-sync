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
