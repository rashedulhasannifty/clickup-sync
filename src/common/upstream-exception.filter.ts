import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/** Longest slice of ClickUp's error body we echo back to the browser. */
const MAX_DETAIL_CHARS = 300;

type UpstreamError = {
  isAxiosError?: boolean;
  message?: string;
  response?: { status?: number; data?: unknown };
  config?: { method?: string; url?: string };
};

function isAxiosError(err: unknown): err is UpstreamError {
  return typeof err === 'object' && err !== null && (err as UpstreamError).isAxiosError === true;
}

/** Pull the human reason out of ClickUp's `{ err, ECODE }` body (or whatever it sent). */
function describe(data: unknown): string {
  if (data === undefined || data === null || data === '') return '';
  if (typeof data === 'string') return data.slice(0, MAX_DETAIL_CHARS);
  if (typeof data === 'object') {
    const body = data as { err?: unknown; error?: unknown; ECODE?: unknown };
    const reason = typeof body.err === 'string' ? body.err : typeof body.error === 'string' ? body.error : null;
    if (reason) return (body.ECODE ? `${reason} (${String(body.ECODE)})` : reason).slice(0, MAX_DETAIL_CHARS);
  }
  try {
    return JSON.stringify(data).slice(0, MAX_DETAIL_CHARS);
  } catch {
    return '';
  }
}

/**
 * Without this, an AxiosError from `ClickupClient` was not an `HttpException`,
 * so Nest's default handler turned EVERY upstream failure — a bad token, an
 * unreachable webhook endpoint, an exhausted 429 — into a bare
 * `500 Internal server error`. The operator saw "Request failed with status
 * code 500" in the UI and the only copy of the real reason was a server log
 * line. Re-emit it as a 502 that names ClickUp's own status and message.
 *
 * 502, deliberately, and never the upstream status verbatim: a ClickUp 401
 * echoed as our 401 trips the SPA's response interceptor and bounces the
 * operator to /login, which is a lie — their session is fine, the API token
 * isn't. 502 also reads correctly: an upstream we depend on failed.
 */
@Catch()
export class UpstreamExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(UpstreamExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res
        .status(exception.getStatus())
        .json(typeof body === 'string' ? { statusCode: exception.getStatus(), message: body } : body);
      return;
    }

    if (isAxiosError(exception)) {
      const upstreamStatus = exception.response?.status ?? null;
      const detail = describe(exception.response?.data);
      const target = exception.config?.url?.includes('clickup.com') ? 'ClickUp' : 'the upstream API';
      // No status means nothing answered — DNS, socket, timeout. Say exactly
      // that rather than echoing axios's message, which carries the resolved
      // host/IP we don't want in a browser response.
      const message = upstreamStatus
        ? `${target} rejected the request (HTTP ${upstreamStatus})` + (detail ? `: ${detail}` : '')
        : `No response from ${target} (network error or timeout)`;
      const req = http.getRequest();
      this.logger.error(`${req?.method} ${req?.url} -> ${message}`);
      res.status(HttpStatus.BAD_GATEWAY).json({
        statusCode: HttpStatus.BAD_GATEWAY,
        message,
        upstreamStatus,
      });
      return;
    }

    // Anything else stays an opaque 500 on purpose: internal messages can carry
    // connection strings, hostnames and other detail the browser must not see.
    this.logger.error(
      `Unhandled exception on ${http.getRequest()?.method} ${http.getRequest()?.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' });
  }
}
