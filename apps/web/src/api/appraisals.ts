import { apiClient } from './client';
import type { Kpis, OverallScore } from './people';

/**
 * Mirrors `src/appraisals/appraisals.types.ts` and the request DTOs in
 * `src/appraisals/dto/*` by hand. Dates are `YYYY-MM-DD`, timestamps ISO-8601.
 * FORM_100 (the paper form): ratings 2/4/6/8/10, a 100-mark total and an A-F
 * grade; KPI_BLEND (legacy): ratings 1-5, scores 0-5 with one decimal. Row shapes are
 * `type` aliases so they satisfy DataTable's index-signature constraint.
 */

export type CycleStatus = 'DRAFT' | 'OPEN' | 'CLOSED';
export type AppraisalStatus =
  | 'SELF_REVIEW'
  | 'LEAD_REVIEW'
  | 'CALIBRATION'
  | 'DEPT_HEAD_REVIEW'
  | 'HR_REVIEW'
  | 'FINAL_APPROVAL'
  | 'SIGNED_OFF';
export type Recommendation = 'PROMOTE' | 'RAISE' | 'NO_CHANGE' | 'IMPROVEMENT_PLAN';
export type AppraisalType = 'HALF_YEARLY' | 'CONFIRMATION' | 'YEARLY' | 'INTERNSHIP';
/** An internship review's single recommendation. */
export type InternshipOutcome = 'MOVE_TO_PROBATION' | 'EXTEND_INTERNSHIP' | 'END_INTERNSHIP';
export type ScoringMode = 'KPI_BLEND' | 'FORM_100';
/** CALENDAR: the cycle's period is everyone's review period. JOIN_DATE: counted from each join date; the cycle's period is "due between". */
export type PeriodBasis = 'CALENDAR' | 'JOIN_DATE';
export type AppraisalAction = 'CONFIRM' | 'INCREMENT' | 'PROMOTION' | 'TERMINATION' | 'DISMISSAL' | 'TRAINING_TRANSFER';
export type ApprovalDecision = 'APPROVED' | 'NOT_APPROVED';
export type FormGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
/** From when an approved outcome takes effect: the due date (backdated), the approval date, or a chosen date. */
export type EffectiveDateMode = 'DUE_DATE' | 'APPROVAL_DATE' | 'CUSTOM';

/**
 * When an appraisal happened against its due date. `days`: ON_TIME the signed offset (-3..3);
 * EARLY / LATE / OPEN_OVERDUE how far from the due date; OPEN days until due (negative = past due,
 * still within the 3-day grace).
 */
export type AppraisalTiming = { status: 'ON_TIME' | 'EARLY' | 'LATE' | 'OPEN_OVERDUE' | 'OPEN'; days: number };

/** The outcome's effective date: frozen at sign-off, a preview (as if signed off today) before. */
export type EffectiveDateView = {
  mode: EffectiveDateMode;
  date: string;
  /** No mode chosen: the default (due date when late, else approval date). */
  defaulted: boolean;
  backdated: boolean;
  /** Approved, backdated increment: whole months between the effective and approval dates. */
  arrearsMonths: number;
};

export type GradePolicy = {
  grade: FormGrade;
  minMarks: number;
  maxMarks: number;
  promotion: boolean;
  incrementMin: number;
  incrementMax: number;
  training: boolean;
  transfer: boolean;
  termination: boolean;
  proposal: string;
};

/** The form's header block; money in whole taka. Frozen at sign-off. */
export type FormHeader = {
  capturedAt: string;
  name: string;
  concernName: string | null;
  designation: string;
  department: string | null;
  joinDate: string;
  academicQualification: string | null;
  companyName: string;
  experienceInCompanyMonths: number;
  experienceBeforeJoiningMonths: number | null;
  totalExperienceMonths: number | null;
  startingSalary: number | null;
  grossSalary: number | null;
  lastIncrementAmount: number | null;
  lastIncrementDate: string | null;
  lastPromotionDate: string | null;
};

export type StepRecord = { status: AppraisalStatus; byUserId: string | null; byName: string | null; at: string | null };

export type Competency = { key: string; label: string; description?: string };
export type RatingMap = Record<string, number>;

export type CycleCounts = {
  total: number;
  SELF_REVIEW: number;
  LEAD_REVIEW: number;
  CALIBRATION: number;
  DEPT_HEAD_REVIEW: number;
  HR_REVIEW: number;
  FINAL_APPROVAL: number;
  SIGNED_OFF: number;
};

