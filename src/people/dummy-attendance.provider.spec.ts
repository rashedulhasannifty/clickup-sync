import { DummyAttendanceProvider } from './dummy-attendance.provider';
import {
  dhakaDateOf,
  dhakaInstant,
  dhakaMinutesOfDay,
  isBusinessDay,
} from './people-dates';

const people = [
  { email: 'a@x.test', joinDate: '2026-01-01', exitDate: null },
  { email: 'b@x.test', joinDate: '2026-08-10', exitDate: null },
  { email: 'c@x.test', joinDate: '2025-01-01', exitDate: '2026-09-15' },
  { email: 'd@x.test', joinDate: '2025-01-01', exitDate: null },
  { email: 'e@x.test', joinDate: '2025-01-01', exitDate: null },
];
// Wed 2026-10-07 18:00 Dhaka: after the earliest last-out (17:30), before the latest (19:30).
const NOW = dhakaInstant('2026-10-07', 18 * 60);

describe('DummyAttendanceProvider', () => {
  const make = (now = NOW) => new DummyAttendanceProvider(() => now);

  it('is deterministic: the same inputs give identical output', async () => {
    const a = await make().fetch(people, '2026-07-01', '2026-10-07');
    const b = await make().fetch(people, '2026-07-01', '2026-10-07');
    expect(a).toEqual(b);
    expect(a.attendance.length).toBeGreaterThan(100);
  });

  it('a narrower window returns the same rows for the days it covers', async () => {
    const wide = await make().fetch(people, '2026-07-01', '2026-10-07');
    const narrow = await make().fetch(people, '2026-09-01', '2026-10-07');
    const wideInRange = wide.attendance.filter((r) => r.date >= '2026-09-01');
    expect(narrow.attendance).toEqual(wideInRange);
  });

  it('stays within each employment window and on business days', async () => {
    const r = await make().fetch(people, '2026-01-01', '2026-10-07');
    for (const row of r.attendance) {
      const p = people.find((x) => x.email === row.email)!;
      expect(row.date >= p.joinDate).toBe(true);
      if (p.exitDate) expect(row.date <= p.exitDate).toBe(true);
      expect(isBusinessDay(row.date)).toBe(true);
    }
    const approved = r.leaves.filter((l) => l.status === 'APPROVED');
    for (const l of approved) {
      const p = people.find((x) => x.email === l.email)!;
      expect(
        l.startDate >= p.joinDate && (!p.exitDate || l.endDate <= p.exitDate),
      ).toBe(true);
    }
  });

  it('never invents the future', async () => {
    const early = dhakaInstant('2026-10-07', 9 * 60); // 09:00 Wednesday
    const r = await make(early).fetch(people, '2026-09-01', '2026-10-31');
    for (const row of r.attendance) {
      expect(row.date <= '2026-10-07').toBe(true);
      expect(row.firstIn!.getTime()).toBeLessThanOrEqual(early.getTime());
      if (row.lastOut)
        expect(row.lastOut.getTime()).toBeLessThanOrEqual(early.getTime());
    }
    expect(
      r.attendance
        .filter((x) => x.date === '2026-10-07')
        .every((x) => x.lastOut === null),
    ).toBe(true);
    // approved leave only up to today; pending only after today
    expect(
      r.leaves
        .filter((l) => l.status === 'APPROVED')
        .every((l) => l.endDate <= '2026-10-07'),
    ).toBe(true);
    expect(
      r.leaves
        .filter((l) => l.status === 'PENDING')
        .every((l) => l.startDate > '2026-10-07'),
    ).toBe(true);
  });

  it('looks like attendance: arrival and departure windows, some lates, some leave', async () => {
    const r = await make().fetch(people, '2026-01-01', '2026-10-06');
    let late = 0;
    for (const row of r.attendance) {
      const inMin = dhakaMinutesOfDay(row.firstIn!);
      expect(inMin).toBeGreaterThanOrEqual(8 * 60 + 40);
      expect(inMin).toBeLessThanOrEqual(10 * 60 + 40);
      if (inMin > 9 * 60 + 30) late++;
      const outMin = dhakaMinutesOfDay(row.lastOut!);
      expect(outMin).toBeGreaterThanOrEqual(17 * 60 + 30);
      expect(outMin).toBeLessThanOrEqual(19 * 60 + 30);
      expect(dhakaDateOf(row.firstIn!)).toBe(row.date);
    }
    expect(late).toBeGreaterThan(0);
    expect(late / r.attendance.length).toBeLessThan(0.3);
    expect(r.leaves.some((l) => l.type === 'SICK')).toBe(true);
    expect(
      r.leaves.some((l) => l.type === 'CASUAL' && l.status === 'APPROVED'),
    ).toBe(true);
  });

  it('keeps pending requests stable across days (same externalId), so re-syncs do not pile them up', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      email: `p${i}@x.test`,
      joinDate: '2025-01-01',
      exitDate: null,
    }));
    const mon = await make(dhakaInstant('2026-10-05', 12 * 60)).fetch(
      many,
      '2026-10-05',
      '2026-10-05',
    );
    const tue = await make(dhakaInstant('2026-10-06', 12 * 60)).fetch(
      many,
      '2026-10-06',
      '2026-10-06',
    );
    const pm = mon.leaves.filter(
      (l) => l.status === 'PENDING' && l.startDate > '2026-10-06',
    );
    const pt = tue.leaves.filter(
      (l) => l.status === 'PENDING' && l.startDate > '2026-10-06',
    );
    const monIds = new Set(pm.map((l) => l.externalId));
    expect(
      pt
        .filter((l) => l.startDate <= '2026-10-19')
        .every((l) => monIds.has(l.externalId)),
    ).toBe(true);
    const people30 = new Set(
      mon.leaves.filter((l) => l.status === 'PENDING').map((l) => l.email),
    );
    expect(people30.size).toBeGreaterThan(5);
    expect(people30.size).toBeLessThan(40);
    expect(new Set(mon.leaves.map((l) => l.externalId)).size).toBe(
      mon.leaves.length,
    );
  });

  it('source is dummy', () => expect(make().source).toBe('dummy'));
});
