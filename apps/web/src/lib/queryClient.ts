import { QueryClient } from '@tanstack/react-query';

/**
 * Don't retry on client errors — they're not going to succeed on the next try
 * and the retry just delays the error banner.
 *
 * - 4xx (except 408/429): no retry. The request was malformed, unauthorized,
 *   or forbidden — retrying won't help.
 * - 408 Request Timeout / 429 Too Many Requests: retry once.
 * - 5xx and network errors (no `response.status`): retry once.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  const status =
    typeof error === 'object' && error !== null && 'response' in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined;
  if (status == null) return true; // network / no response → retry once
  if (status === 408 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return true; // 5xx → retry once
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
    },
    // Mutations intentionally use the React-Query default (no retry).
    // Several mutations here are non-idempotent — webhook registration,
    // sync-job enqueues, the tag-replacement backfill (creates ClickUp
    // entries + deletes the originals). A client-side retry on a 5xx
    // that already partially succeeded would double-write.
  },
});
