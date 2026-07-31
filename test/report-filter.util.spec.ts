import { csvList, sprintStatusListIds } from '../src/reports/report-filter.util';

describe('csvList', () => {
  it('returns undefined for undefined', () => {
    expect(csvList(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(csvList('')).toBeUndefined();
  });

  it('returns undefined for a comma-only string', () => {
    expect(csvList(' , , ')).toBeUndefined();
  });

  it('wraps a single value in a one-element list (the deep-link path)', () => {
    expect(csvList('Acme Corp')).toEqual(['Acme Corp']);
  });

  it('splits multiple values', () => {
    expect(csvList('Acme,Beta,Contoso')).toEqual(['Acme', 'Beta', 'Contoso']);
  });

  it('trims surrounding whitespace on each value', () => {
    expect(csvList(' Acme , Beta ')).toEqual(['Acme', 'Beta']);
  });

  it('drops empty parts between commas', () => {
    expect(csvList('Acme,,Beta, ,Contoso')).toEqual(['Acme', 'Beta', 'Contoso']);
  });

  it('de-duplicates while preserving first-seen order', () => {
    expect(csvList('Beta,Acme,Beta')).toEqual(['Beta', 'Acme']);
  });
});

describe('sprintStatusListIds', () => {
  function makePrisma() {
    return { $queryRaw: jest.fn().mockResolvedValue([{ list_id: 'L1' }, { list_id: 'L2' }]) };
  }

  it('returns undefined (no filter) for "all"', async () => {
    const prisma = makePrisma();
    const result = await sprintStatusListIds(prisma, 'all');
    expect(result).toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns undefined (no filter) when absent', async () => {
    const prisma = makePrisma();
    const result = await sprintStatusListIds(prisma, undefined);
    expect(result).toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns undefined (no filter) for an unrecognized value — ignored, not rejected', async () => {
    const prisma = makePrisma();
    const result = await sprintStatusListIds(prisma, 'bogus');
    expect(result).toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('queries archived=true for "completed" (bound value, not string-concatenated)', async () => {
    const prisma = makePrisma();
    await sprintStatusListIds(prisma, 'completed');
    const call = prisma.$queryRaw.mock.calls[0][0];
    const sqlText: string = call.sql ?? call.text ?? String(call);
    expect(sqlText).toMatch(/archived\s*=/);
    expect(call.values).toEqual([true]);
  });

  it('queries archived=false for "active" (bound value)', async () => {
    const prisma = makePrisma();
    await sprintStatusListIds(prisma, 'active');
    const call = prisma.$queryRaw.mock.calls[0][0];
    expect(call.values).toEqual([false]);
  });

  it('maps rows to a plain list_id array', async () => {
    const prisma = makePrisma();
    const result = await sprintStatusListIds(prisma, 'completed');
    expect(result).toEqual(['L1', 'L2']);
  });

  // Regression pin: an empty result set must still be a real (empty) array,
  // never coerced back to `undefined` — "completed" with zero archived lists
  // must exclude every task, not silently fall through to "no filter".
  it('returns an empty array (not undefined) when no lists match', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const result = await sprintStatusListIds(prisma, 'completed');
    expect(result).toEqual([]);
    expect(result).not.toBeUndefined();
  });
});
