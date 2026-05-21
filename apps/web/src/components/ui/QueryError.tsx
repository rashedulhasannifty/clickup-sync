import { AlertTriangle } from 'lucide-react';
import { Callout } from './Callout';
import { Button } from './Button';

/**
 * Minimal React-Query result shape. We don't import `UseQueryResult` directly
 * because the generic parameters vary across call sites and the only fields
 * we care about are the three error flags + `refetch`.
 */
export interface QueryLike {
  isError: boolean;
  error: unknown;
  refetch?: () => unknown;
  isFetching?: boolean;
}

/**
 * Drop-in error banner for any React-Query result. Renders nothing when there
 * is no error. Use it directly under the page header (or section header) so
 * 500s/network failures stop looking like "everything is empty".
 *
 * Example:
 *   const tasks = useTasks(params);
 *   ...
 *   <QueryError query={tasks} what="tasks" />
 *
 * Pass multiple queries via `queries` if you want one banner that surfaces
 * the first failing one — useful on dashboards that fan out a dozen calls.
 */
export function QueryError({
  query,
  queries,
  what = 'data',
}: {
  query?: QueryLike;
  queries?: QueryLike[];
  /** Short noun for the message — "tasks", "time entries", "sync logs". */
  what?: string;
}) {
  const all = queries ?? (query ? [query] : []);
  const failing = all.find(q => q.isError);
  if (!failing) return null;

  const message = errorMessage(failing.error);

  return (
    <Callout tone="error" icon={<AlertTriangle size={14} strokeWidth={1.75} />}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>
          <strong>Couldn't load {what}.</strong>
          {message ? <> {message}</> : null}
        </span>
        {failing.refetch && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => failing.refetch?.()}
            disabled={failing.isFetching}
          >
            {failing.isFetching ? 'Retrying…' : 'Retry'}
          </Button>
        )}
      </div>
    </Callout>
  );
}

function errorMessage(err: unknown): string {
  if (!err) return '';
  // Axios-style error → response.data.message or statusText
  if (typeof err === 'object' && err !== null) {
    const e = err as {
      response?: { status?: number; statusText?: string; data?: { message?: string } };
      message?: string;
    };
    const apiMsg = e.response?.data?.message;
    if (apiMsg) return String(apiMsg);
    const status = e.response?.status;
    if (status) {
      const text = e.response?.statusText ? ` ${e.response.statusText}` : '';
      return `HTTP ${status}${text}.`;
    }
    if (e.message) return String(e.message);
  }
  return String(err);
}
