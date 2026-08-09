import { planRateSuccession, dayBefore, RateInterval } from './rate-succession';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('dayBefore', () => {
  it('returns the previous UTC day', () => {
    expect(dayBefore(d('2026-06-01')).toISOString()).toBe('2026-05-31T00:00:00.000Z');
  });
});

describe('planRateSuccession', () => {
  it('caps an open-ended active rate to newStart-1', () => {
    const existing: RateInterval[] = [{ rateId: 1n, validFrom: d('2026-01-01'), validTo: null }];
    const plan = planRateSuccession({ existing, newValidFrom: d('2026-06-01'), newValidTo: null });
    expect(plan).toEqual({ ok: true, caps: [{ rateId: 1n, validTo: d('2026-05-31') }] });
  });

  it('caps a closed rate whose range covers the new start', () => {
    const existing: RateInterval[] = [{ rateId: 2n, validFrom: d('2026-01-01'), validTo: d('2026-12-31') }];
    const plan = planRateSuccession({ existing, newValidFrom: d('2026-06-01'), newValidTo: null });
    expect(plan).toEqual({ ok: true, caps: [{ rateId: 2n, validTo: d('2026-05-31') }] });
  });

  it('leaves an adjacent non-overlapping rate untouched', () => {
    const existing: RateInterval[] = [{ rateId: 3n, validFrom: d('2026-01-01'), validTo: d('2026-05-31') }];
    const plan = planRateSuccession({ existing, newValidFrom: d('2026-06-01'), newValidTo: null });
    expect(plan).toEqual({ ok: true, caps: [] });
  });

  it('blocks when an overlapping rate starts on/after the new start', () => {
    const existing: RateInterval[] = [{ rateId: 4n, validFrom: d('2026-06-01'), validTo: null }];
    const plan = planRateSuccession({ existing, newValidFrom: d('2026-06-01'), newValidTo: null });
    expect(plan.ok).toBe(false);
  });

  it('blocks a new open-ended rate that would swallow a later rate', () => {
    const existing: RateInterval[] = [{ rateId: 5n, validFrom: d('2026-07-01'), validTo: null }];
    const plan = planRateSuccession({ existing, newValidFrom: d('2026-06-01'), newValidTo: null });
    expect(plan.ok).toBe(false);
  });

  it('leaves an existing rate untouched when new bounded rate ends before it starts', () => {
    const existing: RateInterval[] = [{ rateId: 6n, validFrom: d('2027-01-01'), validTo: null }];
    const plan = planRateSuccession({
      existing,
      newValidFrom: d('2026-06-01'),
      newValidTo: d('2026-12-31'),
    });
    expect(plan).toEqual({ ok: true, caps: [] });
  });

  it('blocks a new bounded rate overlapping an existing rate that starts after the new range', () => {
    const existing: RateInterval[] = [{ rateId: 7n, validFrom: d('2026-12-01'), validTo: null }];
    const plan = planRateSuccession({
      existing,
      newValidFrom: d('2026-06-01'),
      newValidTo: d('2026-12-31'),
    });
    expect(plan.ok).toBe(false);
  });
});
