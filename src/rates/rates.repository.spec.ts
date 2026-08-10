import { BadRequestException } from '@nestjs/common';
import { RatesRepository } from './rates.repository';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const row = (over: Record<string, unknown> = {}) => ({
  rateId: 9n, assigneeId: 'u1', assigneeName: null, assigneeEmail: null,
  currency: 'USD', hourlyRateCents: 100n, validFrom: d('2026-06-01'), validTo: null,
  updatedAt: d('2026-06-01'), ...over,
});

function makePrisma(existing: { rateId: bigint; validFrom: Date; validTo: Date | null }[]) {
  const tx = {
    assigneeRate: {
      findMany: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue(row()),
      create: jest.fn().mockResolvedValue(row()),
    },
  };
  const prisma = { $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
  return { prisma, tx };
}

const input = { assigneeId: 'u1', currency: 'USD', hourlyRateCents: 100, validFrom: d('2026-06-01'), validTo: null };

describe('RatesRepository.createWithSuccession', () => {
  it('caps an open-ended active rate then creates the new one', async () => {
    const { prisma, tx } = makePrisma([{ rateId: 1n, validFrom: d('2026-01-01'), validTo: null }]);
    const repo = new RatesRepository(prisma as any);
    await repo.createWithSuccession(input);
    expect(tx.assigneeRate.update).toHaveBeenCalledWith({ where: { rateId: 1n }, data: { validTo: d('2026-05-31') } });
    expect(tx.assigneeRate.create).toHaveBeenCalledTimes(1);
  });

  it('creates without capping when there is no overlap', async () => {
    const { prisma, tx } = makePrisma([{ rateId: 1n, validFrom: d('2026-01-01'), validTo: d('2026-05-31') }]);
    const repo = new RatesRepository(prisma as any);
    await repo.createWithSuccession(input);
    expect(tx.assigneeRate.update).not.toHaveBeenCalled();
    expect(tx.assigneeRate.create).toHaveBeenCalledTimes(1);
  });

  it('throws BadRequest and does not create on the block case', async () => {
    const { prisma, tx } = makePrisma([{ rateId: 1n, validFrom: d('2026-06-01'), validTo: null }]);
    const repo = new RatesRepository(prisma as any);
    await expect(repo.createWithSuccession(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.assigneeRate.create).not.toHaveBeenCalled();
  });
});
