import {
  advanceBlockers,
  cleanRatings,
  competencyPart,
  computeScore,
  cycleStatusAllowed,
  editableFields,
  isValidCalibratedScore,
  kpiPart,
  nextStatus,
  outcomePlan,
  parseRatings,
  previousStatus,
  signOffAction,
  validateCompetencies,
} from './appraisal-score';

const KEYS = ['a', 'b', 'c', 'd'];
const all = (v: number) => Object.fromEntries(KEYS.map((k) => [k, v]));

describe('kpiPart', () => {
  it('maps the 0-100 KPI score onto 0-5', () => {
    expect(kpiPart(100)).toBe(5);
    expect(kpiPart(82)).toBeCloseTo(4.1);
    expect(kpiPart(0)).toBe(0);
  });
  it('is null when there is no KPI score', () => {
    expect(kpiPart(null)).toBeNull();
  });
});

describe('competencyPart', () => {
  it('is the mean of the lead ratings', () => {
    expect(competencyPart({ a: 4, b: 5 }, KEYS)).toBe(4.5);
  });
  it('ignores keys outside the cycle and invalid values', () => {
    expect(competencyPart({ a: 4, zzz: 1, b: 9 as never }, KEYS)).toBe(4);
  });
  it('is null when nothing is rated', () => {
    expect(competencyPart({}, KEYS)).toBeNull();
  });
});

describe('computeScore', () => {
  const base = {
    kpiScore: 82,
    kpiPartial: false,
    leadRatings: { a: 4, b: 5 },
    competencyKeys: KEYS,
    kpiWeight: 70,
    calibratedScore: null,
  };

  it('weights the KPI part and the competency part, rounded to 1 dp', () => {
    // 4.1 * 0.7 + 4.5 * 0.3 = 2.87 + 1.35 = 4.22
    const s = computeScore(base);
    expect(s.final).toBe(4.2);
    expect(s.computed).toBe(4.2);
    expect(s.kpiPart).toBe(4.1);
    expect(s.competencyPart).toBe(4.5);
    expect(s.partial).toBe(false);
    expect(s.calibrated).toBe(false);
    expect(s.basedOn).toEqual(['kpi', 'competencies']);
  });

  it('honours a different weight', () => {
    // 4.1 * 0.2 + 4.5 * 0.8 = 0.82 + 3.6 = 4.42
    expect(computeScore({ ...base, kpiWeight: 20 }).final).toBe(4.4);
    expect(computeScore({ ...base, kpiWeight: 100 }).final).toBe(4.1);
    expect(computeScore({ ...base, kpiWeight: 0 }).final).toBe(4.5);
  });

  it('rounds half up at 1 dp', () => {
    // kpi 90 -> 4.5, comp 4 -> 0.5*4.5 + 0.5*4 = 4.25 -> 4.3
    expect(
      computeScore({
        ...base,
        kpiScore: 90,
        leadRatings: all(4),
        kpiWeight: 50,
      }).final,
    ).toBe(4.3);
  });

  it('flags a partial KPI score as partial', () => {
    const s = computeScore({ ...base, kpiPartial: true });
    expect(s.partial).toBe(true);
    expect(s.final).toBe(4.2);
  });

  it('flags a missing KPI score as partial and scores on competencies alone', () => {
    const s = computeScore({ ...base, kpiScore: null });
    expect(s.partial).toBe(true);
    expect(s.final).toBe(4.5);
    expect(s.basedOn).toEqual(['competencies']);
  });

  it('scores on the KPI alone when nothing is rated yet', () => {
    const s = computeScore({ ...base, leadRatings: {} });
    expect(s.final).toBe(4.1);
    expect(s.basedOn).toEqual(['kpi']);
  });

  it('has no score when there is nothing to score', () => {
    const s = computeScore({ ...base, kpiScore: null, leadRatings: {} });
    expect(s.final).toBeNull();
    expect(s.computed).toBeNull();
  });

  it('lets a calibrated score win while keeping the computed one', () => {
    const s = computeScore({ ...base, calibratedScore: 3.5 });
    expect(s.final).toBe(3.5);
    expect(s.computed).toBe(4.2);
    expect(s.calibrated).toBe(true);
  });

  it('keeps a calibrated 0 (falsy but set)', () => {
    expect(computeScore({ ...base, calibratedScore: 0 }).final).toBe(0);
  });

  it('keeps the partial flag under a calibrated score', () => {
    expect(
      computeScore({ ...base, kpiPartial: true, calibratedScore: 3 }).partial,
    ).toBe(true);
  });
});

