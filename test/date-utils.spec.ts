import { fromClickupMillis, subtractDays, subtractHours } from '../src/common/utils/date-utils';

describe('fromClickupMillis', () => {
  it('parses a positive millis number', () => {
    expect(fromClickupMillis(1716470400000)?.getTime()).toBe(1716470400000);
  });
  it('parses a numeric string', () => {
    expect(fromClickupMillis('1716470400000')?.getTime()).toBe(1716470400000);
  });
  it.each([null, undefined, '', 0, -5, 'abc', NaN, Infinity])('returns null for %p', (v) => {
    expect(fromClickupMillis(v as any)).toBeNull();
  });
});

describe('subtractDays / subtractHours', () => {
  it('subtractDays returns an instant ~N days earlier (DST-tolerant)', () => {
    const now = Date.now();
    const d = subtractDays(7).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(d).toBeLessThanOrEqual(now - sevenDays + 1000);
    expect(d).toBeGreaterThanOrEqual(now - sevenDays - 60 * 60 * 1000); // allow a DST hour
  });
  it('subtractHours returns an instant ~N hours earlier', () => {
    const now = Date.now();
    const d = subtractHours(2).getTime();
    const twoH = 2 * 60 * 60 * 1000;
    expect(d).toBeLessThanOrEqual(now - twoH + 1000);
    expect(d).toBeGreaterThanOrEqual(now - twoH - 60 * 60 * 1000);
  });
});
