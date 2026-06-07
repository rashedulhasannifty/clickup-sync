import { ClickupNormalizer } from '../src/clickup/clickup-normalizer';
import { CustomFieldExtractor } from '../src/clickup/custom-field-extractor';

function makeNormalizer() {
  return new ClickupNormalizer(new CustomFieldExtractor());
}

describe('ClickupNormalizer.normalizeTimeEntry', () => {
  it('converts millisecond duration to decimal hours', () => {
    const n = makeNormalizer();
    const entry = n.normalizeTimeEntry({ id: 'te-1', duration: 3_600_000 } as any);
    expect(entry.durationHours).toBe(1);
  });

  it('clamps negative durations (running timers) to 0 so cost cannot go negative', () => {
    const n = makeNormalizer();
    const entry = n.normalizeTimeEntry({ id: 'te-2', duration: -3_600_000 } as any);
    expect(entry.durationHours).toBe(0);
  });

  it('throws when the time entry has no id', () => {
    const n = makeNormalizer();
    expect(() => n.normalizeTimeEntry({} as any)).toThrow(/missing id/);
  });
});
