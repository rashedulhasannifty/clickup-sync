import { ForbiddenException } from '@nestjs/common';
import { BudgetsService } from '../src/budgets/budgets.service';
import { resolveScope, type AccessScope } from '../src/access/access-scope';

function sqlOf(call: any): string {
  return call.sql ?? call.text ?? String(call);
}

function makeDeps(dailyRows: any[], budgetRows: any[], clientOptionsRows: any[] = []) {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue(dailyRows) };
  const repo = { findAllRows: jest.fn().mockResolvedValue(budgetRows) };
  const clientOptions = { list: jest.fn().mockResolvedValue(clientOptionsRows) };
  return { prisma, repo, clientOptions, service: new BudgetsService(prisma as never, repo as never, clientOptions as never) };
}

// `scope` is now a required field on the args object (Ruling R10). These
// existing tests use a shared UNRESTRICTED fixture; no assertion changes.
const UNRESTRICTED: AccessScope = { kind: 'unrestricted', canEdit: true };
// Flag-off MEMBER: scoping disabled entirely, unrestricted with canEdit:false.
// Ruling R1: requireLeadView must let this through unchanged.
const FLAG_OFF_MEMBER: AccessScope = { kind: 'unrestricted', canEdit: false };
// A MEMBER of exactly zero teams: `isLeadAnywhere` is false, so requireLeadView
// must 403 before any query runs.
const NONE = resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [], teamClients: [], teamMembers: [],
});
// LEAD of team A only, with LEAD client options 'o1' (Acme) and 'o2' (Shared).
const LEAD_A = resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [{ teamId: 'A', role: 'LEAD' }],
  teamClients: [
    { teamId: 'A', optionId: 'o1' },
    { teamId: 'A', optionId: 'o2' },
  ],
  teamMembers: [],
});

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

    const rows = await service.clientBudgetStatus({ month: '2026-06', now, scope: UNRESTRICTED });

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

    const rows = await service.clientBudgetStatus({ month: '2026-06', now, scope: UNRESTRICTED });

    expect(rows.find((r) => r.client === 'NoBudgetCo')!).toMatchObject({
      status: 'no-budget',
      monthlyAmount: null,
      currency: null,
      pctOfBudget: null,
      forecastPct: null,
    });
  });

  it('for a fully past month, both forecasts equal the actual', async () => {
    const now = new Date('2026-06-15T08:00:00Z');
    const daily = [{ day: '2026-03-10', client: 'Acme', cost_cents: 400000n, hours: '25' }];
    const budgets = [{ id: '1', client: 'Acme', monthlyAmountCents: 1000000, currency: 'USD', validFrom: new Date('2026-01-01'), validTo: null, notes: null }];
    const { service } = makeDeps(daily, budgets);

    const rows = await service.clientBudgetStatus({ month: '2026-03', now, scope: UNRESTRICTED });
    const acme = rows.find((r) => r.client === 'Acme')!;

    expect(acme.forecastRunRate).toBe(acme.mtdCost);
    expect(acme.forecastTrailing).toBe(acme.mtdCost);
  });

  it('ignores a budget row whose validTo is before the queried month', async () => {
    const now = new Date('2026-06-15T08:00:00Z');
    const daily = [{ day: '2026-06-05', client: 'Acme', cost_cents: 100000n, hours: '5' }];
    const budgets = [
      { id: '1', client: 'Acme', monthlyAmountCents: 500000, currency: 'USD', validFrom: new Date('2026-01-01'), validTo: new Date('2026-05-31'), notes: null },
    ];
    const { service } = makeDeps(daily, budgets);

    const rows = await service.clientBudgetStatus({ month: '2026-06', now, scope: UNRESTRICTED });
    const acme = rows.find((r) => r.client === 'Acme')!;

    expect(acme.monthlyAmount).toBeNull();
    expect(acme.status).toBe('no-budget');
  });

  describe('access scope', () => {
    const now = new Date('2026-06-15T08:00:00Z');

    it('403s a scoped plain member, no query issued', async () => {
      const { service, prisma, repo } = makeDeps([], []);
      await expect(service.clientBudgetStatus({ month: '2026-06', now, scope: NONE })).rejects.toThrow(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(repo.findAllRows).not.toHaveBeenCalled();
    });

    it('flag-off MEMBER (unrestricted, canEdit: false) reads budget status exactly as today', async () => {
      const daily = [{ day: '2026-06-05', client: 'Acme', cost_cents: 100000n, hours: '5' }];
      const budgets = [{ id: '1', client: 'Acme', monthlyAmountCents: 500000, currency: 'USD', validFrom: new Date('2026-01-01'), validTo: null, notes: null }];
      const { service } = makeDeps(daily, budgets);
      const rows = await service.clientBudgetStatus({ month: '2026-06', now, scope: FLAG_OFF_MEMBER });
      expect(rows.find((r) => r.client === 'Acme')).toBeDefined();
    });

    it('a LEAD scope scopes the spend query to LEAD clients via leadScopeSql, and never loads client options when unrestricted', async () => {
      const { service, clientOptions } = makeDeps([], []);
      await service.clientBudgetStatus({ month: '2026-06', now, scope: UNRESTRICTED });
      expect(clientOptions.list).not.toHaveBeenCalled();

      const { service: leadService, prisma: leadPrisma, clientOptions: leadClientOptions } = makeDeps([], []);
      await leadService.clientBudgetStatus({ month: '2026-06', now, scope: LEAD_A });
      const sql = sqlOf(leadPrisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/scope_client_option_id = ANY\(/);
      expect(leadClientOptions.list).toHaveBeenCalled();
    });

    it("filters budget and result rows to the lead's option-derived client names, excluding a name ambiguous with a foreign team", async () => {
      // LEAD_A leads clients o1 (Acme) and o2 (Shared). o3 (Shared, team B) makes
      // "Shared" ambiguous, so it must be excluded even though o2 is LEAD_A's own.
      const options = [
        { optionId: 'o1', name: 'Acme', teamId: 'A' },
        { optionId: 'o2', name: 'Shared', teamId: 'A' },
        { optionId: 'o3', name: 'Shared', teamId: 'B' },
      ];
      const daily = [
        { day: '2026-06-05', client: 'Acme', cost_cents: 100000n, hours: '5' },
        { day: '2026-06-05', client: 'Shared', cost_cents: 200000n, hours: '10' },
      ];
      const budgets = [
        { id: '1', client: 'Acme', monthlyAmountCents: 500000, currency: 'USD', validFrom: new Date('2026-01-01'), validTo: null, notes: null },
        { id: '2', client: 'Shared', monthlyAmountCents: 900000, currency: 'USD', validFrom: new Date('2026-01-01'), validTo: null, notes: null },
      ];
      const { service } = makeDeps(daily, budgets, options);

      const rows = await service.clientBudgetStatus({ month: '2026-06', now, scope: LEAD_A });

      expect(rows.find((r) => r.client === 'Acme')).toBeDefined();
      expect(rows.find((r) => r.client === 'Shared')).toBeUndefined();
    });
  });
});
