import { buildFormHeader, monthsText, takaText } from './appraisal-header';
import {
  actionBlockers,
  advanceBlockers,
  cleanRatings,
  defaultIncrementPercent,
  editableFields,
  FORM_CRITERIA,
  FORM_STEPS,
  formOutcomePlan,
  formScore,
  GRADE_TABLE,
  gradeFor,
  gradePolicy,
  incrementedSalary,
  isValidRating,
  nextStatus,
  parseRatings,
  policyLine,
  previousStatus,
  recommendsSeparation,
  stepsFor,
  validateCompetencies,
} from './appraisal-score';
import type { AppraisalStatusValue } from './appraisals.types';

const KEYS = FORM_CRITERIA.map((c) => c.key);
const all = (v: number) => Object.fromEntries(KEYS.map((k) => [k, v]));

describe('FORM_100 criteria', () => {
  it('are the paper form’s 10 criteria, each with its description', () => {
    expect(FORM_CRITERIA.map((c) => c.label)).toEqual([
      'Job Knowledge',
      'Customer Orientation',
      'Decision Making',
      'Planning and Organizing',
      'Building and Leading Teams',
      'Developing People',
      'Communication',
      'Influencing',
      'Commitment to Excel',
      'Integrity',
    ]);
    for (const c of FORM_CRITERIA)
      expect(c.description?.length).toBeGreaterThan(40);
    expect(validateCompetencies(FORM_CRITERIA)).toBeNull();
  });
  it('refuses an over-long description', () => {
    expect(
      validateCompetencies([
        { key: 'a', label: 'A', description: 'x'.repeat(1001) },
      ]),
    ).toMatch(/description/);
  });
});

describe('FORM_100 ratings', () => {
  it('accept only 2, 4, 6, 8 and 10', () => {
    for (const v of [2, 4, 6, 8, 10])
      expect(isValidRating(v, 'FORM_100')).toBe(true);
    for (const v of [0, 1, 3, 5, 7, 9, 11, 12, 8.5, '8', null])
      expect(isValidRating(v, 'FORM_100')).toBe(false);
  });
  it('legacy still accepts 1-5 and refuses 6-10', () => {
    expect(isValidRating(3)).toBe(true);
    expect(isValidRating(8)).toBe(false);
  });
  it('parseRatings explains the form scale', () => {
    expect(parseRatings({ job_knowledge: 10 }, KEYS, 'FORM_100')).toEqual({
      ok: true,
      value: { job_knowledge: 10 },
    });
    const bad = parseRatings({ job_knowledge: 5 }, KEYS, 'FORM_100');
    expect(bad).toEqual({
      ok: false,
      error: expect.stringMatching(/2, 4, 6, 8 or 10/),
    });
  });
  it('cleanRatings keeps form values that the legacy scale would drop', () => {
    expect(
      cleanRatings({ job_knowledge: 8, integrity: 3 }, KEYS, 'FORM_100'),
    ).toEqual({
      job_knowledge: 8,
    });
  });
});

describe('formScore', () => {
  it('is the plain sum with the standard 10 criteria', () => {
    expect(formScore(all(8), KEYS)).toEqual({
      total: 80,
      ratedCount: 10,
      criteriaCount: 10,
      grade: 'C',
    });
    expect(formScore(all(10), KEYS).total).toBe(100);
    expect(formScore(all(2), KEYS).total).toBe(20);
  });
  it('normalises to 100 for another number of criteria, to 1 dp', () => {
    // 3 criteria: (10 + 8 + 6) / 30 x 100 = 80
    expect(formScore({ a: 10, b: 8, c: 6 }, ['a', 'b', 'c']).total).toBe(80);
    // 7 criteria all 8: 56 / 70 x 100 = 80
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(
      formScore(Object.fromEntries(seven.map((k) => [k, 8])), seven).total,
    ).toBe(80);
    // 3 criteria 10/10/8: 28/30 x 100 = 93.33 -> 93.3
    expect(formScore({ a: 10, b: 10, c: 8 }, ['a', 'b', 'c']).total).toBe(93.3);
  });
  it('counts unrated criteria as 0 and withholds the grade until all are rated', () => {
    const s = formScore({ job_knowledge: 10, integrity: 8 }, KEYS);
    expect(s).toEqual({
      total: 18,
      ratedCount: 2,
      criteriaCount: 10,
      grade: null,
    });
  });
  it('has no total when nothing is rated', () => {
    expect(formScore({}, KEYS).total).toBeNull();
  });
});

