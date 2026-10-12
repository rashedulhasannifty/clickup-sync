import type { EmployeeStatusValue } from '../people/people.types';
import type {
  AppraisalActionValue,
  AppraisalCycleStatusValue,
  AppraisalEditableField,
  AppraisalRecommendationValue,
  AppraisalStatusValue,
  ApprovalDecisionValue,
  Competency,
  FormGrade,
  GradePolicy,
  OutcomeEventPlan,
  RatingMap,
  ScoringModeValue,
} from './appraisals.types';

/**
 * Pure appraisal rules: scoring, the status machine, which fields each step
 * accepts, and what sign-off writes to the employment timeline. No I/O and no
 * clock, so every branch is unit-testable. Dates are `YYYY-MM-DD`.
 *
 * Two scoring modes live here. FORM_100 is the company's paper form
 * ("Performance Appraisal Form – Asst. Managers and above"): 10 criteria rated
 * 2/4/6/8/10, a 100-mark total and an A-F grade, which is the official result;
 * the KPI score is a separate reference number, never blended in. KPI_BLEND is
 * the original 0-5 blend, kept intact for cycles created before the form.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const SCORE_MAX = 5;
export const DEFAULT_KPI_WEIGHT = 70;

/** New cycles score on the paper form unless told otherwise. */
export const DEFAULT_SCORING_MODE: ScoringModeValue = 'FORM_100';

/** FORM_100 rating scale, as printed on the form. */
export const FORM_RATINGS: readonly { value: number; label: string }[] = [
  { value: 10, label: 'Outstanding' },
  { value: 8, label: 'Good' },
  { value: 6, label: 'Fair' },
  { value: 4, label: 'Average' },
  { value: 2, label: 'Below Average' },
];
const FORM_RATING_VALUES: ReadonlySet<number> = new Set(
  FORM_RATINGS.map((r) => r.value),
);
export const FORM_RATING_MAX = 10;
export const FORM_TOTAL_MAX = 100;

/**
 * The 10 criteria of "Performance Appraisal Form – Asst. Managers and above",
 * descriptions verbatim from the paper form. New FORM_100 cycles start with
 * these (editable until launch).
 */
export const FORM_CRITERIA: readonly Competency[] = [
  {
    key: 'job_knowledge',
    label: 'Job Knowledge',
    description:
      "Possess adequate knowledge for performing the job effectively & efficiently. It measures one's mastery of the concepts needed to perform certain work. Job knowledge is a complex concept that includes elements of both ability (capacity to learn) and seniority (opportunity to learn).",
  },
  {
    key: 'customer_orientation',
    label: 'Customer Orientation',
    description:
      'Is focused on identifying and meeting customer needs. Acts to establish a successful long-term business partnership with internal and external customers.',
  },
  {
    key: 'decision_making',
    label: 'Decision Making',
    description:
      'Makes timely and appropriate choices based on accurate analysis and experience. Uses sound judgment even in conditions of uncertainty. Anticipates the impact of decisions and plans on how to manage risk.',
  },
  {
    key: 'planning_organizing',
    label: 'Planning and Organizing',
    description:
      'Set clear and realistic goals and objectives. Establishes a course of action and a sequence of steps to ensure that objectives are efficiently achieved. Structured with good personal organization. Schedules time effectively and use efficient work methods and tools.',
  },
  {
    key: 'building_leading_teams',
    label: 'Building and Leading Teams',
    description:
      'Knows the needs (strengths & weaknesses) of the team member. Encourages effective cooperation among team members and between teams. Inspires team spirit and the commitment to achieve high standards of performance.',
  },
  {
    key: 'developing_people',
    label: 'Developing People',
    description:
      "Facilitates the development of others through personal involvement in coaching & mentoring. Creates an environment that fosters learning, growth and development to improve an individual's capability to achieve the business object.",
  },
  {
    key: 'communication',
    label: 'Communication',
    description:
      'Provides both verbal and written information in a timely, clear and concise manner. Expresses ideas effectively, adjusting style, tools and mode to the needs of others. Listens attentively, and summarizes or asks questions to clarify information when needed.',
  },
  {
    key: 'influencing',
    label: 'Influencing',
    description:
      "Persuades others with the value of an approach or idea. Gains spontaneous commitment and support of others in achieving the company's strategic goals.",
  },
  {
    key: 'commitment_to_excel',
    label: 'Commitment to Excel',
    description:
      'Challenges self and others to exceed standards and achieve extraordinary results, striving for the best in a similar group.',
  },
  {
    key: 'integrity',
    label: 'Integrity',
    description:
      'Strict adherence to moral code, reflected in transparent honesty and complete harmony in what one thinks, says, and does. Displays extremely high standards of ethical conduct and can coach and counsel others on the impact of violating these.',
  },
];

