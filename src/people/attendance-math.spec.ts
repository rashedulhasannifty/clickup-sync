import {
  buildAttendanceStrip,
  classifyDay,
  classifyToday,
  computeLeaveBalance,
  minutesBetween,
  type TypedLeave,
} from './attendance-math';
import { dhakaInstant } from './people-dates';

const row = (
  date: string,
  inMin: number | null,
  outMin: number | null = null,
) => ({
  date,
  firstIn: inMin === null ? null : dhakaInstant(date, inMin),
  lastOut: outMin === null ? null : dhakaInstant(date, outMin),
  minutesInOffice: null,
});
const leave = (
  type: TypedLeave['type'],
  d: string,
  e = d,
  days = 1,
): TypedLeave => ({ type, startDate: d, endDate: e, days });

describe('classifyDay', () => {
  const today = '2026-10-07'; // Wednesday
  it('attendance beats leave; leave beats absence; open day is not absent', () => {
    expect(
      classifyDay({
        date: '2026-10-05',
        today,
        row: row('2026-10-05', 9 * 60),
        leaves: [],
      }),
    ).toBe('on-time');
    expect(
      classifyDay({
        date: '2026-10-05',
        today,
        row: row('2026-10-05', 10 * 60),
        leaves: [leave('SICK', '2026-10-05')],
      }),
    ).toBe('late');
    expect(
      classifyDay({
        date: '2026-10-05',
        today,
        row: undefined,
        leaves: [leave('SICK', '2026-10-05')],
      }),
    ).toBe('sick');
    expect(
      classifyDay({
        date: '2026-10-05',
        today,
        row: undefined,
        leaves: [leave('CASUAL', '2026-10-05')],
      }),
    ).toBe('casual');
    expect(
      classifyDay({
        date: '2026-10-05',
        today,
        row: undefined,
        leaves: [leave('ANNUAL', '2026-10-05')],
      }),
    ).toBe('leave');
    expect(
      classifyDay({ date: '2026-10-05', today, row: undefined, leaves: [] }),
    ).toBe('absent');
    expect(
      classifyDay({ date: today, today, row: undefined, leaves: [] }),
    ).toBe('future');
    expect(
      classifyDay({ date: '2026-10-08', today, row: undefined, leaves: [] }),
    ).toBe('future');
  });
});

describe('buildAttendanceStrip', () => {
  it('returns the last 30 business days, oldest first, none on weekends', () => {
    const strip = buildAttendanceStrip({
      today: '2026-10-07',
      employment: { joinDate: '2020-01-01', exitDate: null },
      rows: [row('2026-10-06', 9 * 60, 18 * 60)],
      leaves: [],
    });
    expect(strip).toHaveLength(30);
    expect(strip[29].date).toBe('2026-10-07');
    expect(strip.every((d, i) => i === 0 || d.date > strip[i - 1].date)).toBe(
      true,
    );
    expect(
      strip.some((d) =>
        ['Sat', 'Sun'].includes(
          new Date(`${d.date}T00:00:00Z`).toUTCString().slice(0, 3),
        ),
      ),
    ).toBe(false);
    expect(strip.find((d) => d.date === '2026-10-06')).toMatchObject({
      state: 'on-time',
      lastOut: expect.any(String),
    });
  });

  it('clips to employment (new joiner, leaver)', () => {
    const joiner = buildAttendanceStrip({
      today: '2026-10-07',
      employment: { joinDate: '2026-10-05', exitDate: null },
      rows: [],
      leaves: [],
    });
    expect(joiner.map((d) => d.date)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ]);
    const leaver = buildAttendanceStrip({
      today: '2026-10-07',
      employment: { joinDate: '2026-10-01', exitDate: '2026-10-02' },
      rows: [],
      leaves: [],
    });
    expect(leaver.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02']);
  });
});

describe('classifyToday', () => {
  const employment = { joinDate: '2020-01-01', exitDate: null };
  it('covers weekend, leave, late, not-in', () => {
    expect(
      classifyToday({
        today: '2026-10-10',
        employment,
        row: undefined,
        leaves: [],
      }),
    ).toBe('non-working');
    expect(
      classifyToday({
        today: '2026-10-07',
        employment: { joinDate: '2026-10-08', exitDate: null },
        row: undefined,
        leaves: [],
      }),
    ).toBe('non-working');
    expect(
      classifyToday({
        today: '2026-10-07',
        employment,
        row: undefined,
        leaves: [leave('SICK', '2026-10-07')],
      }),
    ).toBe('leave');
    expect(
      classifyToday({
        today: '2026-10-07',
        employment,
        row: row('2026-10-07', 600),
        leaves: [],
      }),
    ).toBe('late');
    expect(
      classifyToday({
        today: '2026-10-07',
        employment,
        row: undefined,
        leaves: [],
      }),
    ).toBe('not-in');
  });
});

describe('computeLeaveBalance', () => {
  it('buckets approved days by type for the year, splitting a year-straddling leave', () => {
    const b = computeLeaveBalance(2026, [
      leave('CASUAL', '2026-03-02', '2026-03-03', 2),
      leave('SICK', '2026-04-06'),
      leave('ANNUAL', '2026-05-04', '2026-05-05', 2),
      leave('UNPAID', '2026-06-01'),
      // Thu 31 Dec 2026 .. Mon 4 Jan 2027: 3 business days (Dec 31, Jan 1, Jan 4); only Dec 31 is in 2026.
      leave('CASUAL', '2026-12-31', '2027-01-04', 3),
      leave('CASUAL', '2025-01-06'),
    ]);
    expect(b).toEqual({
      year: 2026,
      casual: { used: 3, entitlement: 10 },
      sick: { used: 1, entitlement: 14 },
      other: { used: 3 },
    });
  });
});

describe('minutesBetween', () => {
  it('is null unless both ends exist', () => {
    expect(minutesBetween(null, new Date())).toBeNull();
    expect(
      minutesBetween(
        dhakaInstant('2026-10-07', 540),
        dhakaInstant('2026-10-07', 1080),
      ),
    ).toBe(540);
  });
});

describe('an exit punch with no entry (the entry was missed)', () => {
  const employment = { joinDate: '2020-01-01', exitDate: null };
  it('is present, not absent, and weekend work on a weekend', () => {
    const outOnly = (d: string) => row(d, null, 18 * 60);
    expect(classifyDay({ date: '2026-10-05', today: '2026-10-07', row: outOnly('2026-10-05'), leaves: [] })).toBe('present');
    expect(classifyDay({ date: '2026-10-03', today: '2026-10-07', row: outOnly('2026-10-03'), leaves: [] })).toBe('weekend');
    expect(classifyToday({ today: '2026-10-07', employment, row: outOnly('2026-10-07'), leaves: [] })).toBe('present');
  });
});
