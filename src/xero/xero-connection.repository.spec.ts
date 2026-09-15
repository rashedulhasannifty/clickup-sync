import { XeroConnectionRepository } from './xero-connection.repository';

function setup(count = 1) {
  const prisma = {
    xeroConnection: {
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({ id: 'singleton' }),
      updateMany: jest.fn().mockResolvedValue({ count }),
    },
  };
  return { repo: new XeroConnectionRepository(prisma as never), prisma };
}

const tokens = {
  accessTokenEnc: 'enc(new-access)', refreshTokenEnc: 'enc(new-refresh)',
  accessExpiresAt: new Date('2026-09-15T12:30:00Z'), refreshedAt: new Date('2026-09-15T12:00:00Z'),
};

describe('XeroConnectionRepository', () => {
  it('saveConnected upserts the singleton row as CONNECTED with fresh timestamps and no error', async () => {
    const { repo, prisma } = setup();
    const input = {
      tenantId: 't1', connectionId: 'c1', tenantName: 'Nifty', shortCode: '!abc', baseCurrency: 'USD',
      accessTokenEnc: 'enc(a)', refreshTokenEnc: 'enc(r)', accessExpiresAt: new Date(), connectedByUserId: 'u1', connectedByEmail: null,
    };
    await repo.saveConnected(input);
    const arg = prisma.xeroConnection.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'singleton' });
    for (const data of [arg.create, arg.update]) {
      expect(data).toMatchObject({ ...input, status: 'CONNECTED', lastError: null });
      expect(data.connectedAt).toBeInstanceOf(Date);
      expect(data.refreshedAt).toBeInstanceOf(Date);
    }
    expect(arg.create.id).toBe('singleton');
  });

  it('markDisconnected clears the tokens only, keeping the tenant identity for a reconnect', async () => {
    const { repo, prisma } = setup();
    await repo.markDisconnected();
    const arg = prisma.xeroConnection.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'singleton' });
    expect(arg.data).toEqual({ status: 'DISCONNECTED', accessTokenEnc: null, refreshTokenEnc: null, accessExpiresAt: null, lastError: null });
  });

  describe('compare-and-set on the refresh token that was read', () => {
    it('saveTokens writes only if the row is still CONNECTED with that refresh token, and reports it', async () => {
      const { repo, prisma } = setup(1);
      await expect(repo.saveTokens('enc(read-refresh)', tokens)).resolves.toBe(true);
      expect(prisma.xeroConnection.updateMany).toHaveBeenCalledWith({
        where: { id: 'singleton', status: 'CONNECTED', refreshTokenEnc: 'enc(read-refresh)' },
        data: { ...tokens, lastError: null },
      });
    });

    it('saveTokens reports false when the row was replaced or disconnected (0 rows changed)', async () => {
      const { repo } = setup(0);
      await expect(repo.saveTokens('enc(read-refresh)', tokens)).resolves.toBe(false);
    });

    it('markNeedsReconnect is guarded the same way and reports whether it changed a row', async () => {
      const hit = setup(1);
      await expect(hit.repo.markNeedsReconnect('enc(read-refresh)', 'invalid_grant')).resolves.toBe(true);
      expect(hit.prisma.xeroConnection.updateMany).toHaveBeenCalledWith({
        where: { id: 'singleton', status: 'CONNECTED', refreshTokenEnc: 'enc(read-refresh)' },
        data: { status: 'NEEDS_RECONNECT', lastError: 'invalid_grant' },
      });
      await expect(setup(0).repo.markNeedsReconnect('enc(read-refresh)', 'invalid_grant')).resolves.toBe(false);
    });
  });
});