describe('status machine', () => {
  it('moves forward one step at a time', () => {
    expect(nextStatus('SELF_REVIEW')).toBe('LEAD_REVIEW');
    expect(nextStatus('LEAD_REVIEW')).toBe('CALIBRATION');
    expect(nextStatus('CALIBRATION')).toBe('SIGNED_OFF');
  });
  it('has nothing after SIGNED_OFF', () => {
    expect(nextStatus('SIGNED_OFF')).toBeNull();
  });
  it('sends back one step', () => {
    expect(previousStatus('LEAD_REVIEW')).toBe('SELF_REVIEW');
    expect(previousStatus('CALIBRATION')).toBe('LEAD_REVIEW');
  });
  it('cannot send back from the first step or after sign-off', () => {
    expect(previousStatus('SELF_REVIEW')).toBeNull();
    expect(previousStatus('SIGNED_OFF')).toBeNull();
  });
});

describe('editableFields', () => {
  it('gives each step its own fields', () => {
    expect(editableFields('SELF_REVIEW')).toEqual(['selfRatings', 'selfComment']);
    expect(editableFields('LEAD_REVIEW')).toContain('leadRatings');
    expect(editableFields('LEAD_REVIEW')).not.toContain('calibratedScore');
    expect(editableFields('CALIBRATION')).toContain('calibratedScore');
    expect(editableFields('CALIBRATION')).not.toContain('leadRatings');
  });
  it('is empty once signed off', () => {
    expect(editableFields('SIGNED_OFF')).toEqual([]);
  });
});

describe('cycleStatusAllowed', () => {
  it('allows launch, close and reopen', () => {
    expect(cycleStatusAllowed('DRAFT', 'OPEN')).toBe(true);
    expect(cycleStatusAllowed('OPEN', 'CLOSED')).toBe(true);
    expect(cycleStatusAllowed('CLOSED', 'OPEN')).toBe(true);
  });
  it('refuses the rest', () => {
    expect(cycleStatusAllowed('OPEN', 'DRAFT')).toBe(false);
    expect(cycleStatusAllowed('DRAFT', 'CLOSED')).toBe(false);
    expect(cycleStatusAllowed('CLOSED', 'DRAFT')).toBe(false);
  });
});

describe('parseRatings / cleanRatings', () => {
  it('accepts whole numbers 1-5 for known keys', () => {
    expect(parseRatings({ a: 1, b: 5 }, KEYS)).toEqual({
      ok: true,
      value: { a: 1, b: 5 },
    });
  });
  it.each([0, 6, 3.5, '4', null])('rejects %p', (v) => {
    expect(parseRatings({ a: v }, KEYS).ok).toBe(false);
  });
  it('rejects unknown keys and non-objects', () => {
    expect(parseRatings({ nope: 3 }, KEYS).ok).toBe(false);
    expect(parseRatings([1, 2], KEYS).ok).toBe(false);
    expect(parseRatings(null, KEYS).ok).toBe(false);
  });
  it('cleans stored junk', () => {
    expect(cleanRatings({ a: 3, zzz: 4, b: 9 }, KEYS)).toEqual({ a: 3 });
    expect(cleanRatings('x', KEYS)).toEqual({});
  });
});

describe('validateCompetencies', () => {
  it('accepts a good list', () => {
    expect(validateCompetencies([{ key: 'a_1', label: 'A' }])).toBeNull();
  });
  it('refuses empty, bad keys, blank labels and duplicates', () => {
    expect(validateCompetencies([])).toMatch(/at least one/);
    expect(validateCompetencies([{ key: 'Bad Key', label: 'x' }])).toMatch(
      /Competency key/,
    );
    expect(validateCompetencies([{ key: 'a', label: ' ' }])).toMatch(/label/);
    expect(
      validateCompetencies([
        { key: 'a', label: 'x' },
        { key: 'a', label: 'y' },
      ]),
    ).toMatch(/Duplicate/);
  });
});