describe('gradeFor (band boundaries)', () => {
  // With 10 criteria rated in steps of 2 the total is always even, so the odd
  // boundaries (51, 61, ...) are only reachable through this pure function or
  // a cycle with a different number of criteria. They are still the form's bands.
  it.each([
    [0, 'F'],
    [50, 'F'],
    [51, 'E'],
    [60, 'E'],
    [61, 'D'],
    [70, 'D'],
    [71, 'C'],
    [80, 'C'],
    [81, 'B'],
    [90, 'B'],
    [91, 'A'],
    [100, 'A'],
  ])('%s -> %s', (total, grade) => {
    expect(gradeFor(total)).toBe(grade);
  });
  it('a fractional total must reach the printed minimum', () => {
    expect(gradeFor(90.5)).toBe('B');
    expect(gradeFor(50.5)).toBe('F');
  });
});

describe('grade policy', () => {
  it('matches the evaluation-metrics table', () => {
    expect(
      GRADE_TABLE.map((r) => [r.grade, r.incrementMin, r.incrementMax]),
    ).toEqual([
      ['A', 15, 15],
      ['B', 13, 14],
      ['C', 11, 12],
      ['D', 9, 10],
      ['E', 7, 8],
      ['F', 0, 0],
    ]);
    expect(gradePolicy('A').promotion).toBe(true);
    expect(gradePolicy('D').training).toBe(true);
    expect(gradePolicy('E')).toMatchObject({
      training: true,
      transfer: true,
      termination: false,
    });
    expect(gradePolicy('F')).toMatchObject({
      transfer: true,
      termination: true,
    });
  });
  it('reads as a one-line proposal', () => {
    expect(policyLine(gradePolicy('B'))).toBe(
      'increment 13–14%, service confirmation',
    );
    expect(policyLine(gradePolicy('A'))).toBe('promotion, increment 15%');
    expect(policyLine(gradePolicy('F'))).toBe(
      'no increment, transfer, termination',
    );
  });
  it('prefills the bottom of the increment range', () => {
    expect(defaultIncrementPercent('B')).toBe(13);
    expect(defaultIncrementPercent('F')).toBe(0);
  });
});

describe('FORM_100 step sequence', () => {
  it('runs supervisor, department head, HR, CTO/COO approval, then sign-off', () => {
    expect(stepsFor('FORM_100')).toBe(FORM_STEPS);
    const walk: AppraisalStatusValue[] = [];
    for (
      let s: AppraisalStatusValue | null = 'SELF_REVIEW';
      s;
      s = nextStatus(s, 'FORM_100')
    )
      walk.push(s);
    expect(walk).toEqual([
      'SELF_REVIEW',
      'LEAD_REVIEW',
      'DEPT_HEAD_REVIEW',
      'HR_REVIEW',
      'FINAL_APPROVAL',
      'SIGNED_OFF',
    ]);
  });
  it('legacy cycles keep calibration and never see the form steps', () => {
    expect(nextStatus('LEAD_REVIEW')).toBe('CALIBRATION');
    expect(nextStatus('LEAD_REVIEW', 'KPI_BLEND')).toBe('CALIBRATION');
    expect(nextStatus('DEPT_HEAD_REVIEW', 'KPI_BLEND')).toBeNull();
    expect(nextStatus('CALIBRATION', 'FORM_100')).toBeNull();
  });
  it('sends back one step, never before the first or after sign-off', () => {
    expect(previousStatus('FINAL_APPROVAL', 'FORM_100')).toBe('HR_REVIEW');
    expect(previousStatus('DEPT_HEAD_REVIEW', 'FORM_100')).toBe('LEAD_REVIEW');
    expect(previousStatus('SELF_REVIEW', 'FORM_100')).toBeNull();
    expect(previousStatus('SIGNED_OFF', 'FORM_100')).toBeNull();
  });
});

