import type {
  EmployeeStatusValue,
  EmploymentEventTypeValue,
  Kpis,
  OverallScore,
} from '../people/people.types';

/**
 * Response shapes for the appraisal endpoints under `/api/people`. The
 * frontend mirrors these by hand, so they are explicit: dates are
 * `YYYY-MM-DD` strings, timestamps are ISO-8601, ratings are whole numbers
 * 1-5, scores are 0-5 with one decimal, and `null` means "not known".
 */

export type AppraisalCycleStatusValue = 'DRAFT' | 'OPEN' | 'CLOSED';
/** Which paper form a cycle is: Half Yearly, Confirmation or Yearly. */
export type AppraisalTypeValue = 'HALF_YEARLY' | 'CONFIRMATION' | 'YEARLY';
/**
 * How a cycle's period is read. `CALENDAR`: the cycle's period is everyone's
 * review period (cycles created before 0032). `JOIN_DATE`: appraisals are
 * counted from each employee's join date; the cycle's period is the window
 * the due dates fall in, and each appraisal carries its own review period and
 * due date (`src/appraisals/appraisal-schedule.ts`).
 */
export type AppraisalPeriodBasisValue = 'CALENDAR' | 'JOIN_DATE';
/**
 * How a cycle scores. `FORM_100` is the company's paper form (10 criteria x 10
 * marks, graded A-F); the KPI score is shown beside it as a reference only.
 * `KPI_BLEND` is the original 0-5 blend of KPIs and 1-5 competency ratings,
 * kept for cycles created before the form existed.
 */
export type ScoringModeValue = 'KPI_BLEND' | 'FORM_100';
/**
 * KPI_BLEND: SELF_REVIEW -> LEAD_REVIEW -> CALIBRATION -> SIGNED_OFF.
 * FORM_100: SELF_REVIEW -> LEAD_REVIEW (supervisor) -> DEPT_HEAD_REVIEW ->
 * HR_REVIEW -> FINAL_APPROVAL (CTO/COO) -> SIGNED_OFF.
 */
export type AppraisalStatusValue =
  | 'SELF_REVIEW'
  | 'LEAD_REVIEW'
  | 'CALIBRATION'
  | 'DEPT_HEAD_REVIEW'
  | 'HR_REVIEW'
  | 'FINAL_APPROVAL'
  | 'SIGNED_OFF';
/** The form's "Recommendations by Supervisor / Department Head" (multi-select). */
export type AppraisalActionValue =
  | 'CONFIRM'
  | 'INCREMENT'
  | 'PROMOTION'
  | 'TERMINATION'
  | 'DISMISSAL'
  | 'TRAINING_TRANSFER';
/** The CTO/COO's decision at final approval. */
export type ApprovalDecisionValue = 'APPROVED' | 'NOT_APPROVED';
export type FormGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** One row of the form's evaluation-metrics table. */
export interface GradePolicy {
  grade: FormGrade;
  /** Inclusive band on the 100-mark total. */
  minMarks: number;
  maxMarks: number;
  promotion: boolean;
  /** Increment range in percent (0-0 for F). */
  incrementMin: number;
  incrementMax: number;
  training: boolean;
  transfer: boolean;
  termination: boolean;
  /** The form's terms line, e.g. "Proposed for service confirmation". */
  proposal: string;
}

/**
 * The form's header block, captured at launch, refreshed with the KPIs and on
 * every step, and frozen at sign-off (before any increment is applied, so it
 * shows the salary the appraisal was made against). Money is whole taka.
 */
export interface FormHeader {
  capturedAt: string;
  name: string;
  /** Company within the group. */
  concernName: string | null;
  designation: string;
  department: string | null;
  joinDate: string;
  academicQualification: string | null;
  /** The organisation's name, for "Experience in <company>". */
  companyName: string;
  /** Whole months from the join date to the capture date. */
  experienceInCompanyMonths: number;
  experienceBeforeJoiningMonths: number | null;
  /** Before joining + in company; null when the before-joining figure is unknown. */
  totalExperienceMonths: number | null;
  startingSalary: number | null;
  grossSalary: number | null;
  /** From the latest INCREMENT event that carries both amounts. */
  lastIncrementAmount: number | null;
  lastIncrementDate: string | null;
  /** From the latest PROMOTED event. */
  lastPromotionDate: string | null;
}
export type AppraisalRecommendationValue =
  | 'PROMOTE'
  | 'RAISE'
  | 'NO_CHANGE'
  | 'IMPROVEMENT_PLAN';

export interface Competency {
  /** Stable id that ratings are keyed on. `[a-z0-9_]`. */
  key: string;
  label: string;
  /** What the criterion measures (the paper form's wording). */
  description?: string;
}

