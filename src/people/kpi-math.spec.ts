import {
  availableBusinessDays,
  bandOf,
  computeKpis,
  isOnTimeArrival,
  leaveBusinessDays,
  overallOf,
  type KpiInput,
} from './kpi-math';
import { dhakaInstant, NO_HOLIDAYS } from './people-dates';

// 2026-10-05 is a Monday; 2026-10-05..2026-10-16 = 10 business days.
const period = { from: '2026-10-05', to: '2026-10-16' };
const base: KpiInput = {
  period,
  employment: { joinDate: '2020-01-01', exitDate: null },
  clickupLinked: true,
  hours: [],
  deliveries: [],
  attendance: [],
  approvedLeave: [],
  holidays: NO_HOLIDAYS,
};

describe('bandOf', () => {
  it.each([
    [100, 'on-track'],
    [80, 'on-track'],
    [79, 'watch'],
    [60, 'watch'],
    [59, 'at-risk'],
    [0, 'at-risk'],
    [null, 'no-data'],
  ] as const)('%s -> %s', (score, band) => expect(bandOf(score)).toBe(band));
});

describe('isOnTimeArrival', () => {
  it('09:30 Dhaka is on time, 09:31 is late', () => {
    expect(isOnTimeArrival(dhakaInstant('2026-10-05', 9 * 60 + 30))).toBe(true);
    expect(isOnTimeArrival(dhakaInstant('2026-10-05', 9 * 60 + 31))).toBe(
      false,
    );
    expect(isOnTimeArrival(dhakaInstant('2026-10-05', 8 * 60))).toBe(true);
  });
});

describe('availability', () => {
  it('counts business days in period within employment', () => {
    expect(availableBusinessDays({ ...base })).toBe(10);
    expect(
      availableBusinessDays({
        ...base,
        employment: { joinDate: '2026-10-12', exitDate: null },
      }),
    ).toBe(5);
    expect(
      availableBusinessDays({
        ...base,
        employment: { joinDate: '2020-01-01', exitDate: '2026-10-08' },
      }),
    ).toBe(4);
    expect(
      availableBusinessDays({
        ...base,
        employment: { joinDate: '2027-01-01', exitDate: null },
      }),
    ).toBe(0);
  });

  it('subtracts approved leave business days, ignoring weekends and out-of-period days', () => {
    const leave = [{ startDate: '2026-10-08', endDate: '2026-10-12', days: 3 }]; // Thu, Fri, (weekend), Mon
    expect(availableBusinessDays({ ...base, approvedLeave: leave })).toBe(7);
    const before = [
      { startDate: '2026-09-28', endDate: '2026-10-06', days: 7 },
    ];
    expect(leaveBusinessDays(period, before, NO_HOLIDAYS)).toBe(2);
  });

  it('does not subtract overlapping leave twice, and prorates half days', () => {
    const a = { startDate: '2026-10-06', endDate: '2026-10-07', days: 2 };
    expect(
      availableBusinessDays({ ...base, approvedLeave: [a, { ...a }] }),
    ).toBe(8);
    expect(
      availableBusinessDays({
        ...base,
        approvedLeave: [
          { startDate: '2026-10-06', endDate: '2026-10-06', days: 0.5 },
        ],
      }),
    ).toBe(9.5);
  });
});

describe('computeKpis', () => {
  it('utilisation = hours / (available days x 8), with leave removed from the denominator', () => {
    const r = computeKpis({
      ...base,
      hours: [{ date: '2026-10-06', hours: 56, chargeableHours: 28 }],
      approvedLeave: [
        { startDate: '2026-10-12', endDate: '2026-10-16', days: 5 },
      ],
    });
    expect(r.hours.available).toBe(40);
    expect(r.kpis.utilisation).toMatchObject({
      value: 140,
      numerator: 56,
      denominator: 40,
      score: 100,
      status: 'on-track',
    });
    expect(r.kpis.chargeable).toMatchObject({
      value: 50,
      numerator: 28,
      denominator: 56,
      target: 70,
    });
    expect(r.kpis.chargeable.score).toBe(71);
    expect(r.kpis.chargeable.status).toBe('watch');
  });

  it('ignores hours outside the period', () => {
    const r = computeKpis({
      ...base,
      hours: [{ date: '2026-09-01', hours: 99, chargeableHours: 99 }],
    });
    expect(r.hours.clickup).toBe(0);
    expect(r.kpis.utilisation.value).toBe(0);
    expect(r.kpis.chargeable.reason).toBe('no-data');
  });

  it('on-time delivery counts tasks closed on or before the due day', () => {
    const r = computeKpis({
      ...base,
      deliveries: [
        { closedOn: '2026-10-06', dueOn: '2026-10-06' },
        { closedOn: '2026-10-07', dueOn: '2026-10-09' },
        { closedOn: '2026-10-08', dueOn: '2026-10-07' },
        { closedOn: '2026-09-01', dueOn: '2026-08-01' }, // closed outside period
      ],
    });
    expect(r.kpis.onTimeDelivery).toMatchObject({
      numerator: 2,
      denominator: 3,
      value: 66.7,
      score: 78,
      status: 'watch',
    });
  });

  it('punctuality counts only days with a first-in', () => {
    const r = computeKpis({
      ...base,
      attendance: [
        { date: '2026-10-05', firstIn: dhakaInstant('2026-10-05', 9 * 60) },
        { date: '2026-10-06', firstIn: dhakaInstant('2026-10-06', 10 * 60) },
        { date: '2026-10-07', firstIn: null },
      ],
    });
    expect(r.kpis.punctuality).toMatchObject({
      numerator: 1,
      denominator: 2,
      value: 50,
      target: 90,
    });
  });

  it('never reports 0% for an employee with no ClickUp link', () => {
    const r = computeKpis({
      ...base,
      clickupLinked: false,
      hours: [{ date: '2026-10-06', hours: 10, chargeableHours: 5 }],
      attendance: [
        { date: '2026-10-05', firstIn: dhakaInstant('2026-10-05', 9 * 60) },
      ],
    });
    for (const k of [
      r.kpis.utilisation,
      r.kpis.chargeable,
      r.kpis.onTimeDelivery,
    ]) {
      expect(k).toMatchObject({
        value: null,
        score: null,
        status: 'no-data',
        reason: 'not-linked',
        numerator: 0,
        denominator: 0,
      });
    }
    expect(r.kpis.punctuality.value).toBe(100);
    // Punctuality alone gives 100, but it must be flagged partial so it is
    // never shown as a full score.
    expect(r.overall).toEqual({ score: 100, band: 'on-track', partial: true, basedOn: ['punctuality'] });
  });

  it('no-data when nothing was recorded, and utilisation is no-data when never employed in the period', () => {
    const r = computeKpis({ ...base, clickupLinked: false });
    expect(r.kpis.punctuality).toMatchObject({
      value: null,
      reason: 'no-data',
    });
    expect(r.overall).toEqual({ score: null, band: 'no-data', partial: true, basedOn: [] });
    const future = computeKpis({
      ...base,
      employment: { joinDate: '2027-01-01', exitDate: null },
    });
    expect(future.kpis.utilisation.reason).toBe('no-data');
  });
});

