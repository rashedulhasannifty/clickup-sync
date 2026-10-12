import {
  addMonthsClamped,
  dueBetween,
  dueInWindow,
  dueOnOrBefore,
  inScope,
  latestMilestoneOnOrBefore,
  milestones,
  nextDue,
  reviewPeriod,
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
    expect(nextDue('2026-07-01', 'PROBATION', '2026-10-12')).toEqual([
      {
        type: 'CONFIRMATION',
        dueDate: '2027-01-01',
        periodStart: '2026-07-01',
        periodEnd: '2026-12-31',
        overdue: false,
      },
    ]);
    const late = nextDue('2026-01-10', 'PROBATION', '2026-10-12');
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({
      type: 'CONFIRMATION',
      dueDate: '2026-07-10',
      overdue: true,
    });
  });

  it('confirmed: the next half-yearly and the next yearly, earliest first', () => {
    expect(nextDue('2025-04-15', 'ACTIVE', '2026-10-12')).toEqual([
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
    const r = nextDue('2025-10-12', 'ACTIVE', '2026-10-12');
    expect(r.map((x) => [x.type, x.dueDate])).toEqual([
      ['YEARLY', '2026-10-12'],
      ['HALF_YEARLY', '2026-10-12'],
    ]);
  });

  it('confirmed before 12 months: the first half-yearly is at 12 months', () => {
    const r = nextDue('2026-03-01', 'ACTIVE', '2026-10-12');
    expect(r.map((x) => [x.type, x.dueDate])).toEqual([
      ['YEARLY', '2027-03-01'],
      ['HALF_YEARLY', '2027-03-01'],
    ]);
  });

  it('exited: nothing; notice: still scheduled', () => {
    expect(nextDue('2025-04-15', 'EXITED', '2026-10-12')).toEqual([]);
    expect(nextDue('2025-04-15', 'NOTICE', '2026-10-12')).toHaveLength(2);
  });

  it('a join date in the future still gives the first milestones', () => {
    expect(nextDue('2026-12-01', 'PROBATION', '2026-10-12')[0].dueDate).toBe(
      '2027-06-01',
    );
    expect(
      nextDue('2026-12-01', 'ACTIVE', '2026-10-12').map((x) => x.dueDate),
    ).toEqual(['2027-12-01', '2027-12-01']);
  });
});
