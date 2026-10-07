import { apiClient } from './client';
import type { Kpis, OverallScore } from './people';

/**
 * Mirrors `src/appraisals/appraisals.types.ts` and the request DTOs in
 * `src/appraisals/dto/*` by hand. Dates are `YYYY-MM-DD`, timestamps ISO-8601,
 * ratings whole numbers 1-5, scores 0-5 with one decimal. Row shapes are
 * `type` aliases so they satisfy DataTable's index-signature constraint.
 */

export type CycleStatus = 'DRAFT' | 'OPEN' | 'CLOSED';
export type AppraisalStatus = 'SELF_REVIEW' | 'LEAD_REVIEW' | 'CALIBRATION' | 'SIGNED_OFF';
export type Recommendation = 'PROMOTE' | 'RAISE' | 'NO_CHANGE' | 'IMPROVEMENT_PLAN';

export type Competency = { key: string; label: string };
export type RatingMap = Record<string, number>;

export type CycleCounts = {
  total: number;
  SELF_REVIEW: number;
  LEAD_REVIEW: number;
  CALIBRATION: number;
  SIGNED_OFF: number;
};

export type CycleView = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: CycleStatus;
  /** 0-100: share of the final score that comes from the KPIs. */
  kpiWeight: number;
  competencies: Competency[];
  counts: CycleCounts;
  createdAt: string;
};

export type LaunchResult = { cycle: CycleView; created: number; skipped: number };

export type KpiSnapshot = {
  period: { from: string; to: string };
  computedAt: string;
  kpis: Kpis;
  overall: OverallScore;
};

export type ScoreView = {
  /** 0-5, 1 dp; the calibrated score when set. null when there is nothing to score yet. */
  final: number | null;
  computed: number | null;
  kpiPart: number | null;
  competencyPart: number | null;
  /** KPI score missing or partial (not linked to ClickUp): label it "Partial". */
  partial: boolean;
  calibrated: boolean;
  basedOn: ('kpi' | 'competencies')[];
  kpiWeight: number;
};

export type AppraisalListRow = {
  id: string;
  cycleId: string;
  employeeId: string;
  employeeName: string;
  designation: string;
  teamName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  status: AppraisalStatus;
  score: ScoreView;
  recommendation: Recommendation | null;
  signedOffAt: string | null;
  updatedAt: string;
};

export type EmployeeAppraisalRow = {
  id: string;
  cycleId: string;
  cycleName: string;
  periodStart: string;
  periodEnd: string;
  status: AppraisalStatus;
  score: ScoreView;
  recommendation: Recommendation | null;
  newDesignation: string | null;
  signedOffAt: string | null;
};

export type EditableField =
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

export type AppraisalView = {
  id: string;
  cycle: CycleView;
  employee: {
    id: string;
    fullName: string;
    designation: string;
    teamName: string | null;
    employeeCode: string | null;
    clickupLinked: boolean;
  };
  reviewerId: string | null;
  reviewerName: string | null;
  status: AppraisalStatus;
  selfRatings: RatingMap;
  selfComment: string | null;
  leadRatings: RatingMap;
  leadComment: string | null;
  strengths: string | null;
  improvements: string | null;
  goals: string | null;
  recommendation: Recommendation | null;
  newDesignation: string | null;
  calibrationNote: string | null;
  calibratedScore: number | null;
  kpiSnapshot: KpiSnapshot | null;
  score: ScoreView;
  /** Fields the current step accepts; empty once signed off or when the cycle is not open. */
  editableFields: EditableField[];
  /** What stops "Advance" right now. */
  advanceBlockers: string[];
  canSendBack: boolean;
  signedOffAt: string | null;
  /** The recommendation's employment event has been written. */
  outcomeApplied: boolean;
  previous: EmployeeAppraisalRow[];
  createdAt: string;
  updatedAt: string;
};

export type CreateCycleBody = {
  name: string;
  periodStart: string;
  periodEnd: string;
  kpiWeight?: number;
  competencies?: Competency[];
};

export type UpdateCycleBody = Partial<CreateCycleBody> & { status?: CycleStatus };

/** Only send the fields you are changing; `null` clears a nullable field. */
export type UpdateAppraisalBody = {
  selfRatings?: RatingMap;
  selfComment?: string | null;
  leadRatings?: RatingMap;
  leadComment?: string | null;
  strengths?: string | null;
  improvements?: string | null;
  goals?: string | null;
  recommendation?: Recommendation | null;
  newDesignation?: string | null;
  calibrationNote?: string | null;
  calibratedScore?: number | null;
};

export const appraisalsApi = {
  cycles: () => apiClient.get<CycleView[]>('/people/appraisal-cycles').then((r) => r.data),
  cycle: (id: string) => apiClient.get<CycleView>(`/people/appraisal-cycles/${id}`).then((r) => r.data),
  createCycle: (body: CreateCycleBody) =>
    apiClient.post<CycleView>('/people/appraisal-cycles', body).then((r) => r.data),
  updateCycle: (id: string, body: UpdateCycleBody) =>
    apiClient.patch<CycleView>(`/people/appraisal-cycles/${id}`, body).then((r) => r.data),
  launch: (id: string, employeeIds?: string[]) =>
    apiClient
      .post<LaunchResult>(`/people/appraisal-cycles/${id}/launch`, employeeIds ? { employeeIds } : {})
      .then((r) => r.data),
  cycleAppraisals: (id: string) =>
    apiClient.get<AppraisalListRow[]>(`/people/appraisal-cycles/${id}/appraisals`).then((r) => r.data),

  appraisal: (id: string) => apiClient.get<AppraisalView>(`/people/appraisals/${id}`).then((r) => r.data),
  update: (id: string, body: UpdateAppraisalBody) =>
    apiClient.patch<AppraisalView>(`/people/appraisals/${id}`, body).then((r) => r.data),
  advance: (id: string) => apiClient.post<AppraisalView>(`/people/appraisals/${id}/advance`).then((r) => r.data),
  sendBack: (id: string) => apiClient.post<AppraisalView>(`/people/appraisals/${id}/send-back`).then((r) => r.data),
  refreshKpis: (id: string) =>
    apiClient.post<AppraisalView>(`/people/appraisals/${id}/refresh-kpis`).then((r) => r.data),
  forEmployee: (employeeId: string) =>
    apiClient.get<EmployeeAppraisalRow[]>(`/people/employees/${employeeId}/appraisals`).then((r) => r.data),
};
