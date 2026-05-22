import { apiClient } from './client';

export interface AuditLogRow {
  id: string;
  occurredAt: string;
  actor: string | null;
  method: string;
  path: string;
  routePattern: string | null;
  statusCode: number;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
  requestBody: unknown;
  errorMessage: string | null;
}

export interface AuditLogListResponse {
  items: AuditLogRow[];
  total: number;
}

export interface AuditLogQuery {
  limit?: number;
  offset?: number;
  actor?: string;
  routePattern?: string;
  from?: string;
  to?: string;
}

export const auditLogApi = {
  list: (query: AuditLogQuery = {}): Promise<AuditLogListResponse> =>
    apiClient
      .get('/admin/audit-log', {
        params: {
          limit: query.limit ?? 50,
          offset: query.offset ?? 0,
          actor: query.actor || undefined,
          routePattern: query.routePattern || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
      })
      .then((r) => r.data),
};
