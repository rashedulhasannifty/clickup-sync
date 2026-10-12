import { scheduleFieldsOf } from '../people/employee-mapper';
import { addDays, dateColumnToIso, dhakaDateOf } from '../people/people-dates';
import { internshipDueDate } from './appraisal-schedule';
import {
  appraisalTiming,
  effectiveDateError,
  effectiveDateView,
} from './appraisal-timing';
import {
  advanceBlockers,
  cleanRatings,
  computeScore,
  editableFields,
  flowOf,
  formScore,
  gradePolicy,
  internshipAdvanceBlockers,
  previousStatus,
  stepsFor,
  type AppraisalFlow,
} from './appraisal-score';
import type { AppraisalRow, CycleRow } from './appraisals.repository';
import type {
  AppraisalActionValue,
  AppraisalEffectiveDateValue,
  AppraisalListRow,
  AppraisalPeriod,
  AppraisalPeriodBasisValue,
  AppraisalRecommendationValue,
  AppraisalStatusValue,
  AppraisalTiming,
  AppraisalView,
  Competency,
  EffectiveDateView,
  CycleCounts,
  CycleView,
  EmployeeAppraisalRow,
  FormGrade,
  FormHeader,
  InternshipContext,
  InternshipOutcomeValue,
  KpiSnapshot,
  ScoreView,
  ScoringModeValue,
  StepRecord,
} from './appraisals.types';

/** Stored competencies, defensively: a malformed row never takes a page down. */
export function competenciesOf(
  cycle: Pick<CycleRow, 'competencies'>,
): Competency[] {
  const raw = cycle.competencies;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    if (typeof c !== 'object' || c === null) return [];
    const { key, label, description } = c as {
      key?: unknown;
      label?: unknown;
      description?: unknown;
    };
    if (typeof key !== 'string' || typeof label !== 'string') return [];
    return [
      typeof description === 'string' && description
        ? { key, label, description }
        : { key, label },
    ];
  });
}

export const modeOf = (row: { cycle: Pick<CycleRow, 'scoringMode'> }) =>
  row.cycle.scoringMode as ScoringModeValue;

/** The workflow an appraisal follows: its cycle's type and scoring mode. */
export const flowOfRow = (row: {
  cycle: Pick<CycleRow, 'scoringMode' | 'type'>;
}): AppraisalFlow => flowOf(modeOf(row), row.cycle.type);

const dateOrNull = (d: Date | null | undefined) =>
  d ? dateColumnToIso(d) : null;

/** Internship reviews: what the recommendation is checked against. Null for other types. */
export function internshipContextOf(
  row: AppraisalRow,
): InternshipContext | null {
  if (row.cycle.type !== 'INTERNSHIP') return null;
  const period = periodOf(row);
  return {
    currentEndDate: internshipDueDate(scheduleFieldsOf(row.employee)),
    defaultProbationStart: addDays(
      period.dueDate ?? addDays(period.periodEnd, 1),
      1,
    ),
    isIntern: row.employee.status === 'INTERN',
  };
}

export function emptyCounts(): CycleCounts {
  return {
    total: 0,
    SELF_REVIEW: 0,
    LEAD_REVIEW: 0,
    CALIBRATION: 0,
    DEPT_HEAD_REVIEW: 0,
    HR_REVIEW: 0,
    FINAL_APPROVAL: 0,
    SIGNED_OFF: 0,
  };
}

export function toCycleView(row: CycleRow, counts: CycleCounts): CycleView {
  return {
    id: row.id,
    name: row.name,
    periodStart: dateColumnToIso(row.periodStart),
    periodEnd: dateColumnToIso(row.periodEnd),
    periodBasis: row.periodBasis,
    status: row.status,
    type: row.type,
    scoringMode: row.scoringMode,
    kpiWeight: row.kpiWeight,
    competencies: competenciesOf(row),
    counts,
    createdAt: row.createdAt.toISOString(),
  };
}

export const basisOf = (cycle: Pick<CycleRow, 'periodBasis'>) =>
  // Rows built without the column (older fixtures) read as the pre-0032 behaviour.
  (cycle.periodBasis ?? 'CALENDAR') as AppraisalPeriodBasisValue;

/**
 * The period one appraisal reviews: its own (JOIN_DATE cycles) or, when it
 * has none (calendar cycles, appraisals created before 0032), the cycle's.
 */
