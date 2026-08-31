/**
 * Chargeability resolution.
 *
 * Four layers can answer "is this time billable?", and the most specific one
 * that has an opinion wins — in EITHER direction, so a rule can make one
 * person's time chargeable on an otherwise non-chargeable task.
 *
 * The global `excludedAssignees` setting is deliberately NOT part of this. That
 * decides whether we COST an identity, not whether the work is billable; the
 * two are orthogonal, and it already short-circuits in
 * `CostCalculatorService.calculate` before chargeability is consulted.
 */
export type ChargeabilitySource = 'entry' | 'assignee' | 'task' | 'default';

export interface ChargeabilityInput {
  /** `clickup_time_entries.chargeable_override`. null = no override. */
  entryOverride?: boolean | null;
  /** The `(task, assignee)` rule, if one exists. */
  rule?: boolean | null;
  /** `clickup_tasks.is_chargeable`. null/undefined = no task to read. */
  taskChargeable?: boolean | null;
}

export interface ResolvedChargeability {
  chargeable: boolean;
  source: ChargeabilitySource;
}

export function resolveChargeability(input: ChargeabilityInput): ResolvedChargeability {
  // `typeof === 'boolean'` and not a truthiness check: `false` is a real answer
  // from every layer, and `null`/`undefined` both mean "no opinion".
  if (typeof input.entryOverride === 'boolean') return { chargeable: input.entryOverride, source: 'entry' };
  if (typeof input.rule === 'boolean') return { chargeable: input.rule, source: 'assignee' };
  if (typeof input.taskChargeable === 'boolean') return { chargeable: input.taskChargeable, source: 'task' };
  // No task, or a task we couldn't read: chargeable. Matches the column default
  // and keeps task-less entries in the chargeable bucket, as they were before.
  return { chargeable: true, source: 'default' };
}

/** Key for the batch rule lookup Maps. `|` cannot occur in a ClickUp id. */
export function ruleKey(taskId: string, userId: string): string {
  return `${taskId}|${userId}`;
}

export interface PartialChargeabilityInput {
  /** `clickup_tasks.is_chargeable` — the flag the pill would otherwise show. */
  taskChargeable: boolean;
  /**
   * The `(task, assignee)` rules on this task. A rule matching the task flag
   * splits nothing, so only a DISAGREEING rule counts — otherwise reverting a
   * rule instead of clearing it would strand the task on "partial" forever.
   */
  rules: boolean[];
  /** Resolved entry counts. Omitted by callers that have no entry signal. */
  entryCount?: number;
  nonChargeableCount?: number;
}

/**
 * Is this task's chargeability split — i.e. does its own flag fail to describe
 * every hour on it? Drives the tri-state pill.
 *
 * Deliberately shared by two callers with DIFFERENT scoping: the Tasks page
 * asks about the task as a whole (unscoped, rules included), the grouped-by-task
 * rows on the Time Entries page ask only about the entries inside the current
 * filter window (window-scoped, `rules: []`) so the pill cannot contradict the
 * hours and cost printed beside it. What must not drift between them — the
 * mixed-entries condition — lives here once.
 */
export function isPartiallyChargeable(input: PartialChargeabilityInput): boolean {
  if (input.rules.some((r) => r !== input.taskChargeable)) return true;
  const { entryCount = 0, nonChargeableCount = 0 } = input;
  // Counts, never an hours sum: a bucket of 0-duration non-chargeable entries
  // must still read as split.
  return nonChargeableCount > 0 && nonChargeableCount < entryCount;
}