/** `{ [competencyKey]: rating }`: 1-5 for KPI_BLEND, 2/4/6/8/10 for FORM_100. A missing key is unrated. */
export type RatingMap = Record<string, number>;

/** Appraisal count per status, plus the total. */
export interface CycleCounts {
  total: number;
  SELF_REVIEW: number;
  LEAD_REVIEW: number;
  CALIBRATION: number;
  DEPT_HEAD_REVIEW: number;
  HR_REVIEW: number;
  FINAL_APPROVAL: number;
  SIGNED_OFF: number;
}

export interface CycleView {
  id: string;
  name: string;
  /** CALENDAR: the review period. JOIN_DATE: the window the due dates fall in ("due between"). */
  periodStart: string;
  periodEnd: string;
  periodBasis: AppraisalPeriodBasisValue;
  status: AppraisalCycleStatusValue;
  type: AppraisalTypeValue;
  scoringMode: ScoringModeValue;
  /** 0-100: share of the final score that comes from the KPIs. KPI_BLEND only. */
  kpiWeight: number;
  competencies: Competency[];
  counts: CycleCounts;
  createdAt: string;
}

export interface LaunchResult {
  cycle: CycleView;
  /** Appraisals created by this call. */
  created: number;
  /** Selected employees who already had an appraisal in the cycle. */
  skipped: number;
  /**
   * JOIN_DATE cycles, explicit selection: employees left out because no
   * appraisal of the cycle's type is due by the end of its window (joined too
   * recently), or because they have exited. Always empty for calendar cycles.
   */
  notDue: LaunchNotDue[];
}

export interface LaunchNotDue {
  employeeId: string;
  employeeName: string;
  reason: 'NOT_YET_DUE' | 'EXITED';
  /** NOT_YET_DUE: when the first appraisal of the cycle's type falls due. */
  firstDueDate: string | null;
}

/**
 * The review period one appraisal covers. JOIN_DATE cycles: the employee's own
 * period and due date. Calendar cycles (and appraisals created before 0032):
 * the cycle's period, and no due date.
 */
export interface AppraisalPeriod {
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
}

/** `GET /people/appraisal-cycles/due`: one employee due an appraisal in the window. */
export interface DueEmployeeRow {
  employeeId: string;
  fullName: string;
  designation: string;
  teamName: string | null;
  status: EmployeeStatusValue;
  joinDate: string;
  type: AppraisalTypeValue;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
}

/** Stored when an appraisal enters lead review, and on refresh; frozen at sign-off. */
export interface KpiSnapshot {
  /** The period the KPIs were computed over (the appraisal's review period, clipped to today). */
  period: { from: string; to: string };
  computedAt: string;
  kpis: Kpis;
  overall: OverallScore;
}

export interface ScoreView {
  mode: ScoringModeValue;
  /** The scale `final` is on: 5 (KPI_BLEND) or 100 (FORM_100). */
  outOf: 5 | 100;
  /**
   * KPI_BLEND: 0-5, 1 dp, the calibrated score when set, else the computed one.
   * FORM_100: the 100-mark total, 1 dp. null when nothing to score yet.
   */
  final: number | null;
  /** The weighted score before any calibration. */
  computed: number | null;
  /** KPI overall score / 20, 2 dp. null when the KPIs have no data or were not computed yet. */
  kpiPart: number | null;
  /** Mean of the lead ratings, 2 dp. null when no competency has been rated. */
  competencyPart: number | null;
  /** The KPI score is partial (employee not linked to ClickUp) or missing: label it "Partial". */
  partial: boolean;
  /** `final` is the calibrated score. */
  calibrated: boolean;
  /** Which parts contributed to `computed`. */
  basedOn: ('kpi' | 'competencies')[];
  kpiWeight: number;
  /** FORM_100: the grade once every criterion is rated (the frozen grade after sign-off). Else null. */
  grade: FormGrade | null;
  /** FORM_100: the evaluation-metrics row for `grade`. */
  policy: GradePolicy | null;
  /** FORM_100: the KPI overall score (0-100) shown beside the form as a reference, never blended in. */
  kpiReference: number | null;
  kpiReferencePartial: boolean;
  /** Criteria the supervisor has rated, of `criteriaCount`. */
  ratedCount: number;
  criteriaCount: number;
}

