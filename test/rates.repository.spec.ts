import { RatesRepository } from '../src/rates/rates.repository';

function makeRepo() {
  const update = jest.fn().mockResolvedValue({
    rateId: BigInt(1), assigneeId: 'a', assigneeName: null, assigneeEmail: null,
    currency: 'AUD', hourlyRateCents: BigInt(100), validFrom: new Date(0), validTo: null, updatedAt: new Date(0),
  });
  const prisma = { assigneeRate: { update } } as any;
  return { repo: new RatesRepository(prisma), update };
}

describe('RatesRepository.update — partial-update semantics', () => {
  it('omitting validTo leaves it untouched (key absent from the update data)', async () => {
    const { repo, update } = makeRepo();
    await repo.update(BigInt(1), { hourlyRateCents: 200 });
    const data = update.mock.calls[0][0].data;
    expect('validTo' in data).toBe(false);
  });

  it('passing validTo:null explicitly CLEARS it (open-ended rate)', async () => {
    const { repo, update } = makeRepo();
    await repo.update(BigInt(1), { validTo: null });
    const data = update.mock.calls[0][0].data;
    expect('validTo' in data).toBe(true);
    expect(data.validTo).toBeNull();
  });

  it('coerces hourlyRateCents to BigInt', async () => {
    const { repo, update } = makeRepo();
    await repo.update(BigInt(1), { hourlyRateCents: 500 });
    expect(update.mock.calls[0][0].data.hourlyRateCents).toBe(BigInt(500));
  });

  it('only sets fields that were provided', async () => {
    const { repo, update } = makeRepo();
    await repo.update(BigInt(1), { currency: 'USD' });
    const data = update.mock.calls[0][0].data;
    expect(data).toEqual({ currency: 'USD' });
  });
});
