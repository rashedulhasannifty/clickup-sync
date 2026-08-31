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
  /**
   * `clickup_tasks.is_chargeable` — the flag the pill would otherwise show.
   * Only ever consulted against `rules`, so a caller that passes no rules has
   * nothing to compare it to and may omit it. Required whenever `rules` is
   * non-empty.
   */
  taskChargeable?: boolean;
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
  const { taskChargeable, entryCount = 0, nonChargeableCount = 0 } = input;
  // 1. A rule contradicts the flag. Fires even with no entries yet, which is
  //    the prospective case standing rules exist for.
  if (taskChargeable !== undefined && input.rules.some((r) => r !== taskChargeable)) return true;
  // 2. The entries contradict each other. Counts, never an hours sum: a task
  //    split only by 0-duration entries is still split.
  if (nonChargeableCount > 0 && nonChargeableCount < entryCount) return true;
  // 3. Every entry contradicts the flag. Not covered by either arm above —
  //    an override can flip ALL of a task's time without touching a rule, and
  //    without leaving the entries disagreeing with each other. Missing this
  //    let a task read as wholly chargeable while every hour on it was not,
  //    and put it in none of the three filter buckets. The `entryCount > 0`
  //    guard matters: a task with no time agrees with its flag vacuously.
  if (taskChargeable !== undefined && entryCount > 0) {
    if (taskChargeable && nonChargeableCount === entryCount) return true;
    if (!taskChargeable && nonChargeableCount === 0) return true;
  }
  return false;
}