export type CycleView = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  periodBasis: PeriodBasis;
  status: CycleStatus;
  type: AppraisalType;
  scoringMode: ScoringMode;
  /** 0-100: share of the final score that comes from the KPIs (KPI_BLEND only). */
  kpiWeight: number;
  competencies: Competency[];
  counts: CycleCounts;
  createdAt: string;
};

export type LaunchNotDue = {
  employeeId: string;
  employeeName: string;
  /** ALREADY_APPRAISED: the due date the pick resolved to already has an appraisal (any cycle). */
  /** NOT_AN_INTERN: picked for an internship review. STILL_INTERN: an intern picked for another review. */
  reason: 'NOT_YET_DUE' | 'EXITED' | 'ALREADY_APPRAISED' | 'NOT_AN_INTERN' | 'STILL_INTERN';
  /** NOT_YET_DUE: when the first appraisal of the cycle's type falls due. */
  firstDueDate: string | null;
  /** ALREADY_APPRAISED: the covered due date. */
  dueDate?: string | null;
};

export type LaunchResult = { cycle: CycleView; created: number; skipped: number; notDue: LaunchNotDue[] };

/** One employee due an appraisal in a window (`GET /people/appraisal-cycles/due`). */
export type DueEmployee = {
  employeeId: string;
  fullName: string;
  designation: string;
  teamName: string | null;
  status: 'INTERN' | 'PROBATION' | 'ACTIVE' | 'NOTICE' | 'EXITED';
  joinDate: string;
  type: AppraisalType;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  /** Due before today: by how many days. */
  daysLate: number | null;
  /** Due after today: in how many days. */
  daysEarly: number | null;
};

/** `GET /people/appraisal-cycles/due`: due in the window, overdue before it, coming up within 60 days after. */
export type DueGroups = { due: DueEmployee[]; overdue: DueEmployee[]; upcoming: DueEmployee[] };

export type KpiSnapshot = {
  period: { from: string; to: string };
  computedAt: string;
  kpis: Kpis;
  overall: OverallScore;
};

export type ScoreView = {
  mode: ScoringMode;
  /** The scale of `final`: 5 (KPI_BLEND) or 100 (FORM_100). */
  outOf: 5 | 100;
  /** KPI_BLEND: 0-5, the calibrated score when set. FORM_100: the 100-mark total. null when nothing to score yet. */
  final: number | null;
  computed: number | null;
  kpiPart: number | null;
  competencyPart: number | null;
  /** KPI score missing or partial (not linked to ClickUp): label it "Partial". */
  partial: boolean;
  calibrated: boolean;
  basedOn: ('kpi' | 'competencies')[];
  kpiWeight: number;
  /** FORM_100: the grade once every criterion is rated (frozen after sign-off). */
  grade: FormGrade | null;
  policy: GradePolicy | null;
  /** The KPI overall score (0-100), shown beside the form as a reference only. */
  kpiReference: number | null;
  kpiReferencePartial: boolean;
  ratedCount: number;
  criteriaCount: number;
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
  scoringMode: ScoringMode;
  /** This appraisal's own review period (the cycle's for calendar cycles). */
  periodStart: string;
  periodEnd: string;
  /** JOIN_DATE cycles: when it fell due. */
  dueDate: string | null;
  score: ScoreView;
  recommendation: Recommendation | null;
  actions: AppraisalAction[];
  internshipOutcome: InternshipOutcome | null;
  approvalDecision: ApprovalDecision | null;
  signedOffAt: string | null;
  timing: AppraisalTiming | null;
  updatedAt: string;
};

