import { DeadLetterRepository } from '../src/jobs/dead-letter.repository';

describe('DeadLetterRepository.findPending', () => {
  it('queries with retriedAt and resolvedAt null filters ordered by failedAt desc', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      $transaction: jest.fn().mockImplementation((fns: any[]) => Promise.all(fns)),
      deadLetterJob: { findMany, count },
    } as any;
    const repo = new DeadLetterRepository(prisma);

    const result = await repo.findPending(50, 10);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { retriedAt: null, resolvedAt: null },
      orderBy: { failedAt: 'desc' },
      take: 50,
      skip: 10,
    }));
    expect(result).toEqual({ items: [], total: 0 });
  });
});

describe('DeadLetterRepository.findById', () => {
  it('calls findUnique with correct id', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: BigInt(1) });
    const prisma = { deadLetterJob: { findUnique } } as any;
    const repo = new DeadLetterRepository(prisma);

    await repo.findById(BigInt(1));

    expect(findUnique).toHaveBeenCalledWith({ where: { id: BigInt(1) } });
  });
});

describe('DeadLetterRepository.markRetried', () => {
  it('updates retriedAt to current time', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = { deadLetterJob: { update } } as any;
    const repo = new DeadLetterRepository(prisma);

    await repo.markRetried(BigInt(5));

    expect(update).toHaveBeenCalledWith({
      where: { id: BigInt(5) },
      data: { retriedAt: expect.any(Date) },
    });
  });
});
