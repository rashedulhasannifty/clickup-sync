const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * How far past "now" a time-entry window reaches. A user can log a manual entry
 * whose end is still in the future (e.g. 15:15-16:00 entered at 15:55), and the
 * sync fires the moment they save it. ClickUp leaves an entry out of a window
 * that closes before it ends, so a window ending at `Date.now()` returned
 * nothing for that entry, and no later event re-read it. One day covers any
 * entry logged ahead of its end.
 */
export const TIME_ENTRIES_FUTURE_MS = 24 * 60 * 60 * 1000;

/** End of a time-entry window that starts in the past and runs to "now". */
export function timeEntriesWindowEnd(now: number = Date.now()): number {
  return now + TIME_ENTRIES_FUTURE_MS;
}

export interface TimeEntriesQueryOptions {
  taskId?: string;
  spaceId?: string;
  assigneeIds?: string[];
  startDate?: number;
  endDate?: number;
}

/**
 * Resolves the effective [startMs, endMs] window for a time-entries fetch.
 *
 * ClickUp defaults the window to the current day only, so an explicit window is
 * always sent (default: 365-day lookback ending a day after now — see
 * TIME_ENTRIES_FUTURE_MS). Callers that also need to
 * *reconcile/prune* local rows must scope the prune to the SAME window the fetch
 * used — sharing this resolver keeps the two from drifting.
 */
export function resolveTimeEntriesWindow(options: TimeEntriesQueryOptions): { startMs: number; endMs: number } {
  const endMs = options.endDate ?? timeEntriesWindowEnd();
  const startMs = options.startDate ?? endMs - YEAR_MS;
  return { startMs, endMs };
}

/**
 * Builds the query string for ClickUp `GET /team/{team}/time_entries`.
 *
 * ClickUp returns ONLY the token owner's entries unless `assignee` is supplied,
 * so the caller must pass the user ids whose tracked time should be synced.
 */
export function buildTimeEntriesQuery(options: TimeEntriesQueryOptions): string {
  const params = new URLSearchParams();
  if (options.taskId) params.append('task_id', options.taskId);
  if (options.spaceId) params.append('space_id', options.spaceId);
  if (options.assigneeIds && options.assigneeIds.length > 0) {
    params.append('assignee', options.assigneeIds.join(','));
  }
  const { startMs, endMs } = resolveTimeEntriesWindow(options);
  params.append('start_date', String(startMs));
  params.append('end_date', String(endMs));
  return params.toString();
}

