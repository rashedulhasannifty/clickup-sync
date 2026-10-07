import { dateColumnToIso } from '../people/people-dates';
import {
  advanceBlockers,
  cleanRatings,
  computeScore,
  editableFields,
  previousStatus,
} from './appraisal-score';
import type { AppraisalRow, CycleRow } from './appraisals.repository';
import type {
  AppraisalListRow,
  AppraisalRecommendationValue,
  AppraisalStatusValue,
  AppraisalView,
  Competency,
  CycleCounts,
  CycleView,
  EmployeeAppraisalRow,
  KpiSnapshot,
  ScoreView,
} from './appraisals.types';

/** Stored competencies, defensively: a malformed row never takes a page down. */
export function competenciesOf(cycle: Pick<CycleRow, 'competencies'>): Competency[] {
  const raw = cycle.competencies;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    if (typeof c !== 'object' || c === null) return [];
    const { key, label } = c as { key?: unknown; label?: unknown };
    return typeof key === 'string' && typeof label === 'string'
      ? [{ key, label }]
      : [];
  });
}

export function emptyCounts(): CycleCounts {
  return { total: 0, SELF_REVIEW: 0, LEAD_REVIEW: 0, CALIBRATION: 0, SIGNED_OFF: 0 };
}

export function toCycleView(row: CycleRow, counts: CycleCounts): CycleView {
  return {
    id: row.id,
    name: row.name,
    periodStart: dateColumnToIso(row.periodStart),
    periodEnd: dateColumnToIso(row.periodEnd),
    status: row.status,
    kpiWeight: row.kpiWeight,
    competencies: competenciesOf(row),
    counts,
    createdAt: row.createdAt.toISOString(),
  };
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

/** The score of an appraisal as it stands. At sign-off the stored score is the answer, so history never moves. */
export function scoreOf(row: AppraisalRow): ScoreView {
  const keys = competenciesOf(row.cycle).map((c) => c.key);
  const snap = snapshotOf(row);
  const s = computeScore({
    kpiScore: snap?.overall.score ?? null,
    kpiPartial: snap?.overall.partial ?? false,
    leadRatings: cleanRatings(row.leadRatings, keys),
    competencyKeys: keys,
    kpiWeight: row.cycle.kpiWeight,
    calibratedScore: row.calibratedScore,
  });
  const frozen = row.status === 'SIGNED_OFF' && row.finalScore !== null;
  return {
    final: frozen ? row.finalScore : s.final,
    computed: s.computed,
    kpiPart: s.kpiPart,
    competencyPart: s.competencyPart,
    partial: frozen ? (row.finalPartial ?? s.partial) : s.partial,
    calibrated: s.calibrated,
    basedOn: s.basedOn,
    kpiWeight: row.cycle.kpiWeight,
  };
}

export function toListRow(row: AppraisalRow): AppraisalListRow {
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
    score: scoreOf(row),
    recommendation: row.recommendation,
    signedOffAt: row.signedOffAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEmployeeRow(row: AppraisalRow): EmployeeAppraisalRow {
  return {
    id: row.id,
    cycleId: row.cycleId,
    cycleName: row.cycle.name,
    periodStart: dateColumnToIso(row.cycle.periodStart),
    periodEnd: dateColumnToIso(row.cycle.periodEnd),
    status: row.status,
    score: scoreOf(row),
    recommendation: row.recommendation,
    newDesignation: row.newDesignation,
    signedOffAt: row.signedOffAt?.toISOString() ?? null,
  };
}

export function blockersOf(row: AppraisalRow): string[] {
  const keys = competenciesOf(row.cycle).map((c) => c.key);
  return advanceBlockers({
    status: row.status,
    leadRatings: cleanRatings(row.leadRatings, keys),
    competencyKeys: keys,
    recommendation: row.recommendation as AppraisalRecommendationValue | null,
    newDesignation: row.newDesignation,
  });
}

export function toAppraisalView(
  row: AppraisalRow,
  counts: CycleCounts,
  previous: EmployeeAppraisalRow[],
): AppraisalView {
  const keys = competenciesOf(row.cycle).map((c) => c.key);
  const status: AppraisalStatusValue = row.status;
  const open = row.cycle.status === 'OPEN';
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
    status,
    selfRatings: cleanRatings(row.selfRatings, keys),
    selfComment: row.selfComment,
    leadRatings: cleanRatings(row.leadRatings, keys),
    leadComment: row.leadComment,
    strengths: row.strengths,
    improvements: row.improvements,
    goals: row.goals,
    recommendation: row.recommendation,
    newDesignation: row.newDesignation,
    calibrationNote: row.calibrationNote,
    calibratedScore: row.calibratedScore,
    kpiSnapshot: snapshotOf(row),
    score: scoreOf(row),
    // A closed (or draft) cycle is read-only until it is reopened.
    editableFields: open ? editableFields(status) : [],
    advanceBlockers: open ? blockersOf(row) : ['This cycle is not open'],
    canSendBack: open && previousStatus(status) !== null,
    signedOffAt: row.signedOffAt?.toISOString() ?? null,
    outcomeApplied: row.outcomeAppliedAt !== null,
    previous,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