/**
 * The form's evaluation-metrics table, highest band first. Bands are inclusive
 * on whole marks. A fractional total (only possible when a cycle has other than
 * 10 criteria) must reach a band's printed minimum, so 90.5 is a B and 50.5 an F.
 */
export const GRADE_TABLE: readonly GradePolicy[] = [
  {
    grade: 'A',
    minMarks: 91,
    maxMarks: 100,
    promotion: true,
    incrementMin: 15,
    incrementMax: 15,
    training: false,
    transfer: false,
    termination: false,
    proposal:
      'Proposed for promotion (eligible if the next position is vacant)',
  },
  {
    grade: 'B',
    minMarks: 81,
    maxMarks: 90,
    promotion: false,
    incrementMin: 13,
    incrementMax: 14,
    training: false,
    transfer: false,
    termination: false,
    proposal: 'Proposed for service confirmation',
  },
  {
    grade: 'C',
    minMarks: 71,
    maxMarks: 80,
    promotion: false,
    incrementMin: 11,
    incrementMax: 12,
    training: false,
    transfer: false,
    termination: false,
    proposal: 'Proposed for service confirmation',
  },
  {
    grade: 'D',
    minMarks: 61,
    maxMarks: 70,
    promotion: false,
    incrementMin: 9,
    incrementMax: 10,
    training: true,
    transfer: false,
    termination: false,
    proposal: 'Proposed for service confirmation',
  },
  {
    grade: 'E',
    minMarks: 51,
    maxMarks: 60,
    promotion: false,
    incrementMin: 7,
    incrementMax: 8,
    training: true,
    transfer: true,
    termination: false,
    proposal:
      'Proposed for increment with a training plan (extension of probation)',
  },
  {
    grade: 'F',
    minMarks: 0,
    maxMarks: 50,
    promotion: false,
    incrementMin: 0,
    incrementMax: 0,
    training: false,
    transfer: true,
    termination: true,
    proposal:
      'Proposed for possible transfer with a development plan, or separation',
  },
];

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

/** KPI_BLEND (legacy) step sequence. */
export const APPRAISAL_STEPS: readonly AppraisalStatusValue[] = [
  'SELF_REVIEW',
  'LEAD_REVIEW',
  'CALIBRATION',
  'SIGNED_OFF',
];

/** FORM_100 step sequence: the paper form's signatures, in order. */
export const FORM_STEPS: readonly AppraisalStatusValue[] = [
  'SELF_REVIEW',
  'LEAD_REVIEW',
  'DEPT_HEAD_REVIEW',
  'HR_REVIEW',
  'FINAL_APPROVAL',
  'SIGNED_OFF',
];

/** The step sequence is a function of the cycle's scoring mode. */
export function stepsFor(
  mode: ScoringModeValue,
): readonly AppraisalStatusValue[] {
  return mode === 'FORM_100' ? FORM_STEPS : APPRAISAL_STEPS;
}

/** Forward one step at a time. Nothing follows SIGNED_OFF (or a status outside the mode). */
export function nextStatus(
  s: AppraisalStatusValue,
  mode: ScoringModeValue = 'KPI_BLEND',
): AppraisalStatusValue | null {
  const steps = stepsFor(mode);
  const i = steps.indexOf(s);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : null;
}

