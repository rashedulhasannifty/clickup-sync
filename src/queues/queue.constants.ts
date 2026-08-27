export const QUEUES = {
  CLICKUP_WEBHOOKS: 'clickup-webhooks',
  CLICKUP_TASKS: 'clickup-tasks',
  CLICKUP_TIME_ENTRIES: 'clickup-time-entries',
  CLICKUP_BACKFILLS: 'clickup-backfills',
  MAINTENANCE: 'maintenance',
  CLICKUP_ASSIGNEE_REPLACEMENT: 'clickup-assignee-replacement',
} as const;

/**
 * Worker options for processors that call the ClickUp API. The BullMQ limiter
 * caps how many jobs a worker runs per window so we don't blow ClickUp's rate
 * limit — important once worker concurrency is raised above the default of 1
 * (and a safety net for multi-instance deploys). Tunable via env.
 */
export function clickupWorkerOptions() {
  return {
    limiter: {
      max: Number(process.env.CLICKUP_JOB_RATE_MAX || 30),
      duration: Number(process.env.CLICKUP_JOB_RATE_DURATION_MS || 60_000),
    },
  };
}

export const JOBS = {
  PROCESS_CLICKUP_EVENT: 'process-clickup-event',
  SYNC_CLICKUP_TASK: 'sync-clickup-task',
  DELETE_CLICKUP_TASK: 'delete-clickup-task',
  RECONCILE_CLICKUP_TASK: 'reconcile-clickup-task',
  SYNC_TASK_TIME_ENTRIES: 'sync-task-time-entries',
  RECONCILE_TIME_ENTRIES_WINDOW: 'reconcile-time-entries-window',
  BACKFILL_CLICKUP_SPACE: 'backfill-clickup-space',
  REFRESH_CLICKUP_WEBHOOKS: 'refresh-clickup-webhooks',
  REPLACE_TIME_ENTRY_ASSIGNEES: 'replace-time-entry-assignees',
  RECALCULATE_COSTS: 'recalculate-costs',
  SYNC_LIST_CATALOG: 'sync-list-catalog',
} as const;

/**
 * BullMQ priority for ANY bulk sweep that shares a queue with live traffic.
 *
 * Counter-intuitive but load-bearing: in BullMQ, priority `0` (the default) is
 * the HIGHEST priority — non-prioritized jobs sit in the FIFO `wait` list and
 * `moveToActive` drains that list BEFORE it touches the prioritized set. So a
 * large space backfill, which enqueues thousands of time-entry jobs at the
 * default priority, would head-of-line-block live `taskTimeTrackedUpdated`
 * webhook jobs enqueued afterwards (also default priority) behind the entire
 * backlog — hours of delay on the same shared queue.
 *
 * Giving bulk jobs an explicit priority (>= 1) moves them into the prioritized
 * set, so they only run when the `wait` list is empty. Live webhook jobs and
 * manual single-task admin syncs stay at the default priority (0) and are always
 * served first. The exact number doesn't matter (nothing else is prioritized);
 * it just has to be non-zero.
 *
 * Applies to EVERY queue a sweep can flood, not just `clickup-time-entries`:
 * `tasks/reconcile` fans out onto `clickup-tasks`, which the webhook path also
 * feeds, and the replacement backfill shares `clickup-assignee-replacement` with
 * live tag-driven replacements. Any new endpoint that enqueues per-task or
 * per-entry in a loop must set this — the failure is silent, showing up only as
 * real-time sync mysteriously lagging by hours.
 */
export const BULK_SWEEP_PRIORITY = 100;
