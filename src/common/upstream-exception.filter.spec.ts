import { ArgumentsHost, HttpException } from '@nestjs/common';
import { UpstreamExceptionFilter } from './upstream-exception.filter';

function hostWith(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/api/admin/webhooks/register' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function axiosError(status: number, data: unknown) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    config: { method: 'put', url: 'https://api.clickup.com/api/v2/webhook/abc' },
    response: { status, data },
  });
}

describe('UpstreamExceptionFilter', () => {
  it('turns a ClickUp 4xx into a 502 that names the upstream status and reason', () => {
    const { host, status, json } = hostWith();
    new UpstreamExceptionFilter().catch(
      axiosError(400, { err: 'Webhook endpoint unreachable', ECODE: 'OAUTH_162' }),
      host,
    );

    expect(status).toHaveBeenCalledWith(502);
    const body = json.mock.calls[0][0] as { statusCode: number; message: string; upstreamStatus: number };
    expect(body.upstreamStatus).toBe(400);
    expect(body.message).toContain('ClickUp');
    expect(body.message).toContain('400');
    expect(body.message).toContain('Webhook endpoint unreachable');
    expect(body.message).toContain('OAUTH_162');
  });

  it('never re-emits a 401 (that would log the operator out of this app)', () => {
    const { host, status, json } = hostWith();
    new UpstreamExceptionFilter().catch(axiosError(401, { err: 'Token invalid', ECODE: 'OAUTH_025' }), host);

    expect(status).toHaveBeenCalledWith(502);
    expect((json.mock.calls[0][0] as { message: string }).message).toContain('Token invalid');
  });

  it('does not echo the axios message when nothing responded (it carries the host/IP)', () => {
    const { host, status, json } = hostWith();
    const noResponse = Object.assign(new Error('connect ECONNREFUSED 104.18.0.1:443'), {
      isAxiosError: true,
      config: { method: 'get', url: 'https://api.clickup.com/api/v2/team/1/webhook' },
    });
    new UpstreamExceptionFilter().catch(noResponse, host);

    expect(status).toHaveBeenCalledWith(502);
    const body = json.mock.calls[0][0] as { message: string; upstreamStatus: number | null };
    expect(body.upstreamStatus).toBeNull();
    expect(body.message).toContain('No response from ClickUp');
    expect(body.message).not.toContain('104.18.0.1');
  });

  it('leaves a real HttpException alone', () => {
    const { host, status, json } = hostWith();
    new UpstreamExceptionFilter().catch(new HttpException('Nope', 403), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0][0]).toEqual({ statusCode: 403, message: 'Nope' });
  });

  it('keeps a non-axios error a 500 without leaking its message', () => {
    const { host, status, json } = hostWith();
    new UpstreamExceptionFilter().catch(new Error('connect ECONNREFUSED 10.0.0.5:5432'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('10.0.0.5');
  });
});
