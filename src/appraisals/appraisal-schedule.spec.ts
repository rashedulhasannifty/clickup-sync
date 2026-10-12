import {
  addMonthsClamped,
  classifyDue,
  coveredMilestones,
  dueBetween,
  dueInWindow,
  dueOnOrBefore,
  inScope,
  latestMilestoneOnOrBefore,
  milestones,
  isCovered,
  lastAppraisedOn,
  lateness,
  nearestMilestone,
  nextDue,
  overdueAppraisals,
  overdueFor,
  OVERDUE_LOOKBACK_MONTHS,
  reviewPeriod,
  selectDue,
  UPCOMING_DAYS,
  anchorOf,
  dueDateTaken,
  dueOnOrBeforeFor,
  firstDueFor,
  internshipCovered,
  internshipDueDate,
  internshipReview,
  isDueCovered,
  type AppraisalOnRecord,
  type OverdueEmployee,
} from './appraisal-schedule';

describe('addMonthsClamped', () => {
  it('adds months, crossing year ends both ways', () => {
    expect(addMonthsClamped('2025-04-15', 6)).toBe('2025-10-15');
    expect(addMonthsClamped('2025-10-15', 6)).toBe('2026-04-15');
    expect(addMonthsClamped('2026-04-15', -6)).toBe('2025-10-15');
    expect(addMonthsClamped('2026-01-10', -1)).toBe('2025-12-10');
    expect(addMonthsClamped('2025-12-10', 0)).toBe('2025-12-10');
  });

  it('clamps the day to the target month', () => {
    expect(addMonthsClamped('2025-08-31', 6)).toBe('2026-02-28');
    expect(addMonthsClamped('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonthsClamped('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonthsClamped('2024-02-29', 48)).toBe('2028-02-29');
  });
});

describe('milestones', () => {
  const join = '2025-04-15';

  it('confirmation is once, 6 months after joining', () => {
    expect(
      milestones(join, 'CONFIRMATION', '2025-01-01', '2030-12-31'),
    ).toEqual(['2025-10-15']);
    expect(
      milestones(join, 'CONFIRMATION', '2025-10-16', '2030-12-31'),
    ).toEqual([]);
  });

  it('half-yearly starts at 12 months (k >= 2), never at the 6-month confirmation', () => {
    expect(milestones(join, 'HALF_YEARLY', '2025-01-01', '2027-04-15')).toEqual(
      ['2026-04-15', '2026-10-15', '2027-04-15'],
    );
    expect(milestones(join, 'HALF_YEARLY', '2025-10-01', '2025-10-31')).toEqual(
      [],
    );
  });

  it('yearly is every join anniversary', () => {
    expect(milestones(join, 'YEARLY', '2025-01-01', '2028-04-14')).toEqual([
      '2026-04-15',
      '2027-04-15',
    ]);
  });

  it('is inclusive at both ends of the window', () => {
    expect(milestones(join, 'HALF_YEARLY', '2026-10-15', '2026-10-15')).toEqual(
      ['2026-10-15'],
    );
    expect(milestones(join, 'HALF_YEARLY', '2026-10-16', '2027-04-14')).toEqual(
      [],
    );
  });

  it('handles windows that span a year end', () => {
    expect(
      milestones('2024-12-20', 'HALF_YEARLY', '2025-11-15', '2026-01-15'),
    ).toEqual(['2025-12-20']);
    expect(
      milestones('2025-07-05', 'CONFIRMATION', '2025-12-15', '2026-01-31'),
    ).toEqual(['2026-01-05']);
  });

  it('computes each milestone from the join date, never chaining clamped dates', () => {
    // 29 Feb: 28 Feb in non-leap years, back to 29 Feb in 2028.
    expect(
      milestones('2024-02-29', 'YEARLY', '2024-01-01', '2028-12-31'),
    ).toEqual(['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    // 31 Aug: Feb clamps, August goes back to the 31st.
    expect(
      milestones('2025-08-31', 'HALF_YEARLY', '2026-01-01', '2027-12-31'),
    ).toEqual(['2026-08-31', '2027-02-28', '2027-08-31']);
  });

  it('finds a clamped milestone at the very start of a late window', () => {
    expect(
      milestones('2025-08-31', 'HALF_YEARLY', '2027-02-28', '2027-02-28'),
    ).toEqual(['2027-02-28']);
    expect(
      milestones('2010-01-31', 'HALF_YEARLY', '2030-07-31', '2030-07-31'),
    ).toEqual(['2030-07-31']);
  });

  it('is empty when the join date is after the window, or the window is inverted', () => {
    expect(
      milestones('2027-01-01', 'YEARLY', '2026-01-01', '2026-12-31'),
    ).toEqual([]);
    expect(milestones(join, 'YEARLY', '2027-01-01', '2026-01-01')).toEqual([]);
  });
});

describe('reviewPeriod', () => {
  const join = '2025-04-15';

  it('confirmation: join date to the day before the due date', () => {
    expect(reviewPeriod(join, 'CONFIRMATION', '2025-10-15')).toEqual({
      periodStart: '2025-04-15',
      periodEnd: '2025-10-14',
    });
  });

  it('half-yearly: the 6 months before the due date', () => {
    expect(reviewPeriod(join, 'HALF_YEARLY', '2026-04-15')).toEqual({
      periodStart: '2025-10-15',
      periodEnd: '2026-04-14',
    });
    expect(reviewPeriod(join, 'HALF_YEARLY', '2026-10-15')).toEqual({
      periodStart: '2026-04-15',
      periodEnd: '2026-10-14',
    });
  });

  it('yearly: the 12 months before the due date (the first one from the join date)', () => {
    expect(reviewPeriod(join, 'YEARLY', '2026-04-15')).toEqual({
      periodStart: '2025-04-15',
      periodEnd: '2026-04-14',
    });
    expect(reviewPeriod(join, 'YEARLY', '2027-04-15')).toEqual({
      periodStart: '2026-04-15',
      periodEnd: '2027-04-14',
    });
  });

  it('starts at the previous milestone, so clamped periods stay contiguous', () => {
    // Joined 31 Aug: due 31 Aug 2026 (28 Feb - 30 Aug), then 28 Feb 2027 (31 Aug - 27 Feb),
    // not "28 Feb 2027 - 6 months" = 28 Aug 2026, which would overlap by three days.
    expect(reviewPeriod('2025-08-31', 'HALF_YEARLY', '2026-08-31')).toEqual({
      periodStart: '2026-02-28',
      periodEnd: '2026-08-30',
    });
    expect(reviewPeriod('2025-08-31', 'HALF_YEARLY', '2027-02-28')).toEqual({
      periodStart: '2026-08-31',
      periodEnd: '2027-02-27',
    });
    expect(reviewPeriod('2024-02-29', 'YEARLY', '2028-02-29')).toEqual({
      periodStart: '2027-02-28',
      periodEnd: '2028-02-28',
    });
  });

  it('a date that is not a milestone reviews the step before it, never before joining', () => {
    expect(reviewPeriod(join, 'HALF_YEARLY', '2026-06-01')).toEqual({
      periodStart: '2025-12-01',
      periodEnd: '2026-05-31',
    });
    expect(reviewPeriod(join, 'YEARLY', '2025-09-01')).toEqual({
      periodStart: '2025-04-15',
      periodEnd: '2025-08-31',
    });
  });
});

describe('latestMilestoneOnOrBefore / dueOnOrBefore / dueInWindow', () => {
  const join = '2025-04-15';

  it('takes the latest milestone on or before the date', () => {
    expect(latestMilestoneOnOrBefore(join, 'HALF_YEARLY', '2027-01-01')).toBe(
      '2026-10-15',
    );
    expect(latestMilestoneOnOrBefore(join, 'HALF_YEARLY', '2026-10-15')).toBe(
      '2026-10-15',
    );
    expect(latestMilestoneOnOrBefore(join, 'YEARLY', '2026-04-14')).toBeNull();
    expect(latestMilestoneOnOrBefore(join, 'CONFIRMATION', '2030-01-01')).toBe(
      '2025-10-15',
    );
  });

  it('dueOnOrBefore carries the review period', () => {
    expect(dueOnOrBefore(join, 'HALF_YEARLY', '2026-12-31')).toEqual({
      type: 'HALF_YEARLY',
      dueDate: '2026-10-15',
      periodStart: '2026-04-15',
      periodEnd: '2026-10-14',
    });
    expect(dueOnOrBefore('2026-09-01', 'HALF_YEARLY', '2026-12-31')).toBeNull();
  });

  it('dueInWindow takes the latest milestone when several fall in the window', () => {
    expect(
      dueInWindow(join, 'HALF_YEARLY', '2026-01-01', '2026-12-31'),
    ).toEqual({
      type: 'HALF_YEARLY',
      dueDate: '2026-10-15',
      periodStart: '2026-04-15',
      periodEnd: '2026-10-14',
    });
    expect(
      dueInWindow(join, 'HALF_YEARLY', '2026-11-01', '2026-11-30'),
    ).toBeNull();
  });
});

describe('dueBetween', () => {
  const people = [
    { id: 'a', joinDate: '2025-04-15', status: 'ACTIVE' as const },
    { id: 'b', joinDate: '2026-04-03', status: 'PROBATION' as const },
    { id: 'c', joinDate: '2024-10-20', status: 'EXITED' as const },
    { id: 'd', joinDate: '2025-10-31', status: 'NOTICE' as const },
    { id: 'e', joinDate: '2026-04-20', status: 'ACTIVE' as const },
  ];

  it('half-yearly in October 2026: everyone not exited with a milestone in the window', () => {
    const r = dueBetween(people, 'HALF_YEARLY', '2026-10-01', '2026-10-31');
    expect(r.map((x) => [x.employee.id, x.due.dueDate])).toEqual([
      ['a', '2026-10-15'],
      ['d', '2026-10-31'],
    ]);
  });

  it('confirmation: only employees still on probation', () => {
    const r = dueBetween(people, 'CONFIRMATION', '2026-10-01', '2026-10-31');
    // 'e' (ACTIVE, confirmed early) is due 20 Oct 2026 by date but is out of scope.
    expect(
      r.map((x) => [
        x.employee.id,
        x.due.dueDate,
        x.due.periodStart,
        x.due.periodEnd,
      ]),
    ).toEqual([['b', '2026-10-03', '2026-04-03', '2026-10-02']]);
  });

  it('inScope: exited never; confirmation needs probation', () => {
    expect(inScope({ status: 'EXITED' }, 'YEARLY')).toBe(false);
    expect(inScope({ status: 'NOTICE' }, 'YEARLY')).toBe(true);
    expect(inScope({ status: 'ACTIVE' }, 'CONFIRMATION')).toBe(false);
    expect(inScope({ status: 'PROBATION' }, 'CONFIRMATION')).toBe(true);
  });
});

describe('nextDue', () => {
  it('probation: the confirmation, flagged overdue once passed', () => {
    expect(
      nextDue({ joinDate: '2026-07-01', status: 'PROBATION' }, '2026-10-12'),
    ).toEqual([
      {
        type: 'CONFIRMATION',
        dueDate: '2027-01-01',
        periodStart: '2026-07-01',
        periodEnd: '2026-12-31',
        overdue: false,
      },
    ]);
    const late = nextDue(
      { joinDate: '2026-01-10', status: 'PROBATION' },
      '2026-10-12',
    );
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({
      type: 'CONFIRMATION',
      dueDate: '2026-07-10',
      overdue: true,
    });
  });

  it('confirmed: the next half-yearly and the next yearly, earliest first', () => {
    expect(
      nextDue({ joinDate: '2025-04-15', status: 'ACTIVE' }, '2026-10-12'),
    ).toEqual([
      {
        type: 'HALF_YEARLY',
        dueDate: '2026-10-15',
        periodStart: '2026-04-15',
        periodEnd: '2026-10-14',
        overdue: false,
      },
      {
        type: 'YEARLY',
        dueDate: '2027-04-15',
        periodStart: '2026-04-15',
        periodEnd: '2027-04-14',
        overdue: false,
      },
    ]);
  });

  it('a due date of today is next; on an anniversary the yearly comes first', () => {
    const r = nextDue(
      { joinDate: '2025-10-12', status: 'ACTIVE' },
      '2026-10-12',
    );
    expect(r.map((x) => [x.type, x.dueDate])).toEqual([
      ['YEARLY', '2026-10-12'],
      ['HALF_YEARLY', '2026-10-12'],
    ]);
  });

  it('confirmed before 12 months: the first half-yearly is at 12 months', () => {
    const r = nextDue(
      { joinDate: '2026-03-01', status: 'ACTIVE' },
      '2026-10-12',
    );
    expect(r.map((x) => [x.type, x.dueDate])).toEqual([
      ['YEARLY', '2027-03-01'],
      ['HALF_YEARLY', '2027-03-01'],
    ]);
  });

  it('exited: nothing; notice: still scheduled', () => {
    expect(
      nextDue({ joinDate: '2025-04-15', status: 'EXITED' }, '2026-10-12'),
    ).toEqual([]);
    expect(
      nextDue({ joinDate: '2025-04-15', status: 'NOTICE' }, '2026-10-12'),
    ).toHaveLength(2);
  });

  it('a join date in the future still gives the first milestones', () => {
    expect(
      nextDue({ joinDate: '2026-12-01', status: 'PROBATION' }, '2026-10-12')[0]
        .dueDate,
    ).toBe('2027-06-01');
    expect(
      nextDue({ joinDate: '2026-12-01', status: 'ACTIVE' }, '2026-10-12').map(
        (x) => x.dueDate,
      ),
    ).toEqual(['2027-12-01', '2027-12-01']);
  });
});

// --- Overdue, upcoming and "already appraised" (0033) ----------------------

const emp = (over: Partial<OverdueEmployee> = {}): OverdueEmployee => ({
  joinDate: '2025-01-20', // half-yearly: 20 Jan 2026, 20 Jul 2026, 20 Jan 2027 ...
  status: 'ACTIVE',
  confirmationDate: null,
  appraisals: [],
  ...over,
});
const rec = (
  type: AppraisalOnRecord['type'],
  dueDate: string | null,
  periodEnd = dueDate ?? '2026-06-30',
): AppraisalOnRecord => ({ type, dueDate, periodEnd });

describe('constants', () => {
  it('coming up is 60 days and the overdue lookback 12 months', () => {
    expect(UPCOMING_DAYS).toBe(60);
    expect(OVERDUE_LOOKBACK_MONTHS).toBe(12);
  });
});

describe('nearestMilestone', () => {
  it('finds the milestone a moved or hand-picked due date stands for', () => {
    expect(nearestMilestone('2025-01-20', 'HALF_YEARLY', '2026-07-20')).toBe(
      '2026-07-20',
    );
    expect(nearestMilestone('2025-01-20', 'HALF_YEARLY', '2026-07-10')).toBe(
      '2026-07-20',
    );
    expect(nearestMilestone('2025-01-20', 'HALF_YEARLY', '2026-08-15')).toBe(
      '2026-07-20',
    );
    expect(nearestMilestone('2025-01-20', 'YEARLY', '2025-11-01')).toBe(
      '2026-01-20',
    );
  });
  it('is null when the type has no milestone near (confirmation long past)', () => {
    expect(nearestMilestone('2024-01-01', 'CONFIRMATION', '2026-01-01')).toBe(
      null,
    );
  });
});

describe('coveredMilestones / lastAppraisedOn', () => {
  it('an appraisal covers its own due date and the milestone nearest it', () => {
    const c = coveredMilestones('2025-01-20', [
      rec('HALF_YEARLY', '2026-07-12'),
    ]);
    expect(isCovered(c, 'HALF_YEARLY', '2026-07-20')).toBe(true);
    expect(isCovered(c, 'HALF_YEARLY', '2026-07-12')).toBe(true);
    expect(isCovered(c, 'HALF_YEARLY', '2026-01-20')).toBe(false);
  });
  it('on an anniversary a yearly covers the half-yearly and vice versa', () => {
    const y = coveredMilestones('2025-01-20', [rec('YEARLY', '2026-01-20')]);
    expect(isCovered(y, 'HALF_YEARLY', '2026-01-20')).toBe(true);
    const h = coveredMilestones('2025-01-20', [
      rec('HALF_YEARLY', '2026-01-20'),
    ]);
    expect(isCovered(h, 'YEARLY', '2026-01-20')).toBe(true);
    // A non-anniversary half-yearly does not cover any yearly.
    const h2 = coveredMilestones('2025-01-20', [
      rec('HALF_YEARLY', '2026-07-20'),
    ]);
    expect(isCovered(h2, 'YEARLY', '2026-07-20')).toBe(false);
  });
  it('a calendar-cycle appraisal covers no milestone but dates the last appraisal by its period end', () => {
    const records = [rec('HALF_YEARLY', null, '2026-06-30')];
    expect(coveredMilestones('2025-01-20', records).size).toBe(0);
    expect(lastAppraisedOn('2025-01-20', 'HALF_YEARLY', records)).toBe(
      '2026-06-30',
    );
    expect(lastAppraisedOn('2025-01-20', 'YEARLY', records)).toBe(null);
  });
  it('a due date moved earlier still dates the last appraisal at its milestone', () => {
    expect(
      lastAppraisedOn('2025-01-20', 'HALF_YEARLY', [
        rec('HALF_YEARLY', '2026-07-10'),
      ]),
    ).toBe('2026-07-20');
  });
});

describe('overdueFor', () => {
  const today = '2026-10-12';

  it('is the latest missed due date only, with its review period', () => {
    // Missed 20 Jan and 20 Jul 2026: only 20 Jul stands.
    expect(overdueFor(emp(), 'HALF_YEARLY', '2026-10-01', today)).toEqual({
      type: 'HALF_YEARLY',
      dueDate: '2026-07-20',
      periodStart: '2026-01-20',
      periodEnd: '2026-07-19',
    });
  });

  it('is nothing once the latest missed one is appraised (an older miss does not resurface)', () => {
    const e = emp({ appraisals: [rec('HALF_YEARLY', '2026-07-20')] });
    expect(overdueFor(e, 'HALF_YEARLY', '2026-10-01', today)).toBeNull();
  });

  it('only counts due dates after the last appraisal of the type', () => {
    // A calendar H1 2026 appraisal reviewed to 30 Jun; 20 Jul is after it.
    const e = emp({ appraisals: [rec('HALF_YEARLY', null, '2026-07-31')] });
    expect(overdueFor(e, 'HALF_YEARLY', '2026-10-01', today)).toBeNull();
    const e2 = emp({ appraisals: [rec('HALF_YEARLY', null, '2026-06-30')] });
    expect(overdueFor(e2, 'HALF_YEARLY', '2026-10-01', today)?.dueDate).toBe(
      '2026-07-20',
    );
  });

  it('a due date moved earlier never brings its milestone back as overdue', () => {
    const e = emp({ appraisals: [rec('HALF_YEARLY', '2026-07-10')] });
    expect(overdueFor(e, 'HALF_YEARLY', '2026-10-01', today)).toBeNull();
  });

  it('never before the confirmation date', () => {
    const e = emp({ confirmationDate: '2026-08-01' });
    expect(overdueFor(e, 'HALF_YEARLY', '2026-10-01', today)).toBeNull();
    const e2 = emp({ confirmationDate: '2026-07-20' });
    expect(overdueFor(e2, 'HALF_YEARLY', '2026-10-01', today)?.dueDate).toBe(
      '2026-07-20',
    );
  });

  it('looks back 12 months at most (bulk-confirmed staff are not years overdue)', () => {
    // A January window, today 12 Oct 2026: the yearly due 12 Oct 2025 is exactly 12 months back...
    const e = emp({ joinDate: '2020-10-12' });
    expect(overdueFor(e, 'YEARLY', '2026-01-01', today)?.dueDate).toBe(
      '2025-10-12',
    );
    // ...one day older is out (and an older miss is never looked at instead).
    const e2 = emp({ joinDate: '2020-10-11' });
    expect(overdueFor(e2, 'YEARLY', '2026-01-01', today)).toBeNull();
  });

  it('a null confirmation date (never recorded) only applies the lookback', () => {
    expect(
      overdueFor(emp({ confirmationDate: null }), 'YEARLY', today, today),
    ).toMatchObject({ dueDate: '2026-01-20' });
  });

  it('half-yearly/yearly never while on probation; confirmation only while on probation, however old', () => {
    const prob = emp({ status: 'PROBATION', joinDate: '2024-01-10' });
    expect(overdueFor(prob, 'HALF_YEARLY', today, today)).toBeNull();
    expect(overdueFor(prob, 'CONFIRMATION', today, today)).toMatchObject({
      dueDate: '2024-07-10',
    });
    expect(
      overdueFor({ ...prob, status: 'ACTIVE' }, 'CONFIRMATION', today, today),
    ).toBeNull();
    expect(
      overdueFor({ ...prob, status: 'EXITED' }, 'CONFIRMATION', today, today),
    ).toBeNull();
  });

  it('counts strictly before the cut-off', () => {
    expect(overdueFor(emp(), 'HALF_YEARLY', '2026-07-20', today)?.dueDate).toBe(
      '2026-01-20',
    );
    expect(overdueFor(emp(), 'HALF_YEARLY', '2026-07-21', today)?.dueDate).toBe(
      '2026-07-20',
    );
  });
});

describe('lateness', () => {
  it('days late before today, days early after, late 0 on the day', () => {
    expect(lateness('2026-09-15', '2026-10-12')).toEqual({
      daysLate: 27,
      daysEarly: null,
    });
    expect(lateness('2026-10-20', '2026-10-12')).toEqual({
      daysLate: null,
      daysEarly: 8,
    });
    expect(lateness('2026-10-12', '2026-10-12')).toEqual({
      daysLate: 0,
      daysEarly: null,
    });
  });
});

describe('classifyDue', () => {
  const w = { from: '2026-10-01', to: '2026-10-31', today: '2026-10-12' };

  it('due in the window wins over an older miss', () => {
    // Joined 15 Apr 2025: due 15 Oct 2026 (in window); 15 Apr 2026 missed.
    expect(
      classifyDue(emp({ joinDate: '2025-04-15' }), 'HALF_YEARLY', w),
    ).toMatchObject({ group: 'due', dueDate: '2026-10-15', daysEarly: 3 });
  });

  it('overdue when nothing is due in the window', () => {
    expect(classifyDue(emp(), 'HALF_YEARLY', w)).toMatchObject({
      group: 'overdue',
      dueDate: '2026-07-20',
      daysLate: 84,
      daysEarly: null,
    });
  });

  it('coming up within 60 days after the window end, and not one day more', () => {
    // Window end 31 Oct + 60 days = 30 Dec.
    expect(
      classifyDue(
        emp({ joinDate: '2025-06-30', confirmationDate: '2026-12-31' }),
        'HALF_YEARLY',
        w,
      ),
    ).toMatchObject({
      group: 'upcoming',
      dueDate: '2026-12-30',
      daysEarly: 79,
    });
    expect(
      classifyDue(
        emp({ joinDate: '2025-07-01', confirmationDate: '2026-12-31' }),
        'HALF_YEARLY',
        w,
      ),
    ).toBeNull();
  });

  it('already appraised for the window’s due date (in any cycle): not due', () => {
    const e = emp({
      joinDate: '2025-04-15',
      appraisals: [rec('HALF_YEARLY', '2026-10-15')],
    });
    expect(classifyDue(e, 'HALF_YEARLY', w)).toBeNull();
  });

  it('an early appraisal for an upcoming due date takes it off the list', () => {
    const e = emp({
      joinDate: '2025-06-30',
      confirmationDate: '2026-12-31',
      appraisals: [rec('HALF_YEARLY', '2026-12-30')],
    });
    expect(classifyDue(e, 'HALF_YEARLY', w)).toBeNull();
  });
});

describe('selectDue', () => {
  it('groups everyone in scope, at most once each', () => {
    const people = [
      { id: 'due', ...emp({ joinDate: '2025-04-15' }) },
      { id: 'late', ...emp() },
      {
        id: 'soon',
        ...emp({ joinDate: '2025-06-30', confirmationDate: '2026-12-31' }),
      },
      { id: 'gone', ...emp({ status: 'EXITED' }) },
    ];
    const g = selectDue(people, 'HALF_YEARLY', {
      from: '2026-10-01',
      to: '2026-10-31',
      today: '2026-10-12',
    });
    expect(g.due.map((x) => x.employee.id)).toEqual(['due']);
    expect(g.overdue.map((x) => x.employee.id)).toEqual(['late']);
    expect(g.upcoming.map((x) => x.employee.id)).toEqual(['soon']);
  });

  it('a confirmation cycle only looks at probation', () => {
    const g = selectDue(
      [
        { id: 'p', ...emp({ status: 'PROBATION', joinDate: '2026-01-10' }) },
        { id: 'a', ...emp({ joinDate: '2026-01-10' }) },
      ],
      'CONFIRMATION',
      { from: '2026-10-01', to: '2026-10-31', today: '2026-10-12' },
    );
    expect(g.overdue.map((x) => x.employee.id)).toEqual(['p']);
    expect(g.due).toEqual([]);
  });
});

describe('overdueAppraisals', () => {
  it('lists the yearly once when an anniversary is missed, oldest first', () => {
    const r = overdueAppraisals(emp(), '2026-10-12');
    expect(r.map((x) => [x.type, x.dueDate])).toEqual([
      ['YEARLY', '2026-01-20'],
      ['HALF_YEARLY', '2026-07-20'],
    ]);
  });
  it('nothing for an exited employee', () => {
    expect(overdueAppraisals(emp({ status: 'EXITED' }), '2026-10-12')).toEqual(
      [],
    );
  });
});

// --- The intern lifecycle (0034) ---------------------------------------------

describe('the probation start anchors the regular schedule (0034)', () => {
  // Intern from 1 Jan 2025, probation from 1 Apr 2025.
  const e = {
    joinDate: '2025-01-01',
    probationStartDate: '2025-04-01',
  };

  it('anchor: the probation start, else the join date', () => {
    expect(anchorOf(e)).toBe('2025-04-01');
    expect(anchorOf({ joinDate: '2025-01-01', probationStartDate: null })).toBe(
      '2025-01-01',
    );
  });

  it('confirmation due 1 Oct 2025; yearly 1 Apr 2026, 1 Apr 2027; reviews start at the anchor', () => {
    expect(
      nextDue({ ...e, status: 'PROBATION' }, '2025-06-01')[0],
    ).toMatchObject({
      type: 'CONFIRMATION',
      dueDate: '2025-10-01',
      periodStart: '2025-04-01',
      periodEnd: '2025-09-30',
    });
    const active = nextDue({ ...e, status: 'ACTIVE' }, '2025-11-01');
    expect(active.find((x) => x.type === 'YEARLY')).toMatchObject({
      dueDate: '2026-04-01',
      periodStart: '2025-04-01',
      periodEnd: '2026-03-31',
    });
    expect(
      nextDue({ ...e, status: 'ACTIVE' }, '2026-04-02').find(
        (x) => x.type === 'YEARLY',
      )?.dueDate,
    ).toBe('2027-04-01');
  });

  it('overdue and the due groups count from the anchor', () => {
    const p: OverdueEmployee = {
      ...e,
      status: 'PROBATION',
      confirmationDate: null,
      appraisals: [],
    };
    expect(overdueAppraisals(p, '2025-10-20')).toEqual([
      expect.objectContaining({ type: 'CONFIRMATION', dueDate: '2025-10-01' }),
    ]);
    // Six months from joining (1 Jul) is not a milestone any more.
    expect(
      classifyDue(p, 'CONFIRMATION', {
        from: '2025-07-01',
        to: '2025-07-31',
        today: '2025-07-01',
      }),
    ).toBeNull();
  });
});

describe('interns and the internship review (0034)', () => {
  const intern = (over: Partial<OverdueEmployee> = {}): OverdueEmployee => ({
    joinDate: '2026-01-01',
    status: 'INTERN',
    probationStartDate: null,
    internshipEndDate: null,
    confirmationDate: null,
    appraisals: [],
    ...over,
  });

  it('due on the internship end, else join + 3 months (clamped, no day subtracted)', () => {
    expect(internshipDueDate(intern())).toBe('2026-04-01');
    expect(internshipDueDate({ joinDate: '2025-11-30' })).toBe('2026-02-28');
    expect(internshipDueDate(intern({ internshipEndDate: '2026-03-31' }))).toBe(
      '2026-03-31',
    );
  });

  it('reviews join -> day before; after an extension, the previous end -> day before the new one', () => {
    expect(
      internshipReview(intern({ internshipEndDate: '2026-03-31' })),
    ).toEqual({
      type: 'INTERNSHIP',
      dueDate: '2026-03-31',
      periodStart: '2026-01-01',
      periodEnd: '2026-03-30',
    });
    expect(
      internshipReview(
        intern({
          internshipEndDate: '2026-05-31',
          internshipTermStart: '2026-03-31',
        }),
      ),
    ).toMatchObject({ periodStart: '2026-03-31', periodEnd: '2026-05-30' });
  });

  it('scope: an intern only for the internship review, which is for interns only', () => {
    expect(inScope({ status: 'INTERN' }, 'INTERNSHIP')).toBe(true);
    for (const t of ['YEARLY', 'HALF_YEARLY', 'CONFIRMATION'] as const)
      expect(inScope({ status: 'INTERN' }, t)).toBe(false);
    expect(inScope({ status: 'PROBATION' }, 'INTERNSHIP')).toBe(false);
    expect(inScope({ status: 'ACTIVE' }, 'INTERNSHIP')).toBe(false);
  });

  it('nextDue: the internship review only, flagged overdue once passed', () => {
    expect(nextDue(intern(), '2026-02-01')).toEqual([
      {
        type: 'INTERNSHIP',
        dueDate: '2026-04-01',
        periodStart: '2026-01-01',
        periodEnd: '2026-03-31',
        overdue: false,
      },
    ]);
    expect(nextDue(intern(), '2026-05-01')[0].overdue).toBe(true);
  });

  it('due, overdue (no lookback) and coming up, unless the term has a review', () => {
    const w = (from: string, to: string, today = from) => ({ from, to, today });
    expect(
      classifyDue(intern(), 'INTERNSHIP', w('2026-04-01', '2026-04-30'))?.group,
    ).toBe('due');
    expect(
      classifyDue(intern(), 'INTERNSHIP', w('2027-06-01', '2027-06-30')),
    ).toMatchObject({ group: 'overdue', dueDate: '2026-04-01' });
    expect(
      classifyDue(intern(), 'INTERNSHIP', w('2026-03-01', '2026-03-15'))?.group,
    ).toBe('upcoming');
    const reviewed = intern({
      appraisals: [
        { type: 'INTERNSHIP', dueDate: '2026-03-28', periodEnd: '2026-03-27' },
      ],
    });
    expect(
      classifyDue(reviewed, 'INTERNSHIP', w('2026-04-01', '2026-04-30')),
    ).toBeNull();
    expect(overdueAppraisals(reviewed, '2026-06-01')).toEqual([]);
    expect(overdueAppraisals(intern(), '2026-06-01')).toEqual([
      expect.objectContaining({ type: 'INTERNSHIP', dueDate: '2026-04-01' }),
    ]);
    expect(
      selectDue([intern(), emp()], 'INTERNSHIP', w('2026-04-01', '2026-04-30'))
        .due,
    ).toHaveLength(1);
  });

  it('after an extension the old term’s review no longer covers the new end', () => {
    const records: AppraisalOnRecord[] = [
      { type: 'INTERNSHIP', dueDate: '2026-04-01', periodEnd: '2026-03-31' },
    ];
    const extended = intern({
      internshipEndDate: '2026-06-01',
      internshipTermStart: '2026-04-01',
      appraisals: records,
    });
    expect(internshipCovered(intern(), records)).toBe(true);
    expect(internshipCovered(extended, records)).toBe(false);
    expect(isDueCovered(extended, 'INTERNSHIP', '2026-06-01')).toBe(false);
    expect(
      classifyDue(extended, 'INTERNSHIP', {
        from: '2026-06-01',
        to: '2026-06-30',
        today: '2026-06-01',
      }),
    ).toMatchObject({
      group: 'due',
      dueDate: '2026-06-01',
      periodStart: '2026-04-01',
    });
  });

  it('an intern is never due or overdue a regular review', () => {
    const old = intern({ joinDate: '2024-01-01' });
    expect(overdueFor(old, 'YEARLY', '2026-06-01', '2026-06-01')).toBeNull();
    expect(
      overdueFor(old, 'CONFIRMATION', '2026-06-01', '2026-06-01'),
    ).toBeNull();
  });

  it('explicit-pick helpers and due-date edits', () => {
    expect(dueOnOrBeforeFor(intern(), 'INTERNSHIP', '2026-03-31')).toBeNull();
    expect(
      dueOnOrBeforeFor(intern(), 'INTERNSHIP', '2026-04-30')?.dueDate,
    ).toBe('2026-04-01');
    expect(firstDueFor(intern(), 'INTERNSHIP')).toBe('2026-04-01');
    expect(
      firstDueFor(
        {
          joinDate: '2025-01-01',
          probationStartDate: '2025-04-01',
          status: 'PROBATION',
        },
        'CONFIRMATION',
      ),
    ).toBe('2025-10-01');
    const others: AppraisalOnRecord[] = [
      { type: 'INTERNSHIP', dueDate: '2026-04-01', periodEnd: '2026-03-31' },
    ];
    expect(dueDateTaken(intern(), 'INTERNSHIP', '2026-04-01', others)).toBe(
      '2026-04-01',
    );
    expect(
      dueDateTaken(intern(), 'INTERNSHIP', '2026-06-01', others),
    ).toBeNull();
  });
});