describe('overallOf', () => {
  const k = (value: number | null, target: number) => ({
    value,
    target,
    numerator: 0,
    denominator: 0,
    score: null,
    status: 'no-data' as const,
  });

  it('is the rounded equal-weighted mean of the non-null scores', () => {
    // scores: 100 (capped), 50, 100 -> mean 83.33 -> 83
    const o = overallOf({
      utilisation: k(120, 85),
      chargeable: k(35, 70),
      onTimeDelivery: k(null, 85),
      punctuality: k(95, 90),
    });
    expect(o).toEqual({
      score: 83,
      band: 'on-track',
      partial: false,
      basedOn: ['utilisation', 'chargeable', 'punctuality'],
    });
  });

  it('is partial when the employee is not linked to ClickUp', () => {
    const notLinked = { ...k(null, 85), reason: 'not-linked' as const };
    const o = overallOf({
      utilisation: notLinked,
      chargeable: { ...notLinked, target: 70 },
      onTimeDelivery: notLinked,
      punctuality: k(95, 90),
    });
    // The score still reflects the one KPI that has data, but it is flagged
    // so the UI never presents it as a full 100.
    expect(o).toEqual({ score: 100, band: 'on-track', partial: true, basedOn: ['punctuality'] });
  });

  it('is not partial when a KPI is null only for lack of data', () => {
    const o = overallOf({
      utilisation: k(90, 85),
      chargeable: k(80, 70),
      onTimeDelivery: { ...k(null, 85), reason: 'no-data' as const },
      punctuality: k(95, 90),
    });
    expect(o.partial).toBe(false);
  });

  it('bands: 79 watch, 59 at-risk', () => {
    expect(
      overallOf({
        utilisation: k(79, 100),
        chargeable: k(null, 70),
        onTimeDelivery: k(null, 85),
        punctuality: k(null, 90),
      }).band,
    ).toBe('watch');
    expect(
      overallOf({
        utilisation: k(59, 100),
        chargeable: k(null, 70),
        onTimeDelivery: k(null, 85),
        punctuality: k(null, 90),
      }).band,
    ).toBe('at-risk');
  });
});

describe('office holidays', () => {
  const holidays = new Map([['2026-10-06', 'Test Day']]); // a Tuesday in the period

  it('are not available days, and leave over one only takes the working days', () => {
    expect(availableBusinessDays({ ...base, holidays })).toBe(9);
    // Mon-Wed leave stored as 3 days: only Mon and Wed are leave.
    const leave = [{ startDate: '2026-10-05', endDate: '2026-10-07', days: 3 }];
    expect(availableBusinessDays({ ...base, holidays, approvedLeave: leave })).toBe(7);
    // A Saturday holiday changes nothing.
    expect(
      availableBusinessDays({ ...base, holidays: new Map([['2026-10-10', 'Sat']]) }),
    ).toBe(10);
  });

  it('a holiday arrival never counts toward punctuality', () => {
    const r = computeKpis({
      ...base,
      holidays,
      attendance: [
        { date: '2026-10-05', firstIn: dhakaInstant('2026-10-05', 9 * 60) },
        { date: '2026-10-06', firstIn: dhakaInstant('2026-10-06', 13 * 60) },
      ],
    });
    expect(r.kpis.punctuality).toMatchObject({ numerator: 1, denominator: 1 });
  });
});