describe('FORM_100 editable fields per step', () => {
  it('opens each comment block only in its own step', () => {
    expect(editableFields('SELF_REVIEW', 'FORM_100')).toEqual([
      'selfRatings',
      'selfComment',
    ]);
    expect(editableFields('LEAD_REVIEW', 'FORM_100')).toEqual([
      'leadRatings',
      'leadComment',
      'actions',
      'incrementPercent',
      'newDesignation',
      'trainingPlan',
    ]);
    expect(editableFields('DEPT_HEAD_REVIEW', 'FORM_100')).toContain(
      'deptHeadComment',
    );
    expect(editableFields('DEPT_HEAD_REVIEW', 'FORM_100')).toContain('actions');
    expect(editableFields('DEPT_HEAD_REVIEW', 'FORM_100')).not.toContain(
      'leadRatings',
    );
    expect(editableFields('HR_REVIEW', 'FORM_100')).toEqual(['hrComment']);
    expect(editableFields('FINAL_APPROVAL', 'FORM_100')).toEqual([
      'approvalDecision',
      'approvalComment',
    ]);
    expect(editableFields('SIGNED_OFF', 'FORM_100')).toEqual([]);
  });
  it('legacy steps never accept the form fields', () => {
    for (const s of ['SELF_REVIEW', 'LEAD_REVIEW', 'CALIBRATION'] as const) {
      expect(editableFields(s)).not.toContain('actions');
      expect(editableFields(s)).not.toContain('approvalDecision');
    }
  });
});

describe('actionBlockers', () => {
  const ok = {
    actions: ['CONFIRM' as const],
    newDesignation: null,
    incrementPercent: null,
  };
  it('wants at least one recommendation', () => {
    expect(actionBlockers({ ...ok, actions: [] })).toEqual([
      'Tick at least one recommendation',
    ]);
    expect(actionBlockers(ok)).toEqual([]);
  });
  it('wants a designation for a promotion and a percent for an increment', () => {
    expect(
      actionBlockers({ ...ok, actions: ['PROMOTION', 'INCREMENT'] }),
    ).toEqual([
      'Name the new designation for a promotion',
      'Set the increment percentage',
    ]);
    expect(
      actionBlockers({
        actions: ['PROMOTION', 'INCREMENT'],
        newDesignation: 'Manager',
        incrementPercent: 15,
      }),
    ).toEqual([]);
  });
  it('refuses separation alongside retention', () => {
    expect(
      actionBlockers({ ...ok, actions: ['CONFIRM', 'TERMINATION'] }),
    ).toHaveLength(1);
    expect(
      actionBlockers({ ...ok, actions: ['DISMISSAL', 'TRAINING_TRANSFER'] }),
    ).toEqual([]);
    expect(recommendsSeparation(['DISMISSAL'])).toBe(true);
    expect(recommendsSeparation(['CONFIRM'])).toBe(false);
  });
});

