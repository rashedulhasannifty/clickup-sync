import { BudgetsRepository } from '../src/budgets/budgets.repository';

function makePrismaMock() {
  return {
    clientBudget: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

const row = {
  budgetId: 1n,
  client: 'Acme',
  monthlyAmountCents: 2000000n,
  currency: 'USD',
  validFrom: new Date('2026-01-01'),
  validTo: null,
  notes: null,
  updatedAt: new Date('2026-06-01'),
};

describe('BudgetsRepository', () => {
  it('findAll maps BigInt to Number and returns pagination envelope', async () => {
    const prisma = makePrismaMock();
    prisma.clientBudget.findMany.mockResolvedValue([row]);
    prisma.clientBudget.count.mockResolvedValue(1);
    const repo = new BudgetsRepository(prisma as never);

    const res = await repo.findAll(1, 50);

    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ id: '1', client: 'Acme', monthlyAmountCents: 2000000, currency: 'USD' });
  });

  it('create converts amount to BigInt and null-defaults validTo', async () => {
    const prisma = makePrismaMock();
    prisma.clientBudget.create.mockResolvedValue(row);
    const repo = new BudgetsRepository(prisma as never);

    await repo.create({ client: 'Acme', monthlyAmountCents: 2000000, currency: 'USD', validFrom: new Date('2026-01-01') });

    expect(prisma.clientBudget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ client: 'Acme', monthlyAmountCents: 2000000n, validTo: null }),
    });
  });

  it('update only sets provided fields', async () => {
    const prisma = makePrismaMock();
    prisma.clientBudget.update.mockResolvedValue(row);
    const repo = new BudgetsRepository(prisma as never);

    await repo.update(1n, { monthlyAmountCents: 500000 });

    expect(prisma.clientBudget.update).toHaveBeenCalledWith({
      where: { budgetId: 1n },
      data: { monthlyAmountCents: 500000n },
    });
  });
});
