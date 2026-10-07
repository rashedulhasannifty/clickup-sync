import type {
  AppraisalCycleStatusValue,
  AppraisalEditableField,
  AppraisalRecommendationValue,
  AppraisalStatusValue,
  Competency,
  OutcomeEventPlan,
  RatingMap,
} from './appraisals.types';

/**
 * Pure appraisal rules: scoring, the status machine, which fields each step
 * accepts, and what sign-off writes to the employment timeline. No I/O and no
 * clock, so every branch is unit-testable. Dates are `YYYY-MM-DD`.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const SCORE_MAX = 5;
export const DEFAULT_KPI_WEIGHT = 70;

export const DEFAULT_COMPETENCIES: readonly Competency[] = [
  { key: 'technical_skill', label: 'Technical skill' },
  { key: 'communication', label: 'Communication & collaboration' },
  { key: 'ownership', label: 'Ownership & initiative' },
  { key: 'mentoring', label: 'Mentoring' },
];

const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

// --- Status machine -------------------------------------------------------

export const APPRAISAL_STEPS: readonly AppraisalStatusValue[] = [
  'SELF_REVIEW',
  'LEAD_REVIEW',
  'CALIBRATION',
  'SIGNED_OFF',
];

/** Forward one step at a time. Nothing follows SIGNED_OFF. */
export function nextStatus(
  s: AppraisalStatusValue,
): AppraisalStatusValue | null {
  const i = APPRAISAL_STEPS.indexOf(s);
  return i >= 0 && i < APPRAISAL_STEPS.length - 1 ? APPRAISAL_STEPS[i + 1] : null;
}

/** Send back one step for corrections. Not from the first step, and never after sign-off. */
export function previousStatus(
  s: AppraisalStatusValue,
): AppraisalStatusValue | null {
  if (s === 'SIGNED_OFF') return null;
  const i = APPRAISAL_STEPS.indexOf(s);
  return i > 0 ? APPRAISAL_STEPS[i - 1] : null;
}

const EDITABLE: Record<AppraisalStatusValue, AppraisalEditableField[]> = {
  SELF_REVIEW: ['selfRatings', 'selfComment'],
  LEAD_REVIEW: [
    'leadRatings',
    'leadComment',
    'strengths',
    'improvements',
    'goals',
    'recommendation',
    'newDesignation',
  ],
  CALIBRATION: [
    'recommendation',
    'newDesignation',
    'calibrationNote',
    'calibratedScore',
  ],
  SIGNED_OFF: [],
};

/** The fields a step accepts. Signed-off appraisals are read-only. */
export function editableFields(
  s: AppraisalStatusValue,
): AppraisalEditableField[] {
  return [...EDITABLE[s]];
}

/** Cycle status moves: DRAFT -> OPEN (launch), OPEN -> CLOSED, and CLOSED -> OPEN to reopen. */
export function cycleStatusAllowed(
  from: AppraisalCycleStatusValue,
  to: AppraisalCycleStatusValue,
): boolean {
  if (from === to) return true;
  return (
    (from === 'DRAFT' && to === 'OPEN') ||
    (from === 'OPEN' && to === 'CLOSED') ||
    (from === 'CLOSED' && to === 'OPEN')
  );
}

// --- Ratings and competencies --------------------------------------------

export const isValidRating = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isInteger(v) &&
  v >= RATING_MIN &&
  v <= RATING_MAX;

/**
 * A ratings map from untrusted input: only known competency keys, whole
 * numbers 1-5. Returns an error message rather than throwing.
 */
export function parseRatings(
  input: unknown,
  keys: readonly string[],
): { ok: true; value: RatingMap } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'ratings must be an object of key: 1-5' };
  }
  const known = new Set(keys);
  const value: RatingMap = {};
  for (const [k, v] of Object.entries(input)) {
    if (!known.has(k)) return { ok: false, error: `Unknown competency "${k}"` };
    if (!isValidRating(v)) {
      return {
        ok: false,
        error: `Rating for "${k}" must be a whole number ${RATING_MIN}-${RATING_MAX}`,
      };
    }
    value[k] = v;
  }
  return { ok: true, value };
}

/** Stored ratings, defensively: keep only known keys with valid values. */
export function cleanRatings(
  stored: unknown,
  keys: readonly string[],
): RatingMap {
  const out: RatingMap = {};
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored))
    return out;
  const known = new Set(keys);
  for (const [k, v] of Object.entries(stored)) {
    if (known.has(k) && isValidRating(v)) out[k] = v;
  }
  return out;
}

const COMPETENCY_KEY = /^[a-z0-9_]{1,40}$/;

export function validateCompetencies(
  list: readonly Competency[],
): string | null {
  if (list.length === 0) return 'A cycle needs at least one competency';
  const seen = new Set<string>();
  for (const c of list) {
    if (!COMPETENCY_KEY.test(c.key))
      return `Competency key "${c.key}" must be 1-40 characters of a-z, 0-9 or _`;
    if (!c.label.trim()) return `Competency "${c.key}" needs a label`;
    if (seen.has(c.key)) return `Duplicate competency key "${c.key}"`;
    seen.add(c.key);
  }
  return null;
}

// --- Scoring --------------------------------------------------------------

/** KPI overall score (0-100) onto the 0-5 scale. Unrounded. */
export function kpiPart(overallKpiScore: number | null): number | null {
  return overallKpiScore === null ? null : overallKpiScore / 20;
}

