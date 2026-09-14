/** Query params for /reports/work, in wire form (comma-separated multi-selects). */
export type WorkParams = Record<string, string | number | undefined>;

/**
 * Sentinel task id for "entries with no task". Mirrors `NO_TASK_ID` in
 * src/reports/report-filter.util.ts — keep the two identical.
 */
export const NO_TASK_ID = '__none__';

/**
 * Entries listed per expanded task. Far above any real task; guards a
 * pathological one. Same value and reason as `MAX_ENTRIES` in
 * TaskTimeEntriesPanel — WorkEntryRows says "Showing the first N of M" past it.
 */
export const MAX_ENTRIES_PER_TASK = 500;

/**
 * The /reports/time-entries params that list EXACTLY the entries /reports/work
 * counted for one task. This is the frontend half of the rule "expanded entries
 * add up to the row's Logged" — it must mirror `WorkReportService.entryWhere`:
 *
 * - entry filters: loggedBy -> userId, costStatus -> status, missingOnly
 * - task attributes: client, subProject, listId, folderId, archived, sprintStatus
 * - NOT spaceId: taskId already pins the space, and buildTimeEntryWhere's own
 *   space clause would drop a deleted task's entries (the row counts them)
 * - NOT search / chargeable / task-only filters: those choose rows, not entries
 */
export function toEntryListParams(p: WorkParams, taskId: string): WorkParams {
  return {
    from: p.from,
    to: p.to,
    userId: p.loggedBy,
    status: p.missingOnly === 'true' ? undefined : p.costStatus,
    missingOnly: p.missingOnly,
    client: p.client,
    subProject: p.subProject,
    listId: p.listId,
    folderId: p.folderId,
    archived: p.archived,
    sprintStatus: p.sprintStatus,
    taskId,
    limit: MAX_ENTRIES_PER_TASK,
    offset: 0,
  };
}