export function periodOf(
  row: Pick<AppraisalRow, 'periodStart' | 'periodEnd' | 'dueDate'> & {
    cycle: Pick<CycleRow, 'periodStart' | 'periodEnd'>;
  },
): AppraisalPeriod {
  if (row.periodStart && row.periodEnd) {
    return {
      periodStart: dateColumnToIso(row.periodStart),
      periodEnd: dateColumnToIso(row.periodEnd),
      dueDate: row.dueDate ? dateColumnToIso(row.dueDate) : null,
    };
  }
  return {
    periodStart: dateColumnToIso(row.cycle.periodStart),
    periodEnd: dateColumnToIso(row.cycle.periodEnd),
    dueDate: null,
  };
}

/** The Dhaka date the appraisal was signed off on, or null while open. */
export const signedOnOf = (row: Pick<AppraisalRow, 'signedOffAt'>) =>
  row.signedOffAt ? dhakaDateOf(row.signedOffAt) : null;

/** On time / early / late against the appraisal's own due date (null for calendar cycles). */
export function timingOf(
  row: Parameters<typeof periodOf>[0] & Pick<AppraisalRow, 'signedOffAt'>,
  today: string,
): AppraisalTiming | null {
  return appraisalTiming(periodOf(row).dueDate, signedOnOf(row), today);
}

const effectiveModeOf = (row: Pick<AppraisalRow, 'effectiveDateMode'>) =>
  (row.effectiveDateMode ?? null) as AppraisalEffectiveDateValue | null;

/** The stored effective date, `YYYY-MM-DD`. */
const storedEffectiveDate = (row: Pick<AppraisalRow, 'effectiveDate'>) =>
  row.effectiveDate ? dateColumnToIso(row.effectiveDate) : null;

/**
 * The outcome's effective date: frozen once signed off (the mode and date
 * stored at sign-off), else what signing off today would use.
 */
export function effectiveOf(
  row: AppraisalRow,
  today: string,
): EffectiveDateView | null {
  const period = periodOf(row);
  const signedOn = signedOnOf(row);
  const mode = effectiveModeOf(row);
  const stored = storedEffectiveDate(row);
  return effectiveDateView({
    scoringMode: modeOf(row),
    mode,
    customDate: stored,
    dueDate: period.dueDate,
    periodStart: period.periodStart,
    approvalDate: signedOn ?? today,
    decision: row.approvalDecision,
    actions: actionsOf(row),
    // Rows signed off before 0033 without a stored date read as their sign-off date.
    frozen:
      row.status === 'SIGNED_OFF' && signedOn
        ? { mode: mode ?? 'APPROVAL_DATE', date: stored ?? signedOn }
        : null,
  });
}

export function snapshotOf(
  row: Pick<AppraisalRow, 'kpiSnapshot'>,
): KpiSnapshot | null {
  const s = row.kpiSnapshot;
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return null;
  const snap = s as unknown as Partial<KpiSnapshot>;
  return snap.kpis && snap.overall && snap.period
    ? (snap as KpiSnapshot)
    : null;
}

export function headerOf(
  row: Pick<AppraisalRow, 'formHeader'>,
): FormHeader | null {
  const h = row.formHeader;
  if (typeof h !== 'object' || h === null || Array.isArray(h)) return null;
  const header = h as unknown as Partial<FormHeader>;
  return typeof header.name === 'string' && typeof header.joinDate === 'string'
    ? (header as FormHeader)
    : null;
}

const GRADES: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'E', 'F']);

/** The score of an appraisal as it stands. At sign-off the stored score is the answer, so history never moves. */
export function scoreOf(row: AppraisalRow): ScoreView {
  const mode = modeOf(row);
  const keys = competenciesOf(row.cycle).map((c) => c.key);
  const snap = snapshotOf(row);
  const frozen = row.status === 'SIGNED_OFF' && row.finalScore !== null;
  const kpiReference = snap?.overall.score ?? null;
  const kpiReferencePartial = snap ? snap.overall.partial : true;

  if (mode === 'FORM_100') {
    const f = formScore(cleanRatings(row.leadRatings, keys, mode), keys);
    const storedGrade =
      frozen && row.finalGrade && GRADES.has(row.finalGrade)
        ? (row.finalGrade as FormGrade)
        : null;
    const grade = frozen ? storedGrade : f.grade;
    return {
      mode,
      outOf: 100,
      final: frozen ? row.finalScore : f.total,
      computed: f.total,
      kpiPart: null,
      competencyPart: null,
      // The form score never rests on the KPIs, so it is never "partial".
      partial: false,
      calibrated: false,
      basedOn: f.total === null ? [] : ['competencies'],
      kpiWeight: 0,
      grade,
      policy: grade ? gradePolicy(grade) : null,
      kpiReference,
      kpiReferencePartial,
      ratedCount: f.ratedCount,
      criteriaCount: f.criteriaCount,
    };
  }

  const ratings = cleanRatings(row.leadRatings, keys);
  const s = computeScore({
    kpiScore: kpiReference,
    kpiPartial: snap?.overall.partial ?? false,
    leadRatings: ratings,
    competencyKeys: keys,
    kpiWeight: row.cycle.kpiWeight,
    calibratedScore: row.calibratedScore,
  });
  return {
    mode,
    outOf: 5,
    final: frozen ? row.finalScore : s.final,
    computed: s.computed,
    kpiPart: s.kpiPart,
    competencyPart: s.competencyPart,
    partial: frozen ? (row.finalPartial ?? s.partial) : s.partial,
    calibrated: s.calibrated,
    basedOn: s.basedOn,
    kpiWeight: row.cycle.kpiWeight,
    grade: null,
    policy: null,
    kpiReference,
    kpiReferencePartial,
    ratedCount: Object.keys(ratings).length,
    criteriaCount: keys.length,
  };
}