describe('advanceBlockers (FORM_100)', () => {
  const lead = {
    mode: 'FORM_100' as const,
    status: 'LEAD_REVIEW' as const,
    leadRatings: all(8),
    competencyKeys: KEYS,
    recommendation: null,
    newDesignation: null,
    actions: ['CONFIRM' as const],
    incrementPercent: null,
    approvalDecision: null,
    grossSalaryKnown: false,
  };
  it('lets the self review through with no self ratings', () => {
    expect(
      advanceBlockers({ ...lead, status: 'SELF_REVIEW', leadRatings: {} }),
    ).toEqual([]);
  });
  it('wants every criterion rated on the form scale', () => {
    expect(
      advanceBlockers({ ...lead, leadRatings: { job_knowledge: 8 } })[0],
    ).toMatch(/9 left/);
    // A legacy 1-5 value is not a form rating.
    expect(
      advanceBlockers({ ...lead, leadRatings: { ...all(8), integrity: 3 } })[0],
    ).toMatch(/1 left/);
    expect(advanceBlockers(lead)).toEqual([]);
  });
  it('does not need a legacy recommendation', () => {
    expect(advanceBlockers({ ...lead, status: 'DEPT_HEAD_REVIEW' })).toEqual(
      [],
    );
  });
  it('never blocks the HR review', () => {
    expect(
      advanceBlockers({ ...lead, status: 'HR_REVIEW', actions: [] }),
    ).toEqual([]);
  });
  it('needs a decision at final approval', () => {
    expect(advanceBlockers({ ...lead, status: 'FINAL_APPROVAL' })).toEqual([
      'Record the approval decision',
    ]);
    expect(
      advanceBlockers({
        ...lead,
        status: 'FINAL_APPROVAL',
        approvalDecision: 'NOT_APPROVED',
      }),
    ).toEqual([]);
  });
  it('needs a gross salary to approve an increment, not to reject one', () => {
    const inc = {
      ...lead,
      status: 'FINAL_APPROVAL' as const,
      actions: ['INCREMENT' as const],
      incrementPercent: 13,
    };
    expect(
      advanceBlockers({ ...inc, approvalDecision: 'APPROVED' }),
    ).toHaveLength(1);
    expect(
      advanceBlockers({
        ...inc,
        approvalDecision: 'APPROVED',
        grossSalaryKnown: true,
      }),
    ).toEqual([]);
    expect(
      advanceBlockers({ ...inc, approvalDecision: 'NOT_APPROVED' }),
    ).toEqual([]);
  });
});

describe('formOutcomePlan', () => {
  const base = {
    decision: 'APPROVED' as const,
    actions: [] as (
      | 'CONFIRM'
      | 'INCREMENT'
      | 'PROMOTION'
      | 'TERMINATION'
      | 'DISMISSAL'
      | 'TRAINING_TRANSFER'
    )[],
    newDesignation: null,
    incrementPercent: null,
    grossSalary: 80000,
    employeeStatus: 'PROBATION' as const,
    cycleName: 'H2 2026',
    effectiveDate: '2026-12-31',
  };
  it('writes nothing when not approved, whatever was ticked', () => {
    for (const decision of ['NOT_APPROVED', null] as const) {
      expect(
        formOutcomePlan({
          ...base,
          decision,
          actions: ['CONFIRM', 'PROMOTION', 'INCREMENT'],
          newDesignation: 'X',
          incrementPercent: 10,
        }),
      ).toEqual({ events: [], notApplied: [] });
    }
  });
  it('CONFIRM writes CONFIRMED while on probation', () => {
    expect(formOutcomePlan({ ...base, actions: ['CONFIRM'] }).events).toEqual([
      {
        type: 'CONFIRMED',
        effectiveDate: '2026-12-31',
        toValue: null,
        notes: 'Appraisal H2 2026 outcome',
      },
    ]);
  });
  it('CONFIRM is skipped, with a reason, when the employee is not on probation', () => {
    for (const employeeStatus of ['ACTIVE', 'NOTICE'] as const) {
      const out = formOutcomePlan({
        ...base,
        employeeStatus,
        actions: ['CONFIRM'],
      });
      expect(out.events).toEqual([]);
      expect(out.notApplied).toEqual([
        {
          action: 'CONFIRM',
          reason: expect.stringContaining(employeeStatus.toLowerCase()),
        },
      ]);
    }
  });
  it('PROMOTION writes PROMOTED to the new designation', () => {
    expect(
      formOutcomePlan({
        ...base,
        actions: ['PROMOTION'],
        newDesignation: ' Manager ',
      }).events,
    ).toEqual([
      {
        type: 'PROMOTED',
        effectiveDate: '2026-12-31',
        toValue: 'Manager',
        notes: 'Appraisal H2 2026 outcome',
      },
    ]);
    expect(() =>
      formOutcomePlan({ ...base, actions: ['PROMOTION'] }),
    ).toThrow();
  });
  it('INCREMENT writes old -> new gross salary with the percent as notes', () => {
    expect(
      formOutcomePlan({ ...base, actions: ['INCREMENT'], incrementPercent: 13 })
        .events,
    ).toEqual([
      {
        type: 'INCREMENT',
        effectiveDate: '2026-12-31',
        fromValue: '80000',
        toValue: '90400',
        notes: '13%',
      },
    ]);
    expect(
      formOutcomePlan({
        ...base,
        actions: ['INCREMENT'],
        incrementPercent: 12.5,
      }).events[0],
    ).toMatchObject({
      toValue: '90000',
      notes: '12.5%',
    });
    expect(() =>
      formOutcomePlan({
        ...base,
        actions: ['INCREMENT'],
        incrementPercent: 13,
        grossSalary: null,
      }),
    ).toThrow();
    expect(() =>
      formOutcomePlan({ ...base, actions: ['INCREMENT'] }),
    ).toThrow();
  });
  it('rounds the new salary to whole taka', () => {
    expect(incrementedSalary(33333, 7)).toBe(35666);
  });
  it('never separates automatically and records training/transfer on the form only', () => {
    const out = formOutcomePlan({
      ...base,
      actions: ['TERMINATION', 'DISMISSAL', 'TRAINING_TRANSFER'],
    });
    expect(out.events).toEqual([]);
    expect(out.notApplied.map((n) => n.action)).toEqual([
      'TERMINATION',
      'DISMISSAL',
    ]);
  });
  it('writes in a fixed order: confirm, promote, increment', () => {
    const out = formOutcomePlan({
      ...base,
      actions: ['INCREMENT', 'PROMOTION', 'CONFIRM'],
      newDesignation: 'Lead',
      incrementPercent: 15,
    });
    expect(out.events.map((e) => e.type)).toEqual([
      'CONFIRMED',
      'PROMOTED',
      'INCREMENT',
    ]);
  });
});