export type EmployeeAppraisalRow = {
  id: string;
  cycleId: string;
  cycleName: string;
  /** This appraisal's own review period (the cycle's for calendar cycles). */
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  status: AppraisalStatus;
  scoringMode: ScoringMode;
  appraisalType: AppraisalType;
  score: ScoreView;
  recommendation: Recommendation | null;
  actions: AppraisalAction[];
  internshipOutcome: InternshipOutcome | null;
  approvalDecision: ApprovalDecision | null;
  newDesignation: string | null;
  signedOffAt: string | null;
  timing: AppraisalTiming | null;
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
  | 'calibratedScore'
  | 'actions'
  | 'incrementPercent'
  | 'trainingPlan'
  | 'deptHeadComment'
  | 'hrComment'
  | 'approvalDecision'
  | 'approvalComment'
  | 'dueDate'
  | 'periodStart'
  | 'periodEnd'
  | 'effectiveDateMode'
  | 'effectiveDate'
  | 'internshipOutcome'
  | 'proposedProbationStart'
  | 'proposedInternshipEnd';

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
  /** This appraisal's own review period (the cycle's for calendar cycles). */
  periodStart: string;
  periodEnd: string;
  /** JOIN_DATE cycles: when it fell due. */
  dueDate: string | null;
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
  actions: AppraisalAction[];
  incrementPercent: number | null;
  trainingPlan: string | null;
  deptHeadComment: string | null;
  hrComment: string | null;
  approvalDecision: ApprovalDecision | null;
  approvalComment: string | null;
  /** INTERNSHIP cycles: the single recommendation and its date. */
  internshipOutcome: InternshipOutcome | null;
  proposedProbationStart: string | null;
  proposedInternshipEnd: string | null;
  /** INTERNSHIP cycles: what the recommendation is checked against. */
  internship: { currentEndDate: string; defaultProbationStart: string; isIntern: boolean } | null;
  formHeader: FormHeader | null;
  /** This mode's step sequence with who/when once completed. */
  steps: StepRecord[];
  /** The stored PDF of the signed-off form (an employee document), once filed. */
  formDocumentId: string | null;
  kpiSnapshot: KpiSnapshot | null;
  score: ScoreView;
  /** Fields the current step accepts; empty once signed off or when the cycle is not open. */
  editableFields: EditableField[];
  /** What stops "Advance" right now. */
  advanceBlockers: string[];
  canSendBack: boolean;
  signedOffAt: string | null;
  timing: AppraisalTiming | null;
  /** The stored choice; null = the default. */
  effectiveDateMode: EffectiveDateMode | null;
  /** CUSTOM: the chosen date; after sign-off: the resolved date. */
  effectiveDate: string | null;
  /** FORM_100: the resolved effective date (frozen after sign-off, else a preview). */
  effective: EffectiveDateView | null;
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
  type?: AppraisalType;
  periodBasis?: PeriodBasis;
  scoringMode?: ScoringMode;
  kpiWeight?: number;
  competencies?: Competency[];
};

export type UpdateCycleBody = Partial<Omit<CreateCycleBody, 'scoringMode'>> & { status?: CycleStatus };

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
  actions?: AppraisalAction[];
  incrementPercent?: number | null;
  trainingPlan?: string | null;
  deptHeadComment?: string | null;
  hrComment?: string | null;
  approvalDecision?: ApprovalDecision | null;
  approvalComment?: string | null;
  effectiveDateMode?: EffectiveDateMode | null;
  effectiveDate?: string | null;
  internshipOutcome?: InternshipOutcome | null;
  proposedProbationStart?: string | null;
  proposedInternshipEnd?: string | null;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
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
  /** Who a `type` cycle due in [from, to] would cover: due, overdue and coming up. */
  due: (type: AppraisalType, from: string, to: string) =>
    apiClient
      .get<DueGroups>('/people/appraisal-cycles/due', { params: { type, from, to } })
      .then((r) => r.data),
  /** Everyone overdue for any appraisal type as of today, oldest first. */
  overdue: () => apiClient.get<DueEmployee[]>('/people/appraisal-cycles/overdue').then((r) => r.data),
  cycleAppraisals: (id: string) =>
    apiClient.get<AppraisalListRow[]>(`/people/appraisal-cycles/${id}/appraisals`).then((r) => r.data),

  appraisal: (id: string) => apiClient.get<AppraisalView>(`/people/appraisals/${id}`).then((r) => r.data),
  update: (id: string, body: UpdateAppraisalBody) =>
    apiClient.patch<AppraisalView>(`/people/appraisals/${id}`, body).then((r) => r.data),
  advance: (id: string) => apiClient.post<AppraisalView>(`/people/appraisals/${id}/advance`).then((r) => r.data),
  sendBack: (id: string) => apiClient.post<AppraisalView>(`/people/appraisals/${id}/send-back`).then((r) => r.data),
  refreshKpis: (id: string) =>
    apiClient.post<AppraisalView>(`/people/appraisals/${id}/refresh-kpis`).then((r) => r.data),
  /** The filled paper form (FORM_100). A preview before sign-off; the frozen form after. */
  formPdfUrl: (id: string, download = false) =>
    `/api/people/appraisals/${encodeURIComponent(id)}/form-pdf${download ? '?download=1' : ''}`,
  formPdfBlob: (id: string) =>
    apiClient
      .get<Blob>(`/people/appraisals/${encodeURIComponent(id)}/form-pdf`, { params: { download: 1 }, responseType: 'blob' })
      .then((r) => r.data),
  forEmployee: (employeeId: string) =>
    apiClient.get<EmployeeAppraisalRow[]>(`/people/employees/${employeeId}/appraisals`).then((r) => r.data),
};
