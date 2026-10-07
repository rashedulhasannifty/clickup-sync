import type {
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
export type AppraisalStatusValue =
  | 'SELF_REVIEW'
  | 'LEAD_REVIEW'
  | 'CALIBRATION'
  | 'SIGNED_OFF';
export type AppraisalRecommendationValue =
  | 'PROMOTE'
  | 'RAISE'
  | 'NO_CHANGE'
  | 'IMPROVEMENT_PLAN';

export interface Competency {
  /** Stable id that ratings are keyed on. `[a-z0-9_]`. */
  key: string;
  label: string;
}

/** `{ [competencyKey]: 1-5 }`. A missing key is unrated. */
export type RatingMap = Record<string, number>;

/** Appraisal count per status, plus the total. */
export interface CycleCounts {
  total: number;
  SELF_REVIEW: number;
  LEAD_REVIEW: number;
  CALIBRATION: number;
  SIGNED_OFF: number;
}

export interface CycleView {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: AppraisalCycleStatusValue;
  /** 0-100: share of the final score that comes from the KPIs. */
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
}

/** Stored when an appraisal enters lead review, and on refresh; frozen at sign-off. */
export interface KpiSnapshot {
  /** The period the KPIs were computed over (the cycle period, clipped to today). */
  period: { from: string; to: string };
  computedAt: string;
  kpis: Kpis;
  overall: OverallScore;
}

export interface ScoreView {
  /** 0-5, 1 dp. The calibrated score when set, else the computed one. null when nothing to score yet. */
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
  score: ScoreView;
  recommendation: AppraisalRecommendationValue | null;
  signedOffAt: string | null;
  updatedAt: string;
}

/** One row of an employee's appraisal history (also the sidebar on the form). */
export interface EmployeeAppraisalRow {
  id: string;
  cycleId: string;
  cycleName: string;
  periodStart: string;
  periodEnd: string;
  status: AppraisalStatusValue;
  score: ScoreView;
  recommendation: AppraisalRecommendationValue | null;
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
  | 'calibratedScore';

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
  type: Extract<EmploymentEventTypeValue, 'PROMOTED' | 'NOTE'>;
  effectiveDate: string;
  toValue: string | null;
  notes: string;
}
