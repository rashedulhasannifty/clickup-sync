const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface TimeEntriesQueryOptions {
  assigneeIds?: string[];
  startDate?: number;
  endDate?: number;
}

/**
 * Builds the query string for ClickUp `GET /team/{team}/time_entries`.
 *
 * ClickUp returns ONLY the token owner's entries unless `assignee` is supplied,
 * so the caller must pass the user ids whose tracked time should be synced.
 * ClickUp also defaults the window to the current day only, so an explicit
 * start/end window is always sent (default: 365-day lookback).
 */
export function buildTimeEntriesQuery(taskId: string, options: TimeEntriesQueryOptions): string {
  const params = new URLSearchParams({ task_id: taskId });
  if (options.assigneeIds && options.assigneeIds.length > 0) {
    params.append('assignee', options.assigneeIds.join(','));
  }
  const endMs = options.endDate ?? Date.now();
  const startMs = options.startDate ?? endMs - YEAR_MS;
  params.append('start_date', String(startMs));
  params.append('end_date', String(endMs));
  return params.toString();
}

