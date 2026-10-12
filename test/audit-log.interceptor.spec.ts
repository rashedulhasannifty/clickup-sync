import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditLogInterceptor } from '../src/admin/audit-log.interceptor';

function makeRepo() {
  return { create: jest.fn().mockResolvedValue(undefined) };
}

function makeCtx(opts: {
  method: string;
  path: string;
  routePath?: string;
  params?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  statusCode?: number;
}) {
  const req = {
    method: opts.method,
    path: opts.path,
    route: opts.routePath ? { path: opts.routePath } : undefined,
    params: opts.params ?? {},
    headers: opts.headers ?? {},
    body: opts.body,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = { statusCode: opts.statusCode ?? 200 };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

function makeNext(result: unknown | Error) {
  return {
    handle: () =>
      result instanceof Error ? throwError(() => result) : of(result),
  };
}

describe('AuditLogInterceptor', () => {
  it('does not write for GET requests', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(makeCtx({ method: 'GET', path: '/admin/audit-log' }), makeNext({ ok: 1 })));
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('writes a row on POST success with status, duration, redacted body', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(
      makeCtx({
        method: 'POST',
        path: '/admin/rates',
        routePath: '/admin/rates',
        body: { secret: 'pk_should_redact', amountCents: 12345 },
        headers: { 'x-admin-user': 'rashedul', 'user-agent': 'jest' },
        statusCode: 201,
      }),
      makeNext({ ok: 1 }),
    ));
    expect(repo.create).toHaveBeenCalledTimes(1);
    const call = repo.create.mock.calls[0][0];
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/admin/rates');
    expect(call.statusCode).toBe(201);
    expect(call.actor).toBe('rashedul');
    expect(call.userAgent).toBe('jest');
    expect(call.errorMessage).toBeNull();
    expect(call.requestBody.secret).toBe('[REDACTED]');
    expect(call.requestBody.amountCents).toBe(12345);
    expect(typeof call.durationMs).toBe('number');
  });

  it('writes a row on error with errorMessage and non-2xx status', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    const err = Object.assign(new Error('boom'), { status: 400 });
    await expect(lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/admin/rates', body: {} }),
      makeNext(err),
    ))).rejects.toThrow('boom');
    const call = repo.create.mock.calls[0][0];
    expect(call.errorMessage).toBe('boom');
    expect(call.statusCode).toBe(400);
  });

  it('redacts nested keys matching the pattern', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'PATCH', path: '/x', body: { outer: { apiKey: 'k', token: 't', name: 'ok' } } }),
      makeNext({}),
    ));
    const body = repo.create.mock.calls[0][0].requestBody;
    expect(body.outer.apiKey).toBe('[REDACTED]');
    expect(body.outer.token).toBe('[REDACTED]');
    expect(body.outer.name).toBe('ok');
  });

  it('handles cyclic body without throwing', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    const cyclic: any = { a: 1 };
    cyclic.self = cyclic;
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/x', body: cyclic }),
      makeNext({}),
    ));
    const body = repo.create.mock.calls[0][0].requestBody;
    expect(body._redactionError).toBe(true);
  });

  it('truncates bodies > 16 KB', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    const big = 'x'.repeat(20000);
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/x', body: { blob: big } }),
      makeNext({}),
    ));
    const body = repo.create.mock.calls[0][0].requestBody;
    expect(body._truncated).toBe(true);
    expect(typeof body.preview).toBe('string');
    expect(body.preview.length).toBeLessThanOrEqual(16384);
  });

  it('omits actor when X-Admin-User header is absent', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'DELETE', path: '/admin/rates/9', body: {} }),
      makeNext({}),
    ));
    expect(repo.create.mock.calls[0][0].actor).toBeNull();
  });

  it('does not throw user-visible error when repo.create rejects', async () => {
    const repo = { create: jest.fn().mockRejectedValue(new Error('db down')) };
    const interceptor = new AuditLogInterceptor(repo as any);
    const out = await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/x', body: {} }),
      makeNext({ ok: 1 }),
    ));
    expect(out).toEqual({ ok: 1 });
  });
});

describe('AuditLogInterceptor — secret-shaped path params', () => {
  it('redacts a :token route param and never persists the raw token', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(
      makeCtx({
        method: 'POST',
        path: '/auth/invitations/abc123secrettoken/accept',
        routePath: '/auth/invitations/:token/accept',
        params: { token: 'abc123secrettoken' },
        body: { name: 'New', password: 'longenough10' },
      }),
      makeNext({ ok: 1 }),
    ));
    const call = repo.create.mock.calls[0][0];
    expect(call.path).toBe('/auth/invitations/[REDACTED]/accept');
    expect(call.path).not.toContain('abc123secrettoken');
    expect(call.routePattern).toBe('/auth/invitations/:token/accept');
  });

  it('keeps a normal :id route param as the real value', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(
      makeCtx({
        method: 'PATCH',
        path: '/users/u1/role',
        routePath: '/users/:id/role',
        params: { id: 'u1' },
        body: { role: 'ADMIN' },
      }),
      makeNext({ ok: 1 }),
    ));
    const call = repo.create.mock.calls[0][0];
    expect(call.path).toBe('/users/u1/role');
  });

  it('falls back to req.path when there is no route pattern', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/x/unmatched', body: {} }),
      makeNext({ ok: 1 }),
    ));
    const call = repo.create.mock.calls[0][0];
    expect(call.path).toBe('/x/unmatched');
  });

  it('redacts salary-bearing past-record fields (from, to, amount) on the past-records routes only', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    const row = { employee: 'a@x', record: 'Increment', date: '2025-07-01', from: 40000, to: '46000', amount: '15%', notes: 'ok' };
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/api/people/past-records/apply', routePath: '/api/people/past-records/apply', body: { rows: [row] } }),
      makeNext({}),
    ));
    await lastValueFrom(interceptor.intercept(
      makeCtx({
        method: 'PATCH',
        path: '/api/people/employees/e1/past-records/event:5',
        routePath: '/api/people/employees/:id/past-records/:recordId',
        params: { id: 'e1', recordId: 'event:5' },
        body: { record: 'Increment', date: '2025-07-01', from: 40000, to: 46000, fromValue: '1', toValue: '2' },
      }),
      makeNext({}),
    ));
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/api/other', routePath: '/api/other', body: { from: '2026-01-01', to: '2026-02-01' } }),
      makeNext({}),
    ));
    const [apply, patch, other] = repo.create.mock.calls.map((c) => c[0].requestBody);
    expect(apply.rows[0]).toEqual({
      employee: 'a@x', record: 'Increment', date: '2025-07-01',
      from: '[REDACTED]', to: '[REDACTED]', amount: '[REDACTED]', notes: 'ok',
    });
    expect(patch).toMatchObject({ from: '[REDACTED]', to: '[REDACTED]', fromValue: '[REDACTED]', toValue: '[REDACTED]' });
    expect(JSON.stringify([apply, patch])).not.toMatch(/40000|46000/);
    // Elsewhere `from`/`to` are ordinary (date ranges) and stay readable.
    expect(other).toEqual({ from: '2026-01-01', to: '2026-02-01' });
  });
});
