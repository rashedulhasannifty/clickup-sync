import { of, throwError } from 'rxjs';
import { formatModifiedSince, XeroClient } from './xero.client';
import { XeroApiError, XeroRateBudgetExhaustedError } from './xero-errors';
import { MAX_429_RETRIES, MAX_PAGES, PAGE_SIZE } from './xero.constants';

function setup(responses: Array<unknown>) {
  const request = jest.fn();
  for (const r of responses) {
    if (r instanceof Error || (r as { response?: unknown })?.response) request.mockReturnValueOnce(throwError(() => r));
    else request.mockReturnValueOnce(of(r));
  }
  const tokens = { getAccessToken: jest.fn().mockResolvedValue({ accessToken: 'tok', tenantId: 'tenant-1' }) };
  const redisSet = jest.fn().mockResolvedValue('OK');
  const queues = { redis: async () => ({ set: redisSet }) };
  const client = new XeroClient({ request } as never, tokens as never, queues as never);
  client.minIntervalMs = 0;
  client.sleep = jest.fn().mockResolvedValue(undefined);
  return { client, request, tokens, redisSet };
}

const ok = (data: unknown, headers: Record<string, string> = {}) => ({ data, headers });
const page = (n: number) => ({ Invoices: Array.from({ length: n }, (_, i) => ({ InvoiceID: `i${i}` })) });

describe('formatModifiedSince', () => {
  it('is ISO-8601 UTC without zone or millis', () => {
    expect(formatModifiedSince(new Date('2026-09-15T10:00:00.123Z'))).toBe('2026-09-15T10:00:00');
  });
});

