import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditLogInterceptor } from '../src/admin/audit-log.interceptor';

function makeRepo() {
  return { create: jest.fn().mockResolvedValue(undefined) };
}

function makeCtx(opts: {
  method: string;
  path: string;
  routePath?: string;
  body?: unknown;
  headers?: Record<string, string>;
  statusCode?: number;
}) {
  const req = {
    method: opts.method,
    path: opts.path,
    route: opts.routePath ? { path: opts.routePath } : undefined,
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
