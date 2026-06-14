import type { BudgetStatus } from '../api/budgets';

/**
 * Mirror of src/budgets/budget-forecast.ts deriveBudgetStatus — used when the
 * Run-rate/Trailing toggle flips so the badge recomputes from the trailing
 * forecast without a refetch. Keep thresholds in sync with the backend.
 */
export const NEAR_THRESHOLD = 0.85;

export function deriveBudgetStatus(actual: number, forecast: number, budget: number | null): BudgetStatus {
  if (!budget || budget <= 0) return 'no-budget';
  if (actual >= budget) return 'over';
  if (forecast >= budget) return 'projected-over';
  if (forecast >= budget * NEAR_THRESHOLD) return 'near';
  return 'under';
}

export const STATUS_LABEL: Record<BudgetStatus, string> = {
  'over': 'Over budget',
  'projected-over': 'Projected over',
  'near': 'Near limit',
  'under': 'On track',
  'no-budget': 'No budget',
};
