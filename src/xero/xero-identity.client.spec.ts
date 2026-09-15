import { Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { XeroIdentityClient } from './xero-identity.client';
import { XeroInvalidGrantError } from './xero-errors';

const config = { get: (k: string) => ({ XERO_CLIENT_ID: 'cid', XERO_CLIENT_SECRET: 'csecret' } as Record<string, string>)[k] };

function make(http: Record<string, jest.Mock>) {
  return new XeroIdentityClient(http as never, config as never);
}

describe('XeroIdentityClient', () => {
  // Failure paths log by design; silence them and assert on the spies instead.
  let errSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('posts a form-encoded refresh grant with Basic auth', async () => {
    const post = jest.fn().mockReturnValue(of({ data: { access_token: 'a', refresh_token: 'r', expires_in: 1800 } }));
    const tokens = await make({ post }).refresh('old-refresh');
    expect(tokens.access_token).toBe('a');
    const [url, body, opts] = post.mock.calls[0];
    expect(url).toBe('https://identity.xero.com/connect/token');
    expect(body).toBe('grant_type=refresh_token&refresh_token=old-refresh');
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('maps a 400 invalid_grant to XeroInvalidGrantError', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => ({ response: { status: 400, data: { error: 'invalid_grant' } } })));
    await expect(make({ post }).refresh('bad')).rejects.toBeInstanceOf(XeroInvalidGrantError);
  });

  it('other token failures throw a generic error that carries no secret', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => ({ response: { status: 500, data: { error: 'server_error' } } })));
    const err = await make({ post }).exchangeCode('c', 'http://x/cb').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain('csecret');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('token request (authorization_code) failed: 500'));
  });

  it('revoke and deleteConnection never throw', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => new Error('down')));
    const del = jest.fn().mockReturnValue(throwError(() => new Error('down')));
    const client = make({ post, delete: del });
    await expect(client.revoke('r')).resolves.toBeUndefined();
    await expect(client.deleteConnection('a', 'conn')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('revoke failed'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('connection delete failed'));
  });

  it('isConfigured reflects both env vars', () => {
    expect(make({}).isConfigured()).toBe(true);
    const off = new XeroIdentityClient({} as never, { get: () => '' } as never);
    expect(off.isConfigured()).toBe(false);
  });

  it('listConnections filters to one authorisation event when given authEventId', async () => {
    const get = jest.fn().mockReturnValue(of({ data: [{ id: 'c1', tenantId: 't1', tenantType: 'ORGANISATION', tenantName: 'A' }] }));
    const client = make({ get });
    await client.listConnections('tok', 'evt-1');
    expect(get.mock.calls[0][0]).toBe('https://api.xero.com/connections');
    expect(get.mock.calls[0][1].params).toEqual({ authEventId: 'evt-1' });
    await client.listConnections('tok');
    expect(get.mock.calls[1][1].params).toBeUndefined();
  });

  it('listConnections sanitises a failure: no access token in the message or JSON', async () => {
    const get = jest.fn().mockReturnValue(
      throwError(() => ({
        response: { status: 401, data: { error: 'unauthorized' } },
        config: { headers: { Authorization: 'Bearer secret-access-token' } },
      })),
    );
    const err = await make({ get }).listConnections('secret-access-token').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('secret-access-token');
    expect(JSON.stringify(err)).not.toContain('secret-access-token');
    expect(errSpy.mock.calls.map((c) => String(c[0])).join(' ')).not.toContain('secret-access-token');
  });

  it('getOrganisation sanitises a failure: no access token in the message or JSON', async () => {
    const get = jest.fn().mockReturnValue(
      throwError(() => ({
        response: { status: 401, data: { error: 'unauthorized' } },
        config: { headers: { Authorization: 'Bearer secret-access-token' } },
      })),
    );
    const err = await make({ get }).getOrganisation('secret-access-token', 'tenant-1').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('secret-access-token');
    expect(JSON.stringify(err)).not.toContain('secret-access-token');
    expect(errSpy.mock.calls.map((c) => String(c[0])).join(' ')).not.toContain('secret-access-token');
  });
});
