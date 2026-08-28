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