export interface AppraisalListRow {
  id: string;
  cycleId: string;
  employeeId: string;
  employeeName: string;
  designation: string;
  teamName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  status: AppraisalStatusValue;
  scoringMode: ScoringModeValue;
  /** This appraisal's own review period (the cycle's for calendar cycles). */
  periodStart: string;
  periodEnd: string;
  /** JOIN_DATE cycles: when it fell due. Null for calendar cycles. */
  dueDate: string | null;
  score: ScoreView;
  recommendation: AppraisalRecommendationValue | null;
  actions: AppraisalActionValue[];
  approvalDecision: ApprovalDecisionValue | null;
  signedOffAt: string | null;
  updatedAt: string;
}

/** One row of an employee's appraisal history (also the sidebar on the form). */
export interface EmployeeAppraisalRow {
  id: string;
  cycleId: string;
  cycleName: string;
  /** This appraisal's own review period (the cycle's for calendar cycles). */
  periodStart: string;
  periodEnd: string;
  /** JOIN_DATE cycles: when it fell due. Null for calendar cycles. */
  dueDate: string | null;
  status: AppraisalStatusValue;
  scoringMode: ScoringModeValue;
  appraisalType: AppraisalTypeValue;
  score: ScoreView;
  recommendation: AppraisalRecommendationValue | null;
  actions: AppraisalActionValue[];
  approvalDecision: ApprovalDecisionValue | null;
  newDesignation: string | null;
  signedOffAt: string | null;
}

/** The fields a step lets the caller edit; anything else on PATCH is refused. */
export type AppraisalEditableField =
  | 'selfRatings'
  | 'selfComment'
  | 'leadRatings'
  | 'leadComment'
  | 'strengths'
  | 'improvements'
  | 'goals'
  | 'recommendation'
  | 'newDesignation'
  | 'calibrationNote'
  | 'calibratedScore'
  | 'actions'
  | 'incrementPercent'
  | 'trainingPlan'
  | 'deptHeadComment'
  | 'hrComment'
  | 'approvalDecision'
  | 'approvalComment';

/** Who completed a step and when (recorded as the appraisal leaves it). */
export interface StepRecord {
  status: AppraisalStatusValue;
  byUserId: string | null;
  byName: string | null;
  at: string | null;
}

export interface AppraisalView {
  id: string;
  cycle: CycleView;
  employee: {
    id: string;
    fullName: string;
    designation: string;
    teamName: string | null;
    employeeCode: string | null;
    /** Not linked to ClickUp, so the ClickUp KPIs are missing and the score is Partial. */
    clickupLinked: boolean;
  };
  reviewerId: string | null;
  reviewerName: string | null;
  /** This appraisal's own review period (the cycle's for calendar cycles). */
  periodStart: string;
  periodEnd: string;
  /** JOIN_DATE cycles: when it fell due. Null for calendar cycles. */
  dueDate: string | null;
  status: AppraisalStatusValue;
  selfRatings: RatingMap;
  selfComment: string | null;
  leadRatings: RatingMap;
  leadComment: string | null;
  strengths: string | null;
  improvements: string | null;
  goals: string | null;
  recommendation: AppraisalRecommendationValue | null;
  newDesignation: string | null;
  calibrationNote: string | null;
  calibratedScore: number | null;
  /** FORM_100 fields. */
  actions: AppraisalActionValue[];
  incrementPercent: number | null;
  trainingPlan: string | null;
  deptHeadComment: string | null;
  hrComment: string | null;
  approvalDecision: ApprovalDecisionValue | null;
  approvalComment: string | null;
  formHeader: FormHeader | null;
  /** The step sequence for this cycle's scoring mode, each with who/when once completed. */
  steps: StepRecord[];
  /** The stored PDF of the signed-off form (an APPRAISAL employee document), once filed. */
  formDocumentId: string | null;
  kpiSnapshot: KpiSnapshot | null;
  score: ScoreView;
  /** Fields the current step accepts. Empty once signed off. */
  editableFields: AppraisalEditableField[];
  /** What stops "Advance" right now (empty when it would succeed). */
  advanceBlockers: string[];
  canSendBack: boolean;
  signedOffAt: string | null;
  /** The recommendation's employment event has been written. */
  outcomeApplied: boolean;
  /** The employee's other appraisals, newest first. */
  previous: EmployeeAppraisalRow[];
  createdAt: string;
  updatedAt: string;
}

/** What sign-off writes to the employment timeline for a recommendation. */
export interface OutcomeEventPlan {
  type: Extract<
    EmploymentEventTypeValue,
    'PROMOTED' | 'NOTE' | 'CONFIRMED' | 'INCREMENT'
  >;
  effectiveDate: string;
  /** INCREMENT: the old gross salary. Otherwise left to the event's default. */
  fromValue?: string | null;
  toValue: string | null;
  notes: string;
}