const actionsOf = (row: AppraisalRow): AppraisalActionValue[] =>
  (row.actions ?? []) as AppraisalActionValue[];

const internshipOutcomeOf = (row: AppraisalRow) =>
  (row.internshipOutcome ?? null) as InternshipOutcomeValue | null;

export function toListRow(
  row: AppraisalRow,
  today: string = dhakaDateOf(new Date()),
): AppraisalListRow {
  return {
    id: row.id,
    cycleId: row.cycleId,
    employeeId: row.employeeId,
    employeeName: row.employee.fullName,
    designation: row.employee.designation,
    teamName: row.employee.team?.name ?? null,
    reviewerId: row.reviewerId,
    reviewerName: row.reviewer?.fullName ?? null,
    status: row.status,
    scoringMode: modeOf(row),
    ...periodOf(row),
    score: scoreOf(row),
    recommendation: row.recommendation,
    actions: actionsOf(row),
    internshipOutcome: internshipOutcomeOf(row),
    approvalDecision: row.approvalDecision,
    signedOffAt: row.signedOffAt?.toISOString() ?? null,
    timing: timingOf(row, today),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEmployeeRow(
  row: AppraisalRow,
  today: string = dhakaDateOf(new Date()),
): EmployeeAppraisalRow {
  return {
    id: row.id,
    cycleId: row.cycleId,
    cycleName: row.cycle.name,
    ...periodOf(row),
    status: row.status,
    scoringMode: modeOf(row),
    appraisalType: row.cycle.type,
    score: scoreOf(row),
    recommendation: row.recommendation,
    actions: actionsOf(row),
    internshipOutcome: internshipOutcomeOf(row),
    approvalDecision: row.approvalDecision,
    newDesignation: row.newDesignation,
    signedOffAt: row.signedOffAt?.toISOString() ?? null,
    timing: timingOf(row, today),
  };
}

export function blockersOf(row: AppraisalRow): string[] {
  const mode = modeOf(row);
  const keys = competenciesOf(row.cycle).map((c) => c.key);
  const internship = internshipContextOf(row);
  if (internship) {
    // Checked against the employee as they stand now: their internship end may have moved.
    return internshipAdvanceBlockers({
      status: row.status,
      leadRatings: cleanRatings(row.leadRatings, keys, mode),
      competencyKeys: keys,
      approvalDecision: row.approvalDecision,
      outcome: internshipOutcomeOf(row),
      probationStart: dateOrNull(row.proposedProbationStart),
      newEndDate: dateOrNull(row.proposedInternshipEnd),
      currentEndDate: internship.currentEndDate,
      joinDate: dateColumnToIso(row.employee.joinDate),
    });
  }
  const out = advanceBlockers({
    mode,
    status: row.status,
    leadRatings: cleanRatings(row.leadRatings, keys, mode),
    competencyKeys: keys,
    recommendation: row.recommendation as AppraisalRecommendationValue | null,
    newDesignation: row.newDesignation,
    actions: actionsOf(row),
    incrementPercent: row.incrementPercent,
    approvalDecision: row.approvalDecision,
    grossSalaryKnown: row.employee.grossSalary !== null,
  });
  // Checked again here, not only on save: the period can be edited after the date was chosen.
  if (mode === 'FORM_100' && row.status === 'FINAL_APPROVAL') {
    const period = periodOf(row);
    const error = effectiveDateError({
      mode: effectiveModeOf(row),
      customDate: storedEffectiveDate(row),
      dueDate: period.dueDate,
      periodStart: period.periodStart,
    });
    if (error) out.push(error);
  }
  return out;
}

/** Who completed each step (recorded as the appraisal left it). User ids not in `names` show no name. */
export function stepRecords(
  row: AppraisalRow,
  names: ReadonlyMap<string, string>,
): StepRecord[] {
  const rec = (
    status: AppraisalStatusValue,
    by: string | null,
    at: Date | null,
  ): StepRecord => ({
    status,
    byUserId: by,
    byName: by ? (names.get(by) ?? null) : null,
    at: at?.toISOString() ?? null,
  });
  return stepsFor(flowOfRow(row)).map((s) => {
    switch (s) {
      case 'LEAD_REVIEW':
        return rec(s, row.leadReviewBy, row.leadReviewAt);
      case 'DEPT_HEAD_REVIEW':
        return rec(s, row.deptHeadBy, row.deptHeadAt);
      case 'HR_REVIEW':
        return rec(s, row.hrBy, row.hrAt);
      case 'FINAL_APPROVAL':
        return rec(s, row.approvalBy, row.approvalAt);
      case 'SIGNED_OFF':
        return rec(s, row.signedOffBy, row.signedOffAt);
      default:
        return rec(s, null, null);
    }
  });
}

/** The user ids `stepRecords` will want names for. */
export function stepActorIds(row: AppraisalRow): string[] {
  return [
    row.leadReviewBy,
    row.deptHeadBy,
    row.hrBy,
    row.approvalBy,
    row.signedOffBy,
  ].filter((x): x is string => !!x);
}

export function toAppraisalView(
  row: AppraisalRow,
  counts: CycleCounts,
  previous: EmployeeAppraisalRow[],
  names: ReadonlyMap<string, string> = new Map(),
  today: string = dhakaDateOf(new Date()),
): AppraisalView {
  const mode = modeOf(row);
  const flow = flowOfRow(row);
  const keys = competenciesOf(row.cycle).map((c) => c.key);
  const status: AppraisalStatusValue = row.status;
  // Mirrors the service's assertOpen: an exited employee's appraisal is as
  // read-only as one in a closed cycle, so the form offers no controls.
  const exited = row.employee.status === 'EXITED';
  const open = row.cycle.status === 'OPEN' && !exited;
  return {
    id: row.id,
    cycle: toCycleView(row.cycle, counts),
    employee: {
      id: row.employee.id,
      fullName: row.employee.fullName,
      designation: row.employee.designation,
      teamName: row.employee.team?.name ?? null,
      employeeCode: row.employee.employeeCode,
      clickupLinked: row.employee.clickupUserId !== null,
    },
    reviewerId: row.reviewerId,
    reviewerName: row.reviewer?.fullName ?? null,
    ...periodOf(row),
    status,
    selfRatings: cleanRatings(row.selfRatings, keys, mode),
    selfComment: row.selfComment,
    leadRatings: cleanRatings(row.leadRatings, keys, mode),
    leadComment: row.leadComment,
    strengths: row.strengths,
    improvements: row.improvements,
    goals: row.goals,
    recommendation: row.recommendation,
    newDesignation: row.newDesignation,
    calibrationNote: row.calibrationNote,
    calibratedScore: row.calibratedScore,
    actions: actionsOf(row),
    incrementPercent: row.incrementPercent,
    trainingPlan: row.trainingPlan,
    deptHeadComment: row.deptHeadComment,
    hrComment: row.hrComment,
    approvalDecision: row.approvalDecision,
    approvalComment: row.approvalComment,
    internshipOutcome: internshipOutcomeOf(row),
    proposedProbationStart: dateOrNull(row.proposedProbationStart),
    proposedInternshipEnd: dateOrNull(row.proposedInternshipEnd),
    internship: internshipContextOf(row),
    formHeader: headerOf(row),
    steps: stepRecords(row, names),
    formDocumentId: row.formDocumentId,
    kpiSnapshot: snapshotOf(row),
    score: scoreOf(row),
    // A closed (or draft) cycle is read-only until it is reopened.
    editableFields: open ? editableFields(status, flow) : [],
    advanceBlockers: open
      ? blockersOf(row)
      : [exited ? 'This employee has exited' : 'This cycle is not open'],
    canSendBack: open && previousStatus(status, flow) !== null,
    signedOffAt: row.signedOffAt?.toISOString() ?? null,
    timing: timingOf(row, today),
    effectiveDateMode: effectiveModeOf(row),
    effectiveDate: storedEffectiveDate(row),
    // The internship outcome is dated by its own choice (the probation start), not this.
    effective: flow === 'FORM_100' ? effectiveOf(row, today) : null,
    outcomeApplied: row.outcomeAppliedAt !== null,
    previous,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