/** Send back one step for corrections. Not from the first step, and never after sign-off. */
export function previousStatus(
  s: AppraisalStatusValue,
  mode: ScoringModeValue = 'KPI_BLEND',
): AppraisalStatusValue | null {
  if (s === 'SIGNED_OFF') return null;
  const steps = stepsFor(mode);
  const i = steps.indexOf(s);
  return i > 0 ? steps[i - 1] : null;
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
  DEPT_HEAD_REVIEW: [],
  HR_REVIEW: [],
  FINAL_APPROVAL: [],
  SIGNED_OFF: [],
};

/** FORM_100: each comment block is editable only in its own step. */
const FORM_EDITABLE: Record<AppraisalStatusValue, AppraisalEditableField[]> = {
  SELF_REVIEW: ['selfRatings', 'selfComment'],
  // The supervisor.
  LEAD_REVIEW: [
    'leadRatings',
    'leadComment',
    'actions',
    'incrementPercent',
    'newDesignation',
    'trainingPlan',
  ],
  // The department head may adjust the recommendations.
  DEPT_HEAD_REVIEW: [
    'deptHeadComment',
    'actions',
    'incrementPercent',
    'newDesignation',
    'trainingPlan',
  ],
  HR_REVIEW: ['hrComment'],
  // The CTO/COO.
  FINAL_APPROVAL: ['approvalDecision', 'approvalComment'],
  CALIBRATION: [],
  SIGNED_OFF: [],
};

/** The fields a step accepts. Signed-off appraisals are read-only. */
export function editableFields(
  s: AppraisalStatusValue,
  mode: ScoringModeValue = 'KPI_BLEND',
): AppraisalEditableField[] {
  return [...(mode === 'FORM_100' ? FORM_EDITABLE : EDITABLE)[s]];
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

/** 1-5 for KPI_BLEND; exactly 2, 4, 6, 8 or 10 for FORM_100. */
export const isValidRating = (
  v: unknown,
  mode: ScoringModeValue = 'KPI_BLEND',
): v is number => {
  if (typeof v !== 'number' || !Number.isInteger(v)) return false;
  return mode === 'FORM_100'
    ? FORM_RATING_VALUES.has(v)
    : v >= RATING_MIN && v <= RATING_MAX;
};

const ratingRule = (mode: ScoringModeValue): string =>
  mode === 'FORM_100'
    ? 'one of 2, 4, 6, 8 or 10'
    : `a whole number ${RATING_MIN}-${RATING_MAX}`;

/**
 * A ratings map from untrusted input: only known competency keys, values on
 * the mode's scale. Returns an error message rather than throwing.
 */
export function parseRatings(
  input: unknown,
  keys: readonly string[],
  mode: ScoringModeValue = 'KPI_BLEND',
): { ok: true; value: RatingMap } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      error: `ratings must be an object of key: ${ratingRule(mode)}`,
    };
  }
  const known = new Set(keys);
  const value: RatingMap = {};
  for (const [k, v] of Object.entries(input)) {
    if (!known.has(k)) return { ok: false, error: `Unknown competency "${k}"` };
    if (!isValidRating(v, mode)) {
      return {
        ok: false,
        error: `Rating for "${k}" must be ${ratingRule(mode)}`,
      };
    }
    value[k] = v;
  }
  return { ok: true, value };
}

/** Stored ratings, defensively: keep only known keys with values valid for the mode. */
export function cleanRatings(
  stored: unknown,
  keys: readonly string[],
  mode: ScoringModeValue = 'KPI_BLEND',
): RatingMap {
  const out: RatingMap = {};
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored))
    return out;
  const known = new Set(keys);
  for (const [k, v] of Object.entries(stored)) {
    if (known.has(k) && isValidRating(v, mode)) out[k] = v;
  }
  return out;
}

const COMPETENCY_KEY = /^[a-z0-9_]{1,40}$/;
export const COMPETENCY_DESCRIPTION_MAX = 1000;

