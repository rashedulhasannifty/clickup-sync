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
  SYNC_TASK_TIME_ENTRIES: 'sync-task-time-entries',
  BACKFILL_CLICKUP_SPACE: 'backfill-clickup-space',
  REFRESH_CLICKUP_WEBHOOKS: 'refresh-clickup-webhooks',
  REPLACE_TIME_ENTRY_ASSIGNEES: 'replace-time-entry-assignees',
  RECALCULATE_COSTS: 'recalculate-costs',
} as const;
