import { apiClient } from './client';

export interface Budget {
  id: string;
  client: string;
  monthlyAmountCents: number;
  currency: string;
  validFrom: string;
  validTo: string | null;
  notes: string | null;
  updatedAt: string;
}

export type BudgetStatus = 'over' | 'projected-over' | 'near' | 'under' | 'no-budget';

export interface BudgetStatusRow {
  client: string;
  monthlyAmount: number | null;
  currency: string | null;
  mtdCost: number;
  mtdHours: number;
  forecastRunRate: number;
  forecastTrailing: number;
  pctOfBudget: number | null;
  forecastPct: number | null;
  status: BudgetStatus;
  dailySeries: { date: string; cost: number }[];
}

function parseListResponse(data: unknown): Budget[] {
  if (Array.isArray(data)) return data as Budget[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: Budget[] }).items;
  }
  return [];
}

export const budgetsApi = {
  list: () =>
    apiClient.get('/admin/budgets', { params: { page: 1, limit: 200 } }).then((r) => parseListResponse(r.data)),
  create: (data: Omit<Budget, 'id' | 'updatedAt'>) =>
    apiClient.post('/admin/budgets', data).then((r) => r.data as Budget),
  update: (id: string, data: Partial<Omit<Budget, 'id' | 'updatedAt'>>) =>
    apiClient.patch(`/admin/budgets/${id}`, data).then((r) => r.data as Budget),
  remove: (id: string) => apiClient.delete(`/admin/budgets/${id}`).then((r) => r.data),
  status: (month?: string) =>
    apiClient.get('/reports/budgets/status', { params: month ? { month } : {} }).then((r) => r.data as BudgetStatusRow[]),
};