export function validateCompetencies(
  list: readonly Competency[],
): string | null {
  if (list.length === 0) return 'A cycle needs at least one competency';
  const seen = new Set<string>();
  for (const c of list) {
    if (!COMPETENCY_KEY.test(c.key))
      return `Competency key "${c.key}" must be 1-40 characters of a-z, 0-9 or _`;
    if (!c.label.trim()) return `Competency "${c.key}" needs a label`;
    if (
      c.description !== undefined &&
      c.description.length > COMPETENCY_DESCRIPTION_MAX
    )
      return `Competency "${c.key}" has a description over ${COMPETENCY_DESCRIPTION_MAX} characters`;
    if (seen.has(c.key)) return `Duplicate competency key "${c.key}"`;
    seen.add(c.key);
  }
  return null;
}

// --- KPI_BLEND scoring ----------------------------------------------------

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

// --- FORM_100 scoring ------------------------------------------------------

export interface FormScore {
  /** The supervisor's ratings normalised to 100 (`sum / (10 x n) x 100`), 1 dp. null when nothing is rated. */
  total: number | null;
  ratedCount: number;
  criteriaCount: number;
  /** Only once every criterion is rated: a half-rated form has no grade. */
  grade: FormGrade | null;
}

/**
 * The form's total. With the standard 10 criteria it is simply the sum of the
 * ten ratings. With n criteria it is normalised: `sum / (10 x n) x 100`. An
 * unrated criterion counts as 0 towards the live total, and there is no grade
 * until all are rated.
 */
export function formScore(
  leadRatings: RatingMap,
  criteriaKeys: readonly string[],
): FormScore {
  const rated = criteriaKeys.flatMap((k) => {
    const v = leadRatings[k];
    return isValidRating(v, 'FORM_100') ? [v] : [];
  });
  const n = criteriaKeys.length;
  const total =
    rated.length === 0 || n === 0
      ? null
      : round(
          (rated.reduce((a, b) => a + b, 0) / (FORM_RATING_MAX * n)) *
            FORM_TOTAL_MAX,
          1,
        );
  return {
    total,
    ratedCount: rated.length,
    criteriaCount: n,
    grade: total !== null && rated.length === n ? gradeFor(total) : null,
  };
}

/** The grade for a 100-mark total. Lower bounds are the form's printed minimums. */
export function gradeFor(total: number): FormGrade {
  for (const row of GRADE_TABLE) if (total >= row.minMarks) return row.grade;
  return 'F';
}

export function gradePolicy(grade: FormGrade): GradePolicy {
  return GRADE_TABLE.find((r) => r.grade === grade) as GradePolicy;
}

/** "increment 13–14%, service confirmation": the short policy line shown beside the grade. */
export function policyLine(p: GradePolicy): string {
  const parts: string[] = [];
  if (p.promotion) parts.push('promotion');
  parts.push(
    p.incrementMax === 0
      ? 'no increment'
      : p.incrementMin === p.incrementMax
        ? `increment ${p.incrementMin}%`
        : `increment ${p.incrementMin}–${p.incrementMax}%`,
  );
  if (p.grade === 'B' || p.grade === 'C' || p.grade === 'D')
    parts.push('service confirmation');
  if (p.training) parts.push('training');
  if (p.transfer) parts.push('transfer');
  if (p.termination) parts.push('termination');
  return parts.join(', ');
}

/** The increment the UI prefills for a grade: the bottom of its range. */
export function defaultIncrementPercent(grade: FormGrade): number {
  return gradePolicy(grade).incrementMin;
}

export const isValidIncrementPercent = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

const SEPARATION: ReadonlySet<AppraisalActionValue> = new Set([
  'TERMINATION',
  'DISMISSAL',
]);
const RETENTION: ReadonlySet<AppraisalActionValue> = new Set([
  'CONFIRM',
  'INCREMENT',
  'PROMOTION',
]);

/** Termination or dismissal recommended: the UI offers "Start offboarding" (never automatic). */
export const recommendsSeparation = (
  actions: readonly AppraisalActionValue[],
): boolean => actions.some((a) => SEPARATION.has(a));

