import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { AuditLogRepository } from './audit-log.repository';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const REDACT_RE = /(secret|token|api[_-]?key|password|signature)/i;
const PATH_PARAM_RE = /:([A-Za-z0-9_]+)/g;
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Builds the path we persist to the audit log. A raw path segment (e.g. a
 * single-use invitation token, or any other secret-shaped route param) must
 * never land in the database — so this rebuilds the path from the route's
 * pattern (`req.route.path`, e.g. `/auth/invitations/:token/accept`),
 * substituting each `:paramName` with its real value, except a param whose
 * NAME matches REDACT_RE, which becomes `[REDACTED]`. Deliberately general:
 * any future `:token`/`:secret`/... route param is covered without a new rule.
 * Falls back to the resolved `req.path` (today's behavior) when there's no
 * route pattern to work from.
 */
function loggedPath(req: { path?: string; route?: { path?: string }; params?: Record<string, string> }): string {
  const pattern = req.route?.path;
  if (!pattern) return req.path ?? '';
  const params = req.params ?? {};
  return pattern.replace(PATH_PARAM_RE, (match, name: string) => {
    if (REDACT_RE.test(name)) return '[REDACTED]';
    const value = params[name];
    return value !== undefined ? String(value) : match;
  });
}

function redact(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) throw new Error('cyclic');
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_RE.test(k)) out[k] = '[REDACTED]';
    else out[k] = redact(v, seen);
  }
  return out;
}

function prepareBody(raw: unknown): unknown {
  if (raw === undefined || raw === null) return null;
  let processed: unknown;
  try {
    processed = redact(raw);
  } catch {
    return { _redactionError: true };
  }
  try {
    const json = JSON.stringify(processed);
    if (json.length <= MAX_BODY_BYTES) return processed;
    return { _truncated: true, preview: json.slice(0, MAX_BODY_BYTES) };
  } catch {
    return { _redactionError: true };
  }
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);
  constructor(private readonly repo: AuditLogRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!WRITE_METHODS.has(req.method)) return next.handle();

    const startedAt = Date.now();
    const meta = {
      method: req.method as string,
      path: loggedPath(req),
      routePattern: (req.route?.path as string | undefined) ?? null,
      actor:
        ((req.user?.email as string | undefined) ??
          (req.user?.isMachine ? 'machine-key' : undefined) ??
          (req.headers['x-admin-user'] as string | undefined)) ||
        null,
      ip:
        ((req.ip as string | undefined) ??
          (req.socket?.remoteAddress as string | undefined) ??
          null) || null,
      userAgent: ((req.headers['user-agent'] as string | undefined) ?? null) || null,
      requestBody: prepareBody(req.body),
    };

    const write = (statusCode: number, errorMessage: string | null) => {
      this.repo
        .create({ ...meta, statusCode, durationMs: Date.now() - startedAt, errorMessage })
        .catch((err) => this.logger.error('Failed to write audit log row', err));
    };

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        write(res.statusCode ?? 200, null);
      }),
      catchError((err) => {
        const statusCode = typeof err?.status === 'number' ? err.status : 500;
        const message =
          (typeof err?.message === 'string' ? err.message : String(err)) || 'error';
        write(statusCode, message);
        return throwError(() => err);
      }),
    );
  }
}