describe('XeroClient.getFile', () => {
  it('issues a GET asking for the file type, as raw bytes, bounded in size', async () => {
    const { client, request } = setup([ok(new Uint8Array([37, 80, 68, 70]).buffer, { 'content-type': 'application/pdf' })]);
    const file = await client.getFile('/Invoices/p/Attachments/a', 'application/pdf');
    const cfg = request.mock.calls[0][0];
    expect(cfg.method).toBe('GET');
    expect(cfg.url).toBe('https://api.xero.com/api.xro/2.0/Invoices/p/Attachments/a');
    expect(cfg.headers.Accept).toBe('application/pdf');
    expect(cfg.headers['xero-tenant-id']).toBe('tenant-1');
    expect(cfg.responseType).toBe('arraybuffer');
    expect(cfg.maxContentLength).toBe(25 * 1024 * 1024);
    expect(file.data.toString()).toBe('%PDF');
    expect(file.contentType).toBe('application/pdf');
  });

  it('retries a 429 like every other read', async () => {
    const e429 = { response: { status: 429, headers: { 'retry-after': '0' } } };
    const { client, request } = setup([e429, ok(new Uint8Array([1]).buffer)]);
    await client.getFile('/Invoices/p/Attachments/a', 'image/png');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('is not blocked by a stale low day-budget reading (web role never calls beginRun)', async () => {
    const { client, request } = setup([
      ok({ Invoices: [] }, { 'x-daylimit-remaining': '10' }),
      ok(new Uint8Array([1]).buffer),
    ]);
    await client.get('/Invoices');
    await expect(client.get('/Invoices')).rejects.toBeInstanceOf(XeroRateBudgetExhaustedError);
    await expect(client.getFile('/Invoices/p/Attachments/a', 'image/png')).resolves.toBeDefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps JSON reads JSON: get() does not ask for bytes', async () => {
    const { client, request } = setup([ok({ Invoices: [] })]);
    await client.get('/Invoices');
    expect(request.mock.calls[0][0].headers.Accept).toBe('application/json');
    expect(request.mock.calls[0][0].responseType).toBeUndefined();
  });
});

describe('XeroClient.get', () => {
  it('sends an authenticated GET with the tenant header', async () => {
    const { client, request } = setup([ok({ Contacts: [] })]);
    await client.get('/Contacts', { params: { includeArchived: 'true' } });
    const cfg = request.mock.calls[0][0];
    expect(cfg).toMatchObject({ method: 'GET', url: 'https://api.xero.com/api.xro/2.0/Contacts', params: { includeArchived: 'true' } });
    expect(cfg.headers).toMatchObject({ Authorization: 'Bearer tok', 'xero-tenant-id': 'tenant-1' });
    expect(cfg.headers['If-Modified-Since']).toBeUndefined();
  });

  it('adds If-Modified-Since when given a watermark', async () => {
    const { client, request } = setup([ok({})]);
    await client.get('/Invoices', { modifiedSince: new Date('2026-09-01T00:00:00Z') });
    expect(request.mock.calls[0][0].headers['If-Modified-Since']).toBe('2026-09-01T00:00:00');
  });

  it('honours Retry-After on 429, then succeeds', async () => {
    const { client, request } = setup([{ response: { status: 429, headers: { 'retry-after': '2' } } }, ok({ Contacts: [] })]);
    await client.get('/Contacts');
    expect(client.sleep).toHaveBeenCalledWith(2000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('on a 401 forces one token refresh and retries once', async () => {
    const { client, request, tokens } = setup([{ response: { status: 401, headers: {} } }, ok({})]);
    await client.get('/Contacts');
    expect(tokens.getAccessToken).toHaveBeenCalledWith({ force: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('throws a sanitised XeroApiError that never contains the bearer token', async () => {
    const axiosLike = { message: 'Request failed', response: { status: 500, headers: {} }, config: { headers: { Authorization: 'Bearer tok' } } };
    const { client } = setup([axiosLike]);
    const err = await client.get('/Contacts').catch((e: Error) => e);
    expect(err).toBeInstanceOf(XeroApiError);
    expect(JSON.stringify(err)).not.toContain('Bearer');
    expect((err as Error).message).not.toContain('Bearer');
  });

  it('stops before calling when the day budget is below the floor', async () => {
    const { client, request, redisSet } = setup([ok({}, { 'x-daylimit-remaining': '499' })]);
    await client.get('/Contacts');
    expect(redisSet).toHaveBeenCalledWith('xero:day-remaining', '499', 'EX', 86400);
    await expect(client.get('/Contacts')).rejects.toBeInstanceOf(XeroRateBudgetExhaustedError);
    expect(request).toHaveBeenCalledTimes(1);
    client.beginRun(); // a new run re-measures
    request.mockReturnValueOnce(of(ok({})));
    await expect(client.get('/Contacts')).resolves.toEqual({});
  });

  it('paces calls: the second call waits', async () => {
    const { client } = setup([ok({}), ok({})]);
    client.minIntervalMs = 1100;
    await client.get('/A');
    await client.get('/B');
    const waits = (client.sleep as jest.Mock).mock.calls.map((c) => c[0]);
    expect(waits.some((ms: number) => ms > 1000)).toBe(true);
  });

  it('gives up after MAX_429_RETRIES and surfaces a XeroApiError instead of retrying again', async () => {
    const attempts = MAX_429_RETRIES + 1;
    const responses = Array.from({ length: attempts }, () => ({ response: { status: 429, headers: { 'retry-after': '1' } } }));
    const { client, request } = setup(responses);
    const err = await client.get('/Contacts').catch((e: Error) => e);
    expect(err).toBeInstanceOf(XeroApiError);
    expect((err as XeroApiError).status).toBe(429);
    expect(request).toHaveBeenCalledTimes(attempts);
  });
});

describe('XeroClient.pages', () => {
  it('starts at page=1 and stops after a short page', async () => {
    const { client, request } = setup([ok(page(100)), ok(page(37))]);
    const seen: number[] = [];
    for await (const items of client.pages('/Invoices', 'Invoices')) seen.push(items.length);
    expect(seen).toEqual([100, 37]);
    expect(request.mock.calls.map((c) => c[0].params.page)).toEqual(['1', '2']);
  });

  it('yields nothing for an empty first page', async () => {
    const { client, request } = setup([ok({ Invoices: [] })]);
    const seen: unknown[] = [];
    for await (const items of client.pages('/Invoices', 'Invoices')) seen.push(items);
    expect(seen).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops at MAX_PAGES even when every page is full', async () => {
    const { client, request } = setup([]);
    const fullPage = ok(page(PAGE_SIZE));
    request.mockImplementation(() => of(fullPage));
    const seen: number[] = [];
    for await (const items of client.pages('/Invoices', 'Invoices')) seen.push(items.length);
    expect(seen.length).toBe(MAX_PAGES);
    expect(seen.every((n) => n === PAGE_SIZE)).toBe(true);
    expect(request).toHaveBeenCalledTimes(MAX_PAGES);
    expect(request.mock.calls.map((c) => c[0].params.page)).toEqual(Array.from({ length: MAX_PAGES }, (_, i) => String(i + 1)));
  });
});

describe('read-only guardrail', () => {
  it('only ever issues GET and exposes no write helpers', async () => {
    const proto = Object.getOwnPropertyNames(XeroClient.prototype);
    for (const name of ['post', 'put', 'patch', 'delete', 'create', 'update']) expect(proto).not.toContain(name);
    const { client, request } = setup([ok({}), ok({ Contacts: [] })]);
    await client.get('/X');
    for await (const _ of client.pages('/Contacts', 'Contacts')) void _;
    for (const call of request.mock.calls) expect(call[0].method).toBe('GET');
  });
});