/** What is wrong with a set of recommendations (empty when they are consistent). */
export function actionBlockers(a: {
  actions: readonly AppraisalActionValue[];
  newDesignation: string | null;
  incrementPercent: number | null;
}): string[] {
  const out: string[] = [];
  if (a.actions.length === 0) out.push('Tick at least one recommendation');
  if (a.actions.includes('PROMOTION') && !a.newDesignation?.trim())
    out.push('Name the new designation for a promotion');
  if (
    a.actions.includes('INCREMENT') &&
    !isValidIncrementPercent(a.incrementPercent)
  )
    out.push('Set the increment percentage');
  if (
    a.actions.some((x) => SEPARATION.has(x)) &&
    a.actions.some((x) => RETENTION.has(x))
  )
    out.push(
      'Termination or dismissal cannot be combined with confirmation, increment or promotion',
    );
  return out;
}

// --- Advancing and sign-off ----------------------------------------------

export interface AdvanceInput {
  /** Defaults to KPI_BLEND (the legacy rules). */
  mode?: ScoringModeValue;
  status: AppraisalStatusValue;
  leadRatings: RatingMap;
  competencyKeys: readonly string[];
  recommendation: AppraisalRecommendationValue | null;
  newDesignation: string | null;
  /** FORM_100 only. */
  actions?: readonly AppraisalActionValue[];
  incrementPercent?: number | null;
  approvalDecision?: ApprovalDecisionValue | null;
  /** FORM_100: an approved increment needs a present gross salary to apply to. */
  grossSalaryKnown?: boolean;
}

/**
 * What stops the next step. Leaving the self review is always allowed (an
 * admin may be filling it in on the employee's behalf, or skipping it).
 * KPI_BLEND: the lead review must be complete before calibration and again at
 * sign-off. FORM_100: the supervisor's ratings and recommendations must be
 * complete and consistent to leave the supervisor and department-head steps
 * (and again at final approval), and final approval needs a decision. The HR
 * review only adds a comment, so it never blocks.
 */
export function advanceBlockers(a: AdvanceInput): string[] {
  if (a.status === 'SIGNED_OFF')
    return ['This appraisal is already signed off'];
  if (a.status === 'SELF_REVIEW') return [];
  const mode = a.mode ?? 'KPI_BLEND';
  const out: string[] = [];
  const unrated = a.competencyKeys.filter(
    (k) => !isValidRating(a.leadRatings[k], mode),
  );

  if (mode === 'KPI_BLEND') {
    if (unrated.length > 0)
      out.push(`Rate every competency (${unrated.length} left)`);
    if (!a.recommendation) out.push('Choose a recommendation');
    if (a.recommendation === 'PROMOTE' && !a.newDesignation?.trim())
      out.push('Name the new designation for a promotion');
    return out;
  }

  if (a.status === 'HR_REVIEW') return out;
  if (unrated.length > 0)
    out.push(`Rate every criterion (${unrated.length} left)`);
  const actions = a.actions ?? [];
  out.push(
    ...actionBlockers({
      actions,
      newDesignation: a.newDesignation,
      incrementPercent: a.incrementPercent ?? null,
    }),
  );
  if (a.status === 'FINAL_APPROVAL') {
    if (!a.approvalDecision) out.push('Record the approval decision');
    if (
      a.approvalDecision === 'APPROVED' &&
      actions.includes('INCREMENT') &&
      !a.grossSalaryKnown
    )
      out.push(
        'Set the employee’s present gross salary on their profile before approving an increment',
      );
  }
  return out;
}

export type SignOffAction =
  /** Flip to SIGNED_OFF, freeze the score, then apply the outcome. */
  | 'sign-off'
  /** Signed off but the outcome never landed (a crash between the two writes): finish it. */
  | 'apply-outcome'
  /** Signed off and applied: nothing to do. */
  | 'noop';

/** Signing off twice applies the outcome once. Only meaningful from the last step before sign-off, or SIGNED_OFF. */
export function signOffAction(a: {
  status: AppraisalStatusValue;
  outcomeAppliedAt: Date | null;
}): SignOffAction {
  if (a.status !== 'SIGNED_OFF') return 'sign-off';
  return a.outcomeAppliedAt ? 'noop' : 'apply-outcome';
}

