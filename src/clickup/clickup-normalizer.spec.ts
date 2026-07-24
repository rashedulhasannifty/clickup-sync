import { ClickupNormalizer } from './clickup-normalizer';
import { CustomFieldExtractor } from './custom-field-extractor';

function makeNormalizer() {
  return new ClickupNormalizer(new CustomFieldExtractor());
}

describe('ClickupNormalizer.normalizeTask — orderIndex', () => {
  it('returns a bigint that holds values beyond 32-bit int range', () => {
    const n = makeNormalizer();
    // 10_001_784_882_224 overflows PostgreSQL INT4 (max 2_147_483_647) and was
    // the value that broke the upsert in production. It must round-trip as a
    // BigInt, not an overflowing number.
    const task = { id: 't1', name: 'T', orderindex: '10001784882224' } as never;
    const result = n.normalizeTask(task);
    expect(typeof result.orderIndex).toBe('bigint');
    expect(result.orderIndex).toBe(10001784882224n);
  });

  it('defaults orderIndex to 0n when orderindex is missing or invalid', () => {
    const n = makeNormalizer();
    expect(n.normalizeTask({ id: 't2', name: 'T' } as never).orderIndex).toBe(0n);
    expect(n.normalizeTask({ id: 't3', name: 'T', orderindex: 'not-a-number' } as never).orderIndex).toBe(0n);
  });
});
