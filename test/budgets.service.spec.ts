import { BudgetsService } from '../src/budgets/budgets.service';

function makeDeps(dailyRows: any[], budgetRows: any[]) {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue(dailyRows) };
  const repo = { findAllRows: jest.fn().mockResolvedValue(budgetRows) };
  return { prisma, repo, service: new BudgetsService(prisma as never, repo as never) };
}

describe('BudgetsService.clientBudgetStatus', () => {
  it('resolves the latest-validFrom budget covering the month and computes status', async () => {
    // Month June 2026, "today" mid-month on a weekday.
    const now = new Date('2026-06-15T08:00:00Z'); // Dhaka 14:00 on Mon 2026-06-15
    const daily = [
      { day: '2026-06-01', client: 'Acme', cost_cents: 300000n, hours: '20' },
      { day: '2026-06-10', client: 'Acme', cost_cents: 300000n, hours: '20' },
    ];
    const budgets = [
      { id: '2', client: 'Acme', monthlyAmountCents: 1000000, currency: 'USD', validFrom: new Date('2026-06-01'), validTo: null, notes: null },
      { id: '1', client: 'Acme', monthlyAmountCents: 500000, currency: 'USD', validFrom: new Date('2026-01-01'), validTo: new Date('2026-05-31'), notes: null },
    ];
    const { service } = makeDeps(daily, budgets);

    const rows = await service.clientBudgetStatus({ month: '2026-06', now });

    const acme = rows.find((r) => r.client === 'Acme')!;
    expect(acme.monthlyAmount).toBe(10000); // dollars, from the June row (latest validFrom)
    expect(acme.mtdCost).toBe(6000);
    expect(acme.mtdHours).toBe(40);
    expect(acme.forecastRunRate).toBeGreaterThan(acme.mtdCost);
    expect(['under', 'near', 'projected-over', 'over']).toContain(acme.status);
  });

  it('marks a client with spend but no budget row as no-budget', async () => {
    const now = new Date('2026-06-15T08:00:00Z');
    const daily = [{ day: '2026-06-05', client: 'NoBudgetCo', cost_cents: 100000n, hours: '5' }];
    const { service } = makeDeps(daily, []);

    const rows = await service.clientBudgetStatus({ month: '2026-06', now });

    expect(rows.find((r) => r.client === 'NoBudgetCo')!.status).toBe('no-budget');
  });

  it('for a fully past month, both forecasts equal the actual', async () => {
    const now = new Date('2026-06-15T08:00:00Z');
    const daily = [{ day: '2026-03-10', client: 'Acme', cost_cents: 400000n, hours: '25' }];
    const budgets = [{ id: '1', client: 'Acme', monthlyAmountCents: 1000000, currency: 'USD', validFrom: new Date('2026-01-01'), validTo: null, notes: null }];
    const { service } = makeDeps(daily, budgets);

    const rows = await service.clientBudgetStatus({ month: '2026-03', now });
    const acme = rows.find((r) => r.client === 'Acme')!;

    expect(acme.forecastRunRate).toBe(acme.mtdCost);
    expect(acme.forecastTrailing).toBe(acme.mtdCost);
  });
});