/**
 * KPI_BLEND: the employment event a recommendation writes, or null for
 * NO_CHANGE. PROMOTE goes through `EmployeesService` as PROMOTED, which also
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

/** "13%", "13.5%": an increment percentage as the INCREMENT event's notes. */
export const percentText = (p: number): string => `${round(p, 2)}%`;

/** New gross salary after an increment, whole taka. */
export const incrementedSalary = (gross: number, pct: number): number =>
  Math.round(gross * (1 + pct / 100));

export interface FormOutcome {
  /** Written in one transaction, in this order. */
  events: OutcomeEventPlan[];
  /** Ticked actions that write nothing, and why (shown on the form, never silently dropped). */
  notApplied: { action: AppraisalActionValue; reason: string }[];
}

const EVENT_ORDER: Record<OutcomeEventPlan['type'], number> = {
  CONFIRMED: 0,
  PROMOTED: 1,
  INCREMENT: 2,
  NOTE: 3,
};

/**
 * FORM_100 sign-off. Nothing is written unless the CTO/COO APPROVED. Then:
 * CONFIRM -> CONFIRMED, only while the employee is on PROBATION (the CONFIRMED
 * event forces ACTIVE and moves the confirmation date, which would cancel a
 * notice period or rewrite an earlier confirmation); PROMOTION -> PROMOTED;
 * INCREMENT -> INCREMENT from the old to the new gross salary. TERMINATION and
 * DISMISSAL are never automatic (the UI offers "Start offboarding"), and
 * TRAINING_TRANSFER is recorded on the form only.
 */
export function formOutcomePlan(a: {
  decision: ApprovalDecisionValue | null;
  actions: readonly AppraisalActionValue[];
  newDesignation: string | null;
  incrementPercent: number | null;
  grossSalary: number | null;
  employeeStatus: EmployeeStatusValue;
  cycleName: string;
  effectiveDate: string;
}): FormOutcome {
  const out: FormOutcome = { events: [], notApplied: [] };
  if (a.decision !== 'APPROVED') return out;
  const notes = `Appraisal ${a.cycleName} outcome`;
  for (const action of a.actions) {
    switch (action) {
      case 'CONFIRM':
        if (a.employeeStatus === 'PROBATION')
          out.events.push({
            type: 'CONFIRMED',
            effectiveDate: a.effectiveDate,
            toValue: null,
            notes,
          });
        else
          out.notApplied.push({
            action,
            reason: `Not confirmed again: the employee is ${a.employeeStatus.toLowerCase()}, not on probation`,
          });
        break;
      case 'PROMOTION': {
        const to = a.newDesignation?.trim();
        if (!to) throw new Error('PROMOTION needs a new designation');
        out.events.push({
          type: 'PROMOTED',
          effectiveDate: a.effectiveDate,
          toValue: to,
          notes,
        });
        break;
      }
      case 'INCREMENT': {
        if (!isValidIncrementPercent(a.incrementPercent))
          throw new Error('INCREMENT needs a percentage');
        if (a.grossSalary === null)
          throw new Error('INCREMENT needs a present gross salary');
        out.events.push({
          type: 'INCREMENT',
          effectiveDate: a.effectiveDate,
          fromValue: String(a.grossSalary),
          toValue: String(incrementedSalary(a.grossSalary, a.incrementPercent)),
          notes: percentText(a.incrementPercent),
        });
        break;
      }
      case 'TERMINATION':
      case 'DISMISSAL':
        out.notApplied.push({
          action,
          reason:
            'Separation is never automatic: start offboarding from the employee page',
        });
        break;
      case 'TRAINING_TRANSFER':
        break;
    }
  }
  // A fixed order however the boxes were ticked: confirm, promote, then pay.
  out.events.sort((x, y) => EVENT_ORDER[x.type] - EVENT_ORDER[y.type]);
  return out;
}