/** Mean of the lead ratings over the cycle's competencies. Unrounded; null when none are rated. */
export function competencyPart(
  leadRatings: RatingMap,
  competencyKeys: readonly string[],
): number | null {
  const rated = competencyKeys.flatMap((k) => {
    const v = leadRatings[k];
    return isValidRating(v) ? [v] : [];
  });
  if (rated.length === 0) return null;
  return rated.reduce((a, b) => a + b, 0) / rated.length;
}

export interface ScoreInput {
  /** The snapshot's overall KPI score (0-100); null when no KPI has data or no snapshot yet. */
  kpiScore: number | null;
  /** The snapshot's overall score is `partial` (employee not linked to ClickUp). */
  kpiPartial: boolean;
  leadRatings: RatingMap;
  competencyKeys: readonly string[];
  /** 0-100. */
  kpiWeight: number;
  calibratedScore: number | null;
}

export interface Score {
  final: number | null;
  computed: number | null;
  kpiPart: number | null;
  competencyPart: number | null;
  partial: boolean;
  calibrated: boolean;
  basedOn: ('kpi' | 'competencies')[];
}

/**
 * `final = kpiPart x kpiWeight% + competencyPart x (100 - kpiWeight)%`, 1 dp.
 * When only one part exists the score rests on that part alone (the weights
 * are renormalised, not treated as a zero). A KPI score that is missing or
 * partial flags the result partial. A calibrated score, when set, wins; the
 * partial flag still describes the data underneath it.
 */
export function computeScore(input: ScoreInput): Score {
  const k = kpiPart(input.kpiScore);
  const c = competencyPart(input.leadRatings, input.competencyKeys);
  const basedOn: Score['basedOn'] = [];
  if (k !== null) basedOn.push('kpi');
  if (c !== null) basedOn.push('competencies');

  const w = Math.min(100, Math.max(0, input.kpiWeight));
  let computed: number | null;
  if (k !== null && c !== null) computed = (k * w + c * (100 - w)) / 100;
  else computed = k ?? c;

  const calibrated = input.calibratedScore !== null;
  return {
    final: calibrated
      ? round(input.calibratedScore as number, 1)
      : computed === null
        ? null
        : round(computed, 1),
    computed: computed === null ? null : round(computed, 1),
    kpiPart: k === null ? null : round(k, 2),
    competencyPart: c === null ? null : round(c, 2),
    partial: input.kpiScore === null || input.kpiPartial,
    calibrated,
    basedOn,
  };
}

export const isValidCalibratedScore = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= SCORE_MAX;

// --- Advancing and sign-off ----------------------------------------------

export interface AdvanceInput {
  status: AppraisalStatusValue;
  leadRatings: RatingMap;
  competencyKeys: readonly string[];
  recommendation: AppraisalRecommendationValue | null;
  newDesignation: string | null;
}

/**
 * What stops the next step. Leaving the self review is always allowed (an
 * admin may be filling it in on the employee's behalf, or skipping it); the
 * lead review must be complete before calibration and again at sign-off.
 */
export function advanceBlockers(a: AdvanceInput): string[] {
  if (a.status === 'SIGNED_OFF') return ['This appraisal is already signed off'];
  if (a.status === 'SELF_REVIEW') return [];
  const out: string[] = [];
  const unrated = a.competencyKeys.filter(
    (k) => !isValidRating(a.leadRatings[k]),
  );
  if (unrated.length > 0)
    out.push(`Rate every competency (${unrated.length} left)`);
  if (!a.recommendation) out.push('Choose a recommendation');
  if (a.recommendation === 'PROMOTE' && !a.newDesignation?.trim())
    out.push('Name the new designation for a promotion');
  return out;
}

export type SignOffAction =
  /** Flip to SIGNED_OFF, freeze the score, then apply the outcome. */
  | 'sign-off'
  /** Signed off but the outcome never landed (a crash between the two writes): finish it. */
  | 'apply-outcome'
  /** Signed off and applied: nothing to do. */
  | 'noop';

/** Signing off twice applies the outcome once. Only meaningful from CALIBRATION or SIGNED_OFF. */
export function signOffAction(a: {
  status: AppraisalStatusValue;
  outcomeAppliedAt: Date | null;
}): SignOffAction {
  if (a.status !== 'SIGNED_OFF') return 'sign-off';
  return a.outcomeAppliedAt ? 'noop' : 'apply-outcome';
}

/**
 * The employment event a recommendation writes, or null for NO_CHANGE.
 * PROMOTE goes through `EmployeesService.addEvent` as PROMOTED, which also
 * moves the employee's designation.
 */
export function outcomePlan(a: {
  recommendation: AppraisalRecommendationValue | null;
  newDesignation: string | null;
  cycleName: string;
  effectiveDate: string;
}): OutcomeEventPlan | null {
  switch (a.recommendation) {
    case 'PROMOTE': {
      const to = a.newDesignation?.trim();
      if (!to) throw new Error('PROMOTE needs a new designation');
      return {
        type: 'PROMOTED',
        effectiveDate: a.effectiveDate,
        toValue: to,
        notes: `Appraisal ${a.cycleName} outcome`,
      };
    }
    case 'RAISE':
      return {
        type: 'NOTE',
        effectiveDate: a.effectiveDate,
        toValue: null,
        notes: `Salary increase recommended — appraisal ${a.cycleName}`,
      };
    case 'IMPROVEMENT_PLAN':
      return {
        type: 'NOTE',
        effectiveDate: a.effectiveDate,
        toValue: null,
        notes: `Improvement plan recommended — appraisal ${a.cycleName}`,
      };
    case 'NO_CHANGE':
    case null:
      return null;
  }
}
