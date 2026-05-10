export const QUEUES = {
  CLICKUP_WEBHOOKS: 'clickup-webhooks',
  CLICKUP_TASKS: 'clickup-tasks',
  CLICKUP_TIME_ENTRIES: 'clickup-time-entries',
  CLICKUP_BACKFILLS: 'clickup-backfills',
  ASSIGNEE_RATES: 'assignee-rates',
  MAINTENANCE: 'maintenance',
  CLICKUP_ASSIGNEE_REPLACEMENT: 'clickup-assignee-replacement',
} as const;

export const JOBS = {
  PROCESS_CLICKUP_EVENT: 'process-clickup-event',
  SYNC_CLICKUP_TASK: 'sync-clickup-task',
  DELETE_CLICKUP_TASK: 'delete-clickup-task',
  SYNC_TASK_TIME_ENTRIES: 'sync-task-time-entries',
  BACKFILL_CLICKUP_SPACE: 'backfill-clickup-space',
  SYNC_ASSIGNEE_RATES: 'sync-assignee-rates',
  REFRESH_CLICKUP_WEBHOOKS: 'refresh-clickup-webhooks',
  REPLACE_TIME_ENTRY_ASSIGNEES: 'replace-time-entry-assignees',
} as const;