describe('buildFormHeader', () => {
  const employee = {
    fullName: 'Ada',
    concernName: 'Nifty IT Solution Ltd',
    designation: 'Assistant Manager',
    department: 'Engineering',
    joinDate: '2023-03-15',
    exitDate: null,
    academicQualification: 'BSc in CSE',
    experienceBeforeJoiningMonths: 30,
    startingSalary: 50000,
    grossSalary: 80000,
  };
  it('derives experience, last increment and last promotion', () => {
    const h = buildFormHeader({
      employee,
      companyName: 'Nifty IT Solution',
      today: '2026-10-12',
      capturedAt: '2026-10-12T00:00:00.000Z',
      events: [
        {
          type: 'INCREMENT',
          effectiveDate: '2026-01-01',
          fromValue: '70000',
          toValue: '80000',
        },
        {
          type: 'INCREMENT',
          effectiveDate: '2025-01-01',
          fromValue: '50000',
          toValue: '70000',
        },
        {
          type: 'PROMOTED',
          effectiveDate: '2025-06-01',
          fromValue: 'Engineer',
          toValue: 'Assistant Manager',
        },
        {
          type: 'NOTE',
          effectiveDate: '2026-05-01',
          fromValue: null,
          toValue: null,
        },
      ],
    });
    expect(h).toMatchObject({
      name: 'Ada',
      experienceInCompanyMonths: 42,
      experienceBeforeJoiningMonths: 30,
      totalExperienceMonths: 72,
      lastIncrementAmount: 10000,
      lastIncrementDate: '2026-01-01',
      lastPromotionDate: '2025-06-01',
      grossSalary: 80000,
    });
  });
  it('leaves unknowns null rather than guessing', () => {
    const h = buildFormHeader({
      employee: { ...employee, experienceBeforeJoiningMonths: null },
      companyName: 'X',
      today: '2026-10-12',
      capturedAt: 'now',
      events: [
        {
          type: 'INCREMENT',
          effectiveDate: '2026-01-01',
          fromValue: null,
          toValue: null,
        },
      ],
    });
    expect(h.totalExperienceMonths).toBeNull();
    expect(h.lastIncrementAmount).toBeNull();
    expect(h.lastPromotionDate).toBeNull();
  });
  it('formats months and taka', () => {
    expect(monthsText(42)).toBe('3 yrs 6 mos');
    expect(monthsText(12)).toBe('1 yr');
    expect(monthsText(0)).toBe('0 mos');
    expect(monthsText(null)).toBe('—');
    expect(takaText(85000)).toBe('BDT 85,000');
  });
});