describe('isValidCalibratedScore', () => {
  it('is 0-5 inclusive', () => {
    expect(isValidCalibratedScore(0)).toBe(true);
    expect(isValidCalibratedScore(5)).toBe(true);
    expect(isValidCalibratedScore(5.1)).toBe(false);
    expect(isValidCalibratedScore(-1)).toBe(false);
    expect(isValidCalibratedScore(NaN)).toBe(false);
  });
});

describe('advanceBlockers', () => {
  const lead = {
    status: 'LEAD_REVIEW' as const,
    leadRatings: all(4),
    competencyKeys: KEYS,
    recommendation: 'RAISE' as const,
    newDesignation: null,
  };
  it('never blocks the self review', () => {
    expect(
      advanceBlockers({ ...lead, status: 'SELF_REVIEW', leadRatings: {} }),
    ).toEqual([]);
  });
  it('passes a complete lead review', () => {
    expect(advanceBlockers(lead)).toEqual([]);
    expect(advanceBlockers({ ...lead, status: 'CALIBRATION' })).toEqual([]);
  });
  it('wants every competency rated and a recommendation', () => {
    const out = advanceBlockers({
      ...lead,
      leadRatings: { a: 3 },
      recommendation: null,
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/3 left/);
  });
  it('wants a designation for a promotion', () => {
    expect(
      advanceBlockers({ ...lead, recommendation: 'PROMOTE' }),
    ).toHaveLength(1);
    expect(
      advanceBlockers({
        ...lead,
        recommendation: 'PROMOTE',
        newDesignation: 'Senior Developer',
      }),
    ).toEqual([]);
  });
  it('blocks everything once signed off', () => {
    expect(advanceBlockers({ ...lead, status: 'SIGNED_OFF' })).toHaveLength(1);
  });
});

describe('signOffAction (idempotency)', () => {
  it('signs off from calibration', () => {
    expect(
      signOffAction({ status: 'CALIBRATION', outcomeAppliedAt: null }),
    ).toBe('sign-off');
  });
  it('does nothing the second time', () => {
    expect(
      signOffAction({ status: 'SIGNED_OFF', outcomeAppliedAt: new Date() }),
    ).toBe('noop');
  });
  it('finishes an outcome that never landed', () => {
    expect(
      signOffAction({ status: 'SIGNED_OFF', outcomeAppliedAt: null }),
    ).toBe('apply-outcome');
  });
});

describe('outcomePlan', () => {
  const base = {
    cycleName: 'H2 2026',
    effectiveDate: '2026-12-31',
  };
  it('PROMOTE writes a PROMOTED event to the new designation', () => {
    expect(
      outcomePlan({
        ...base,
        recommendation: 'PROMOTE',
        newDesignation: ' Senior Developer ',
      }),
    ).toEqual({
      type: 'PROMOTED',
      effectiveDate: '2026-12-31',
      toValue: 'Senior Developer',
      notes: 'Appraisal H2 2026 outcome',
    });
  });
  it('PROMOTE without a designation is a programming error', () => {
    expect(() =>
      outcomePlan({ ...base, recommendation: 'PROMOTE', newDesignation: null }),
    ).toThrow();
  });
  it('RAISE and IMPROVEMENT_PLAN write NOTE events', () => {
    const raise = outcomePlan({
      ...base,
      recommendation: 'RAISE',
      newDesignation: null,
    });
    expect(raise?.type).toBe('NOTE');
    expect(raise?.notes).toBe(
      'Salary increase recommended — appraisal H2 2026',
    );
    expect(
      outcomePlan({
        ...base,
        recommendation: 'IMPROVEMENT_PLAN',
        newDesignation: null,
      })?.type,
    ).toBe('NOTE');
  });
  it('NO_CHANGE and no recommendation write nothing', () => {
    expect(
      outcomePlan({ ...base, recommendation: 'NO_CHANGE', newDesignation: null }),
    ).toBeNull();
    expect(
      outcomePlan({ ...base, recommendation: null, newDesignation: null }),
    ).toBeNull();
  });
});
