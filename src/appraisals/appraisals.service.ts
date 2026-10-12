import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthPrincipal } from '../auth/auth.types';
import { DocumentsService } from '../documents/documents.service';
import { EmployeesService } from '../people/employees.service';
import { assertNotExited } from '../people/employee-readonly';
import {
  pastAppraisalOnRecord,
  scheduleFieldsOf,
} from '../people/employee-mapper';
import {
  addDays,
  dateColumnToIso,
  dhakaDateOf,
  isoToDateColumn,
} from '../people/people-dates';
import { PeopleSummaryService } from '../people/people-summary.service';
import { buildFormHeader } from './appraisal-header';
import {
  classifyDue,
  dueDateTaken,
  dueOnOrBeforeFor,
  firstDueFor,
  isDueCovered,
  overdueAppraisals,
  selectDue,
  UPCOMING_DAYS,
  type AppraisalOnRecord,
  type ClassifiedDue,
  type DueAppraisal,
  type OverdueEmployee,
} from './appraisal-schedule';
import {
  dateEditError,
  effectiveDateError,
  resolveEffectiveDate,
} from './appraisal-timing';
import { formPdfFileName, renderAppraisalFormPdf } from './appraisal-form-pdf';
import {
  cycleStatusAllowed,
  defaultCriteria,
  DEFAULT_KPI_WEIGHT,
  DEFAULT_SCORING_MODE,
  editableFields,
  formOutcomePlan,
  internshipOutcomePlan,
  formScore,
  cleanRatings,
  isValidCalibratedScore,
  isValidIncrementPercent,
  nextStatus,
  outcomePlan,
  parseRatings,
  previousStatus,
  signOffAction,
  validateCompetencies,
} from './appraisal-score';
import {
  basisOf,
  blockersOf,
  effectiveOf,
  competenciesOf,
  emptyCounts,
  flowOfRow,
  headerOf,
  internshipContextOf,
  modeOf,
  periodOf,
  scoreOf,
  signedOnOf,
  stepActorIds,
  toAppraisalView,
  toCycleView,
  toEmployeeRow,
  toListRow,
} from './appraisal-mapper';
import {
  AppraisalsRepository,
  type AppraisalRow,
  type CandidateRow,
  type CycleRow,
  type HeaderSourceRow,
  type LaunchCandidate,
} from './appraisals.repository';
import type {
  AppraisalActionValue,
  AppraisalEditableField,
  AppraisalEffectiveDateValue,
  AppraisalPeriodBasisValue,
  AppraisalTypeValue,
  AppraisalListRow,
  AppraisalStatusValue,
  AppraisalView,
  CycleCounts,
  CycleView,
  DueEmployeeRow,
  DueGroupsView,
  EmployeeAppraisalRow,
  FormHeader,
  InternshipOutcomeValue,
  KpiSnapshot,
  LaunchNotDue,
  LaunchResult,
  ScoringModeValue,
} from './appraisals.types';
import {
  CreateCycleDto,
  DueQuery,
  LaunchCycleDto,
  UpdateCycleDto,
} from './dto/cycle.dto';
import { UpdateAppraisalDto } from './dto/update-appraisal.dto';

/** A machine credential is not a user row; never store its synthetic id as an actor. */
const actorId = (p: AuthPrincipal): string | null =>
  p.isMachine ? null : p.userId;

const clean = (v: string | null | undefined): string | null =>
  v === undefined || v === null ? null : v.trim() || null;

/** The columns that record who completed a step, keyed by the step being left. */
const STEP_STAMP: Partial<
  Record<
    AppraisalStatusValue,
    (by: string | null, at: Date) => Prisma.AppraisalUpdateManyMutationInput
  >
> = {
  LEAD_REVIEW: (by, at) => ({ leadReviewBy: by, leadReviewAt: at }),
  DEPT_HEAD_REVIEW: (by, at) => ({ deptHeadBy: by, deptHeadAt: at }),
  HR_REVIEW: (by, at) => ({ hrBy: by, hrAt: at }),
  FINAL_APPROVAL: (by, at) => ({ approvalBy: by, approvalAt: at }),
};

const TEXT_FIELDS = [
  'selfComment',
  'leadComment',
  'strengths',
  'improvements',
  'goals',
  'calibrationNote',
  'newDesignation',
  'trainingPlan',
  'deptHeadComment',
  'hrComment',
  'approvalComment',
] as const;

/** A launch candidate as the schedule sees it. */
type SchedulePerson = Omit<
  CandidateRow,
  | 'joinDate'
  | 'confirmationDate'
  | 'probationStartDate'
  | 'internshipEndDate'
  | 'events'
> &
  OverdueEmployee;

const dueRow = (e: SchedulePerson, due: ClassifiedDue): DueEmployeeRow => ({
  employeeId: e.id,
  fullName: e.fullName,
  designation: e.designation,
  teamName: e.team?.name ?? null,
  status: e.status,
  joinDate: e.joinDate,
  type: due.type,
  dueDate: due.dueDate,
  periodStart: due.periodStart,
  periodEnd: due.periodEnd,
  daysLate: due.daysLate,
  daysEarly: due.daysEarly,
});

const byDueThenName = (a: DueEmployeeRow, b: DueEmployeeRow) =>
  a.dueDate !== b.dueDate
    ? a.dueDate < b.dueDate
      ? -1
      : 1
    : a.fullName.localeCompare(b.fullName);

export interface FormPdf {
  fileName: string;
  buffer: Buffer;
}

/**
 * Appraisal cycles and the review workflow. Owner/Admin only (enforced by the
 * controller). Every lookup is org-scoped through the cycle; a foreign id is a
 * 404, never a 403 that would confirm it exists. KPIs come from the slice-1
 * code via `PeopleSummaryService.kpisForPeriod`, never typed.
 *
 * FORM_100 cycles follow the paper form: the 100-mark total and A-F grade are
 * the official result and the KPI score is a separate reference number. The
 * step sequence and the fields each step accepts depend on the cycle's mode.
 */
@Injectable()
export class AppraisalsService {
  private readonly logger = new Logger(AppraisalsService.name);

  constructor(
    private readonly repo: AppraisalsRepository,
    private readonly summaries: PeopleSummaryService,
    private readonly employees: EmployeesService,
    private readonly documents: DocumentsService,
  ) {}

  // --- cycles -------------------------------------------------------------

  async listCycles(orgId: string): Promise<CycleView[]> {
    const rows = await this.repo.listCycles(orgId);
    const counts = await this.countsFor(rows.map((r) => r.id));
    return rows.map((r) => toCycleView(r, counts.get(r.id) ?? emptyCounts()));
  }

  async getCycle(orgId: string, id: string): Promise<CycleView> {
    return this.cycleView(await this.requireCycle(orgId, id));
  }

  async createCycle(
    principal: AuthPrincipal,
    dto: CreateCycleDto,
  ): Promise<CycleView> {
    const scoringMode = dto.scoringMode ?? DEFAULT_SCORING_MODE;
    const type = dto.type ?? 'YEARLY';
    const periodBasis = dto.periodBasis ?? 'JOIN_DATE';
    this.assertTypeFits(type, scoringMode, periodBasis);
    const competencies = dto.competencies ?? defaultCriteria(scoringMode, type);
    this.assertPeriod(dto.periodStart, dto.periodEnd);
    this.assertCompetencies(competencies);
    const row = await this.repo.createCycle({
      orgId: principal.orgId,
      name: dto.name.trim(),
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      // The form never blends the KPIs in; its weight is meaningless and stored as 0.
      kpiWeight:
        scoringMode === 'FORM_100' ? 0 : (dto.kpiWeight ?? DEFAULT_KPI_WEIGHT),
      competencies,
      type,
      scoringMode,
      periodBasis,
      createdBy: actorId(principal),
    });
    return toCycleView(row, emptyCounts());
  }

  async updateCycle(
    orgId: string,
    id: string,
    dto: UpdateCycleDto,
  ): Promise<CycleView> {
    const cycle = await this.requireCycle(orgId, id);
    const view = await this.cycleView(cycle);

    const periodStart = dto.periodStart ?? view.periodStart;
    const periodEnd = dto.periodEnd ?? view.periodEnd;
    this.assertPeriod(periodStart, periodEnd);
    if (dto.competencies) this.assertCompetencies(dto.competencies);
    this.assertTypeFits(
      dto.type ?? view.type,
      view.scoringMode,
      dto.periodBasis ?? view.periodBasis,
    );

    // Weights, period, its basis, type and competencies decide every score in
    // the cycle: once appraisals exist they can no longer move underneath them.
    const structural =
      periodStart !== view.periodStart ||
      periodEnd !== view.periodEnd ||
      (dto.type !== undefined && dto.type !== view.type) ||
      (dto.periodBasis !== undefined && dto.periodBasis !== view.periodBasis) ||
      (dto.kpiWeight !== undefined && dto.kpiWeight !== view.kpiWeight) ||
      (dto.competencies !== undefined &&
        JSON.stringify(dto.competencies) !== JSON.stringify(view.competencies));
    if (structural && view.counts.total > 0) {
      throw new ConflictException(
        'The period, its basis, type, KPI weight and competencies are locked once appraisals have been launched',
      );
    }
    if (dto.status && !cycleStatusAllowed(cycle.status, dto.status)) {
      throw new BadRequestException(
        `A ${cycle.status} cycle cannot become ${dto.status}`,
      );
    }

    const row = await this.repo.updateCycle(id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(structural
        ? {
            periodStart,
            periodEnd,
            ...(dto.type !== undefined ? { type: dto.type } : {}),
            ...(dto.periodBasis !== undefined
              ? { periodBasis: dto.periodBasis }
              : {}),
            ...(dto.kpiWeight !== undefined && cycle.scoringMode === 'KPI_BLEND'
              ? { kpiWeight: dto.kpiWeight }
              : {}),
            ...(dto.competencies ? { competencies: dto.competencies } : {}),
          }
        : {}),
      ...(dto.status ? { status: dto.status } : {}),
    });
    return this.cycleView(row);
  }

  async launch(
    orgId: string,
    id: string,
    dto: LaunchCycleDto,
  ): Promise<LaunchResult> {
    const cycle = await this.requireCycle(orgId, id);
    if (cycle.status === 'CLOSED')
      throw new ConflictException('This cycle is closed; reopen it to launch');
    if (dto.employeeIds && dto.employeeIds.length === 0)
      throw new BadRequestException('Select at least one employee');

    const periodEnd = dateColumnToIso(cycle.periodEnd);
    const wanted = dto.employeeIds ? [...new Set(dto.employeeIds)] : undefined;
    const candidates = await this.repo.launchCandidates(
      orgId,
      periodEnd,
      wanted,
    );
    if (wanted && candidates.length !== wanted.length)
      throw new BadRequestException('Unknown employee in the selection');

    const { eligible, notDue } =
      basisOf(cycle) === 'JOIN_DATE'
        ? await this.joinDateSelection(orgId, cycle, candidates, !!wanted)
        : {
            eligible: candidates.map(
              (c): LaunchCandidate => ({ id: c.id, managerId: c.managerId }),
            ),
            notDue: [] as LaunchNotDue[],
          };
    if (basisOf(cycle) === 'JOIN_DATE' && eligible.length === 0) {
      throw new BadRequestException(
        !wanted
          ? 'Nobody is due an appraisal of this type in this window'
          : notDue.length > 0 &&
              notDue.every((n) => n.reason === 'ALREADY_APPRAISED')
            ? 'Everyone selected already has an appraisal for that due date'
            : 'None of the selected employees has an appraisal of this type due by the end of the window',
      );
    }

    let rows: LaunchCandidate[] = eligible;
    if (cycle.scoringMode === 'FORM_100') {
      const [sources, companyName] = await Promise.all([
        this.repo.headerSources(
          orgId,
          eligible.map((c) => c.id),
        ),
        this.repo.organisationName(orgId),
      ]);
      const byId = new Map(sources.map((s) => [s.id, s]));
      rows = eligible.map((c) => {
        const src = byId.get(c.id);
        return {
          ...c,
          formHeader: src
            ? this.header(src, companyName, c.period?.dueDate ?? null)
            : null,
        };
      });
    }

    const created = await this.repo.createAppraisals(id, rows);
    return {
      cycle: await this.getCycle(orgId, id),
      created,
      // Only the employees actually attempted; the not-due ones are reported separately.
      skipped: eligible.length - created,
      notDue,
    };
  }

  /**
   * Who a `type` cycle due in [from, to] would cover, in three groups: due
   * in the window, overdue (the latest missed due date before it) and coming
   * up (due within `UPCOMING_DAYS` after it). Anyone whose due date already
   * has an appraisal in any cycle is left out. The default launch of a
   * JOIN_DATE cycle over the window takes `due` and `overdue`, from the same
   * selector.
   */
  async dueEmployees(orgId: string, q: DueQuery): Promise<DueGroupsView> {
    this.assertPeriod(q.from, q.to);
    const today = this.today();
    // Upcoming reaches past the window, so take anyone who joined by then.
    const people = await this.schedulePeople(
      orgId,
      await this.repo.launchCandidates(orgId, addDays(q.to, UPCOMING_DAYS)),
    );
    const groups = selectDue(people, q.type, { from: q.from, to: q.to, today });
    const rows = (list: { employee: SchedulePerson; due: ClassifiedDue }[]) =>
      list.map((x) => dueRow(x.employee, x.due)).sort(byDueThenName);
    return {
      due: rows(groups.due),
      overdue: rows(groups.overdue),
      upcoming: rows(groups.upcoming),
    };
  }

  /**
   * Everyone overdue for any appraisal type as of today (`overdueAppraisals`):
   * the confirmation while on probation, else the latest missed half-yearly
   * or yearly within the lookback. Oldest due date first.
   */
  async overdueEmployees(orgId: string): Promise<DueEmployeeRow[]> {
    const today = this.today();
    const people = await this.schedulePeople(
      orgId,
      await this.repo.launchCandidates(orgId, today),
    );
    return people
      .flatMap((e) => overdueAppraisals(e, today).map((d) => dueRow(e, d)))
      .sort(byDueThenName);
  }

  /** Candidates with their join and confirmation dates and every appraisal they already have. */
  private async schedulePeople(
    orgId: string,
    candidates: CandidateRow[],
  ): Promise<SchedulePerson[]> {
    const records = await this.recordsByEmployee(
      orgId,
      candidates.map((c) => c.id),
    );
    return candidates.map(
      ({
        joinDate,
        confirmationDate,
        probationStartDate,
        internshipEndDate,
        events,
        ...c
      }) => ({
        ...c,
        ...scheduleFieldsOf({
          joinDate,
          status: c.status,
          probationStartDate,
          internshipEndDate,
          events,
        }),
        confirmationDate: confirmationDate
          ? dateColumnToIso(confirmationDate)
          : null,
        appraisals: records.get(c.id) ?? [],
      }),
    );
  }

  private async recordsByEmployee(
    orgId: string,
    employeeIds: string[],
  ): Promise<Map<string, AppraisalOnRecord[]>> {
    const out = new Map<string, AppraisalOnRecord[]>();
    for (const r of await this.repo.appraisalsOnRecord(orgId, employeeIds)) {
      const list = out.get(r.employeeId) ?? [];
      list.push({
        type: r.type,
        dueDate: r.dueDate ? dateColumnToIso(r.dueDate) : null,
        periodEnd: dateColumnToIso(r.periodEnd),
      });
      out.set(r.employeeId, list);
    }
    return out;
  }

  /**
   * JOIN_DATE launch. Default: everyone due in the cycle's window and
   * everyone overdue (`selectDue`); the coming-up group only when picked.
   * Explicit selection, per employee: due in the window, else overdue, else
   * coming up, else the latest due date on or before the window's end (a
   * late appraisal outside the overdue rules); for a confirmation the
   * employee need not still be on probation. Exited employees, anyone with no
   * due date yet, and anyone whose due date already has an appraisal in any
   * cycle are left out and reported; so are a non-intern picked for an
   * internship review and an intern picked for any other review.
   */
  private async joinDateSelection(
    orgId: string,
    cycle: CycleRow,
    candidates: CandidateRow[],
    explicit: boolean,
  ): Promise<{ eligible: LaunchCandidate[]; notDue: LaunchNotDue[] }> {
    const from = dateColumnToIso(cycle.periodStart);
    const to = dateColumnToIso(cycle.periodEnd);
    const today = this.today();
    const people = await this.schedulePeople(orgId, candidates);
    const toCandidate = (
      c: SchedulePerson,
      due: DueAppraisal,
    ): LaunchCandidate => ({
      id: c.id,
      managerId: c.managerId,
      period: {
        periodStart: due.periodStart,
        periodEnd: due.periodEnd,
        dueDate: due.dueDate,
      },
    });

    if (!explicit) {
      const g = selectDue(people, cycle.type, { from, to, today });
      return {
        eligible: [...g.due, ...g.overdue].map((x) =>
          toCandidate(x.employee, x.due),
        ),
        notDue: [],
      };
    }
    const eligible: LaunchCandidate[] = [];
    const notDue: LaunchNotDue[] = [];
    for (const c of people) {
      const stage: LaunchNotDue['reason'] | null =
        c.status === 'EXITED'
          ? 'EXITED'
          : cycle.type === 'INTERNSHIP' && c.status !== 'INTERN'
            ? 'NOT_AN_INTERN'
            : cycle.type !== 'INTERNSHIP' && c.status === 'INTERN'
              ? 'STILL_INTERN'
              : null;
      if (stage) {
        notDue.push({
          employeeId: c.id,
          employeeName: c.fullName,
          reason: stage,
          firstDueDate: null,
        });
        continue;
      }
      const due =
        classifyDue(c, cycle.type, { from, to, today }) ??
        dueOnOrBeforeFor(c, cycle.type, to);
      if (!due) {
        notDue.push({
          employeeId: c.id,
          employeeName: c.fullName,
          reason: 'NOT_YET_DUE',
          firstDueDate: firstDueFor(c, cycle.type),
        });
        continue;
      }
      if (isDueCovered(c, cycle.type, due.dueDate)) {
        notDue.push({
          employeeId: c.id,
          employeeName: c.fullName,
          reason: 'ALREADY_APPRAISED',
          firstDueDate: null,
          dueDate: due.dueDate,
        });
        continue;
      }
      eligible.push(toCandidate(c, due));
    }
    return { eligible, notDue };
  }

  // --- appraisals ---------------------------------------------------------

  async listAppraisals(
    orgId: string,
    cycleId: string,
  ): Promise<AppraisalListRow[]> {
    await this.requireCycle(orgId, cycleId);
    const today = this.today();
    return (await this.repo.listByCycle(orgId, cycleId)).map((r) =>
      toListRow(r, today),
    );
  }

  async getAppraisal(orgId: string, id: string): Promise<AppraisalView> {
    return this.view(await this.requireAppraisal(orgId, id));
  }

  async employeeAppraisals(
    orgId: string,
    employeeId: string,
  ): Promise<EmployeeAppraisalRow[]> {
    await this.employees.getProfile(orgId, employeeId); // 404 for a foreign id
    const today = this.today();
    return (await this.repo.listForEmployee(orgId, employeeId)).map((r) =>
      toEmployeeRow(r, today),
    );
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateAppraisalDto,
  ): Promise<AppraisalView> {
    const row = await this.requireOpen(orgId, id);
    const mode = modeOf(row);
    const keys = competenciesOf(row.cycle).map((c) => c.key);
    const allowed = new Set<AppraisalEditableField>(
      editableFields(row.status, flowOfRow(row)),
    );

    const sent = (Object.keys(dto) as AppraisalEditableField[]).filter(
      (k) => dto[k] !== undefined,
    );
    const blocked = sent.filter((k) => !allowed.has(k));
    if (blocked.length > 0) {
      throw new BadRequestException(
        row.status === 'SIGNED_OFF'
          ? 'This appraisal is signed off and read-only'
          : `${blocked.join(', ')} cannot be edited during ${row.status}`,
      );
    }

    const data: Prisma.AppraisalUpdateManyMutationInput = {};
    for (const field of ['selfRatings', 'leadRatings'] as const) {
      if (dto[field] === undefined) continue;
      const parsed = parseRatings(dto[field], keys, mode);
      if (!parsed.ok) throw new BadRequestException(parsed.error);
      data[field] = parsed.value;
    }
    for (const field of TEXT_FIELDS) {
      if (dto[field] !== undefined) data[field] = clean(dto[field]);
    }
    if (dto.recommendation !== undefined) {
      data.recommendation = dto.recommendation;
      // A designation only means something for a promotion; don't leave a stale one behind.
      if (dto.recommendation !== 'PROMOTE' && dto.newDesignation === undefined)
        data.newDesignation = null;
    }
    if (dto.actions !== undefined) {
      const actions = [...new Set(dto.actions)] as AppraisalActionValue[];
      data.actions = actions;
      // Same rule for the form: no promotion, no new designation; no increment, no percent.
      if (!actions.includes('PROMOTION') && dto.newDesignation === undefined)
        data.newDesignation = null;
      if (!actions.includes('INCREMENT') && dto.incrementPercent === undefined)
        data.incrementPercent = null;
    }
    if (dto.incrementPercent !== undefined) {
      if (
        dto.incrementPercent !== null &&
        !isValidIncrementPercent(dto.incrementPercent)
      )
        throw new BadRequestException(
          'incrementPercent must be between 0 and 100',
        );
      data.incrementPercent = dto.incrementPercent;
    }
    if (dto.approvalDecision !== undefined)
      data.approvalDecision = dto.approvalDecision;
    Object.assign(data, this.internshipChanges(row, dto));
    Object.assign(data, await this.dateChanges(row, dto));
    Object.assign(data, this.effectiveDateChanges(row, dto, data));
    if (dto.calibratedScore !== undefined) {
      if (
        dto.calibratedScore !== null &&
        !isValidCalibratedScore(dto.calibratedScore)
      )
        throw new BadRequestException(
          'calibratedScore must be between 0 and 5',
        );
      data.calibratedScore = dto.calibratedScore;
    }

    if (Object.keys(data).length > 0) {
      if (!(await this.repo.updateIf(id, row.status, data)))
        throw this.changedUnderneath();
    }
    return this.getAppraisal(orgId, id);
  }

  /**
   * Forward one step, recording who completed the step being left. Entering
   * LEAD_REVIEW snapshots the KPIs. FORM_100 refreshes the form header on
   * every step. Signing off freezes the score (and grade, and header) and
   * applies the outcome exactly once; for FORM_100 it then files the form as
   * a PDF, best-effort. Calling it again on a signed-off appraisal is a no-op,
   * or finishes an outcome or a PDF that never landed; never a second event.
   */
  async advance(principal: AuthPrincipal, id: string): Promise<AppraisalView> {
    const orgId = principal.orgId;
    const row = await this.requireAppraisal(orgId, id);
    const mode = modeOf(row);
    const flow = flowOfRow(row);

    if (row.status === 'SIGNED_OFF') {
      if (signOffAction(row) === 'apply-outcome')
        await this.applyOutcome(principal, row);
      if (mode === 'FORM_100' && !row.formDocumentId)
        await this.fileFormPdf(principal, id);
      return this.getAppraisal(orgId, id);
    }
    this.assertOpen(row);

    const blockers = blockersOf(row);
    if (blockers.length > 0) throw new BadRequestException(blockers.join('; '));
    const next = nextStatus(row.status, flow);
    if (!next) throw new BadRequestException('Nothing follows sign-off');

    const now = new Date();
    const data: Prisma.AppraisalUpdateManyMutationInput = {
      status: next,
      ...(STEP_STAMP[row.status]?.(actorId(principal), now) ?? {}),
    };
    if (next === 'LEAD_REVIEW') {
      const snapshot = await this.snapshot(row);
      data.kpiSnapshot = snapshot as unknown as Prisma.InputJsonValue;
      data.kpiSnapshotAt = new Date(snapshot.computedAt);
    }
    if (mode === 'FORM_100') {
      // On sign-off this is the last refresh: the header is frozen as it stood
      // before any increment or promotion below is applied.
      data.formHeader = (await this.liveHeader(
        row,
      )) as unknown as Prisma.InputJsonValue;
    }
    if (next === 'SIGNED_OFF') {
      data.signedOffAt = now;
      data.signedOffBy = actorId(principal);
      // Resolved once, here, and stored: the outcome (and any retry of it) uses this date.
      const period = periodOf(row);
      const effective =
        flow === 'INTERNSHIP'
          ? this.internshipEffectiveDate(row)
          : resolveEffectiveDate({
              scoringMode: mode,
              mode: (row.effectiveDateMode ??
                null) as AppraisalEffectiveDateValue | null,
              customDate: row.effectiveDate
                ? dateColumnToIso(row.effectiveDate)
                : null,
              dueDate: period.dueDate,
              periodStart: period.periodStart,
              approvalDate: this.today(),
            });
      if (!effective.ok) throw new BadRequestException(effective.error);
      data.effectiveDateMode = effective.mode;
      data.effectiveDate = isoToDateColumn(effective.date);
      if (mode === 'FORM_100') {
        const keys = competenciesOf(row.cycle).map((c) => c.key);
        const f = formScore(cleanRatings(row.leadRatings, keys, mode), keys);
        data.finalScore = f.total;
        data.finalGrade = f.grade;
        data.finalPartial = false;
      } else {
        const score = scoreOf(row);
        data.finalScore = score.final;
        data.finalPartial = score.partial;
      }
    }

    if (!(await this.repo.updateIf(id, row.status, data)))
      throw this.changedUnderneath();
    if (next === 'SIGNED_OFF') {
      // The status flip above is the claim: only the caller that won it gets here.
      // Apply from the row as signed off (its frozen header), exactly as a retry would.
      await this.applyOutcome(
        principal,
        await this.requireAppraisal(orgId, id),
      );
      if (mode === 'FORM_100') await this.fileFormPdf(principal, id);
    }
    return this.getAppraisal(orgId, id);
  }

  /** Back one step for corrections. Not from the first step, never after sign-off. */
  async sendBack(orgId: string, id: string): Promise<AppraisalView> {
    const row = await this.requireOpen(orgId, id);
    const prev = previousStatus(row.status, flowOfRow(row));
    if (!prev) {
      throw new BadRequestException(
        row.status === 'SIGNED_OFF'
          ? 'A signed-off appraisal cannot be sent back'
          : 'The self review is the first step',
      );
    }
    if (!(await this.repo.updateIf(id, row.status, { status: prev })))
      throw this.changedUnderneath();
    return this.getAppraisal(orgId, id);
  }

  /** Recompute the KPI snapshot (and, for the form, its header) from today's data. Frozen once signed off. */
  async refreshKpis(orgId: string, id: string): Promise<AppraisalView> {
    const row = await this.requireOpen(orgId, id);
    if (row.status === 'SIGNED_OFF')
      throw new ConflictException('The KPI snapshot is frozen at sign-off');
    const snapshot = await this.snapshot(row);
    if (
      !(await this.repo.updateIf(id, row.status, {
        kpiSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        kpiSnapshotAt: new Date(snapshot.computedAt),
        ...(modeOf(row) === 'FORM_100'
          ? {
              formHeader: (await this.liveHeader(
                row,
              )) as unknown as Prisma.InputJsonValue,
            }
          : {}),
      }))
    )
      throw this.changedUnderneath();
    return this.getAppraisal(orgId, id);
  }

  /**
   * The filled form as a PDF. Before sign-off it is a preview (not stored) of
   * the form as it stands; after sign-off it is rendered from the frozen
   * score, grade and header. FORM_100 cycles only.
   */
  async formPdf(orgId: string, id: string): Promise<FormPdf> {
    const row = await this.requireAppraisal(orgId, id);
    if (modeOf(row) !== 'FORM_100')
      throw new BadRequestException(
        'Only appraisals on the paper form have a printable form',
      );
    return this.renderFormPdf(row);
  }

  // --- internals ----------------------------------------------------------

  /** Today's Dhaka date. One place, so tests can pin the clock. */
  protected today(): string {
    return dhakaDateOf(new Date());
  }

  /**
   * An edit of the appraisal's own due date and review period (any step
   * before sign-off). The partial edit is merged with what is stored and
   * validated as a whole (`dateEditError`); a due date may not move onto a
   * milestone another appraisal of the employee already covers. When the
   * period changes and a KPI snapshot exists, it is recomputed over the new
   * period in the same write (and, for the form, the header, whose
   * experience is measured to the due date). Returns the columns to write.
   */
  private async dateChanges(
    row: AppraisalRow,
    dto: UpdateAppraisalDto,
  ): Promise<Prisma.AppraisalUpdateManyMutationInput> {
    if (
      dto.dueDate === undefined &&
      dto.periodStart === undefined &&
      dto.periodEnd === undefined
    )
      return {};
    const current = periodOf(row);
    const next = {
      periodStart: dto.periodStart ?? current.periodStart,
      periodEnd: dto.periodEnd ?? current.periodEnd,
      dueDate: dto.dueDate ?? current.dueDate,
    };
    const joinDate = dateColumnToIso(row.employee.joinDate);
    const error = dateEditError({ joinDate, ...next });
    if (error) throw new BadRequestException(error);

    if (next.dueDate && next.dueDate !== current.dueDate) {
      const others = [
        ...(await this.repo.listForEmployee(row.cycle.orgId, row.employeeId))
          .filter((a) => a.id !== row.id)
          .map(
            (a): AppraisalOnRecord => ({
              type: a.cycle.type,
              dueDate: a.dueDate ? dateColumnToIso(a.dueDate) : null,
              periodEnd: periodOf(a).periodEnd,
            }),
          ),
        // A paper appraisal already stands for its due date too (0035).
        ...(await this.repo.pastAppraisalsOnRecord(row.employeeId)).map((p) =>
          pastAppraisalOnRecord({
            type: p.type,
            dueDate: p.dueDate ? dateColumnToIso(p.dueDate) : null,
            conductedOn: dateColumnToIso(p.conductedOn),
          }),
        ),
      ];
      const type = row.cycle.type as AppraisalTypeValue;
      const milestone = dueDateTaken(
        scheduleFieldsOf(row.employee),
        type,
        next.dueDate,
        others,
      );
      if (milestone)
        throw new ConflictException(
          `Another appraisal already covers the ${milestone} due date for this employee`,
        );
    }

    const data: Prisma.AppraisalUpdateManyMutationInput = {
      periodStart: isoToDateColumn(next.periodStart),
      periodEnd: isoToDateColumn(next.periodEnd),
      dueDate: next.dueDate ? isoToDateColumn(next.dueDate) : null,
    };
    const periodMoved =
      next.periodStart !== current.periodStart ||
      next.periodEnd !== current.periodEnd;
    if (periodMoved && row.kpiSnapshot !== null) {
      const snapshot = await this.snapshot(row, next);
      data.kpiSnapshot = snapshot as unknown as Prisma.InputJsonValue;
      data.kpiSnapshotAt = new Date(snapshot.computedAt);
    }
    if (
      modeOf(row) === 'FORM_100' &&
      (periodMoved || next.dueDate !== current.dueDate)
    ) {
      const [sources, companyName] = await Promise.all([
        this.repo.headerSources(row.cycle.orgId, [row.employeeId]),
        this.repo.organisationName(row.cycle.orgId),
      ]);
      if (sources[0])
        data.formHeader = this.header(
          sources[0],
          companyName,
          next.dueDate,
        ) as unknown as Prisma.InputJsonValue;
    }
    return data;
  }

  /**
   * An internship review's recommendation and its date (LEAD_REVIEW). The
   * date fields belong to their recommendation: a date for another one is a
   * 400, and changing the recommendation clears the other date. Choosing
   * MOVE_TO_PROBATION without a date defaults it to the day after the due
   * date. A date that is set is checked now (start on or after joining; an
   * extension later than the current end); completeness is an advance
   * blocker.
   */
  private internshipChanges(
    row: AppraisalRow,
    dto: UpdateAppraisalDto,
  ): Prisma.AppraisalUpdateManyMutationInput {
    if (
      dto.internshipOutcome === undefined &&
      dto.proposedProbationStart === undefined &&
      dto.proposedInternshipEnd === undefined
    )
      return {};
    const ctx = internshipContextOf(row);
    if (!ctx)
      throw new BadRequestException(
        'Only an internship review takes an internship recommendation',
      );
    const outcome =
      dto.internshipOutcome !== undefined
        ? dto.internshipOutcome
        : ((row.internshipOutcome ?? null) as InternshipOutcomeValue | null);
    const stored = (d: Date | null) => (d ? dateColumnToIso(d) : null);
    if (dto.proposedProbationStart && outcome !== 'MOVE_TO_PROBATION')
      throw new BadRequestException(
        'proposedProbationStart is only used with MOVE_TO_PROBATION',
      );
    if (dto.proposedInternshipEnd && outcome !== 'EXTEND_INTERNSHIP')
      throw new BadRequestException(
        'proposedInternshipEnd is only used with EXTEND_INTERNSHIP',
      );
    const probationStart =
      outcome !== 'MOVE_TO_PROBATION'
        ? null
        : dto.proposedProbationStart !== undefined
          ? dto.proposedProbationStart
          : (stored(row.proposedProbationStart) ?? ctx.defaultProbationStart);
    const newEnd =
      outcome !== 'EXTEND_INTERNSHIP'
        ? null
        : dto.proposedInternshipEnd !== undefined
          ? dto.proposedInternshipEnd
          : stored(row.proposedInternshipEnd);
    const joinDate = dateColumnToIso(row.employee.joinDate);
    if (probationStart && probationStart < joinDate)
      throw new BadRequestException(
        'The probation start cannot be before the employee joined',
      );
    if (newEnd && newEnd <= ctx.currentEndDate)
      throw new BadRequestException(
        `The new internship end must be after the current one (${ctx.currentEndDate})`,
      );
    return {
      internshipOutcome: outcome,
      proposedProbationStart: probationStart
        ? isoToDateColumn(probationStart)
        : null,
      proposedInternshipEnd: newEnd ? isoToDateColumn(newEnd) : null,
    };
  }

  /**
   * An internship review's outcome date, stored at sign-off: an approved move
   * to probation takes effect on the chosen probation start; anything else on
   * the sign-off date.
   */
  private internshipEffectiveDate(row: AppraisalRow): {
    ok: true;
    mode: AppraisalEffectiveDateValue;
    date: string;
  } {
    const start = row.proposedProbationStart
      ? dateColumnToIso(row.proposedProbationStart)
      : null;
    return row.approvalDecision === 'APPROVED' &&
      row.internshipOutcome === 'MOVE_TO_PROBATION' &&
      start
      ? { ok: true, mode: 'CUSTOM', date: start }
      : { ok: true, mode: 'APPROVAL_DATE', date: this.today() };
  }

  /**
   * The effective-date choice at final approval. Choosing DUE_DATE or
   * APPROVAL_DATE clears a custom date; a date may only be sent with (or
   * kept by) CUSTOM; CUSTOM needs a date on or after the review period start
   * (checked against the period as this same request leaves it).
   */
  private effectiveDateChanges(
    row: AppraisalRow,
    dto: UpdateAppraisalDto,
    pending: Prisma.AppraisalUpdateManyMutationInput,
  ): Prisma.AppraisalUpdateManyMutationInput {
    if (dto.effectiveDateMode === undefined && dto.effectiveDate === undefined)
      return {};
    const mode =
      dto.effectiveDateMode !== undefined
        ? dto.effectiveDateMode
        : ((row.effectiveDateMode ??
            null) as AppraisalEffectiveDateValue | null);
    const stored = row.effectiveDate
      ? dateColumnToIso(row.effectiveDate)
      : null;
    const date = dto.effectiveDate !== undefined ? dto.effectiveDate : stored;
    if (mode !== 'CUSTOM' && dto.effectiveDate)
      throw new BadRequestException(
        'effectiveDate is only used with effectiveDateMode CUSTOM',
      );
    const period = periodOf(row);
    const periodStart =
      pending.periodStart instanceof Date
        ? dateColumnToIso(pending.periodStart)
        : period.periodStart;
    const dueDate =
      pending.dueDate !== undefined
        ? pending.dueDate instanceof Date
          ? dateColumnToIso(pending.dueDate)
          : null
        : period.dueDate;
    const error = effectiveDateError({
      mode,
      customDate: mode === 'CUSTOM' ? date : null,
      dueDate,
      periodStart,
    });
    if (error) throw new BadRequestException(error);
    return {
      effectiveDateMode: mode,
      effectiveDate: mode === 'CUSTOM' && date ? isoToDateColumn(date) : null,
    };
  }

  private async renderFormPdf(row: AppraisalRow): Promise<FormPdf> {
    const view = await this.view(row);
    // Signed off: the frozen header. Open: the header as it would be captured now.
    const header =
      row.status === 'SIGNED_OFF'
        ? (headerOf(row) ?? (await this.liveHeader(row)))
        : await this.liveHeader(row);
    const buffer = await renderAppraisalFormPdf({
      view,
      header,
      signedOn: signedOnOf(row),
      generatedOn: dhakaDateOf(new Date()),
    });
    return { fileName: formPdfFileName(view), buffer };
  }

  /**
   * Files the signed-off form as an APPRAISAL employee document. Best-effort:
   * sign-off has already happened and must not fail because documents are not
   * configured or the store is down. The next `advance` retries a missing one.
   * Regenerating versions this appraisal's own document, never another cycle's.
   */
  private async fileFormPdf(
    principal: AuthPrincipal,
    id: string,
  ): Promise<void> {
    if (!this.documents.enabled) return;
    try {
      const row = await this.requireAppraisal(principal.orgId, id);
      const pdf = await this.renderFormPdf(row);
      const stored = await this.documents.storeGenerated(
        principal,
        row.employeeId,
        {
          category: 'APPRAISAL',
          docType: 'APPRAISAL_FORM',
          fileName: pdf.fileName,
          buffer: pdf.buffer,
          replaces: row.formDocumentId,
        },
      );
      await this.repo.setFormDocument(id, stored.id);
    } catch (e) {
      // Never log the form itself: it carries salaries.
      this.logger.warn(
        `Could not file the appraisal form PDF for appraisal ${id}: ${(e as Error).message}`,
      );
    }
  }

  /** The form header as it would be captured right now. */
  private async liveHeader(row: AppraisalRow): Promise<FormHeader> {
    const orgId = row.cycle.orgId;
    const [sources, companyName] = await Promise.all([
      this.repo.headerSources(orgId, [row.employeeId]),
      this.repo.organisationName(orgId),
    ]);
    if (!sources[0]) throw new NotFoundException('Employee not found');
    return this.header(sources[0], companyName, periodOf(row).dueDate);
  }

  /** `asOf`: a join-date appraisal's due date; experience is measured to it rather than today. */
  private header(
    src: HeaderSourceRow,
    companyName: string,
    asOf: string | null = null,
  ): FormHeader {
    const now = new Date();
    return buildFormHeader({
      asOf,
      employee: {
        fullName: src.fullName,
        concernName: src.concernName,
        designation: src.designation,
        department: src.department,
        joinDate: dateColumnToIso(src.joinDate),
        exitDate: src.exitDate ? dateColumnToIso(src.exitDate) : null,
        academicQualification: src.academicQualification,
        experienceBeforeJoiningMonths: src.experienceBeforeJoiningMonths,
        startingSalary: src.startingSalary,
        grossSalary: src.grossSalary,
      },
      events: src.events.map((e) => ({
        type: e.type,
        effectiveDate: dateColumnToIso(e.effectiveDate),
        fromValue: e.fromValue,
        toValue: e.toValue,
      })),
      companyName,
      today: dhakaDateOf(now),
      capturedAt: now.toISOString(),
    });
  }

  /**
   * KPIs over the appraisal's review period (its own for a join-date cycle,
   * else the cycle's), clipped to today so future days don't count as available.
   */
  private async snapshot(
    row: AppraisalRow,
    period: { periodStart: string; periodEnd: string } = periodOf(row),
  ): Promise<KpiSnapshot> {
    const today = this.today();
    const { periodStart: from, periodEnd: end } = period;
    let to = end < today ? end : today;
    if (to < from) to = from;
    const c = await this.summaries.kpisForPeriod(
      row.cycle.orgId,
      row.employeeId,
      { from, to },
    );
    return {
      period: { from, to },
      computedAt: new Date().toISOString(),
      kpis: c.kpis,
      overall: c.overall,
    };
  }

  /**
   * Writes the outcome to the employment timeline and records that it
   * happened. The appraisal is already SIGNED_OFF; if the write throws,
   * `outcomeAppliedAt` stays null and the next `advance` finishes the job.
   *
   * KPI_BLEND: one event from the single recommendation (PROMOTED also moves
   * the designation). FORM_100: only when the CTO/COO APPROVED, the CONFIRMED /
   * PROMOTED / INCREMENT events in ONE transaction, so a retry never writes
   * half of them twice. NOT_APPROVED signs off with no outcome. The increment
   * is computed on the gross salary in the header frozen at sign-off, never
   * the employee's current one: if the events landed but the "applied" mark
   * did not, a retry must not raise an already-raised salary again.
   */
  private async applyOutcome(
    principal: AuthPrincipal,
    row: AppraisalRow,
  ): Promise<void> {
    // The date resolved and stored at sign-off; a retry on a later day writes the same one.
    const effectiveDate =
      effectiveOf(row, this.today())?.date ??
      dhakaDateOf(row.signedOffAt ?? new Date());
    const internship = internshipContextOf(row);
    if (internship) {
      const plan = internshipOutcomePlan({
        decision: row.approvalDecision,
        outcome: (row.internshipOutcome ??
          null) as InternshipOutcomeValue | null,
        probationStart: row.proposedProbationStart
          ? dateColumnToIso(row.proposedProbationStart)
          : null,
        newEndDate: row.proposedInternshipEnd
          ? dateColumnToIso(row.proposedInternshipEnd)
          : null,
        employeeStatus: row.employee.status,
        currentEndDate: internship.currentEndDate,
        cycleName: row.cycle.name,
        effectiveDate,
      });
      if (plan.events.length > 0)
        await this.employees.recordAppraisalOutcome(
          principal,
          row.employeeId,
          plan.events.map((e) => ({
            type: e.type,
            effectiveDate: e.effectiveDate,
            ...(e.fromValue !== undefined ? { fromValue: e.fromValue } : {}),
            toValue: e.toValue,
            notes: e.notes,
          })),
          row.id,
        );
    } else if (modeOf(row) === 'FORM_100') {
      const plan = formOutcomePlan({
        decision: row.approvalDecision,
        actions: (row.actions ?? []) as AppraisalActionValue[],
        newDesignation: row.newDesignation,
        incrementPercent: row.incrementPercent,
        grossSalary: headerOf(row)?.grossSalary ?? row.employee.grossSalary,
        employeeStatus: row.employee.status,
        cycleName: row.cycle.name,
        effectiveDate,
      });
      if (plan.events.length > 0) {
        await this.employees.recordAppraisalOutcome(
          principal,
          row.employeeId,
          plan.events.map((e) => ({
            type: e.type,
            effectiveDate: e.effectiveDate,
            ...(e.fromValue !== undefined ? { fromValue: e.fromValue } : {}),
            toValue: e.toValue,
            notes: e.notes,
          })),
          row.id,
        );
      }
    } else {
      const plan = outcomePlan({
        recommendation: row.recommendation,
        newDesignation: row.newDesignation,
        cycleName: row.cycle.name,
        effectiveDate,
      });
      if (plan) {
        await this.employees.addEvent(principal, row.employeeId, {
          type: plan.type as 'PROMOTED' | 'NOTE',
          effectiveDate: plan.effectiveDate,
          toValue: plan.toValue ?? undefined,
          notes: plan.notes,
        });
      }
    }
    await this.repo.markOutcomeApplied(row.id);
  }

  private async view(row: AppraisalRow): Promise<AppraisalView> {
    const [counts, history, names] = await Promise.all([
      this.countsFor([row.cycleId]),
      this.repo.listForEmployee(row.cycle.orgId, row.employeeId),
      this.repo.userNames(stepActorIds(row)),
    ]);
    const today = this.today();
    return toAppraisalView(
      row,
      counts.get(row.cycleId) ?? emptyCounts(),
      history
        .filter((h) => h.id !== row.id)
        .map((h) => toEmployeeRow(h, today)),
      names,
      today,
    );
  }

  private async cycleView(row: CycleRow): Promise<CycleView> {
    const counts = await this.countsFor([row.id]);
    return toCycleView(row, counts.get(row.id) ?? emptyCounts());
  }

  private async countsFor(
    cycleIds: string[],
  ): Promise<Map<string, CycleCounts>> {
    const out = new Map<string, CycleCounts>();
    for (const r of await this.repo.statusCounts(cycleIds)) {
      const c = out.get(r.cycleId) ?? emptyCounts();
      c[r.status] += r.count;
      c.total += r.count;
      out.set(r.cycleId, c);
    }
    return out;
  }

  private async requireCycle(orgId: string, id: string): Promise<CycleRow> {
    const row = await this.repo.findCycle(orgId, id);
    if (!row) throw new NotFoundException('Appraisal cycle not found');
    return row;
  }

  private async requireAppraisal(
    orgId: string,
    id: string,
  ): Promise<AppraisalRow> {
    const row = await this.repo.findAppraisal(orgId, id);
    if (!row) throw new NotFoundException('Appraisal not found');
    return row;
  }

  private async requireOpen(orgId: string, id: string): Promise<AppraisalRow> {
    const row = await this.requireAppraisal(orgId, id);
    this.assertOpen(row);
    return row;
  }

  /** Every appraisal write goes through here: the cycle must be open and the employee still here. */
  private assertOpen(row: AppraisalRow): void {
    assertNotExited(row.employee);
    if (row.cycle.status !== 'OPEN')
      throw new ConflictException(
        'This cycle is not open; reopen it to make changes',
      );
  }

  private assertPeriod(start: string, end: string): void {
    if (start > end)
      throw new BadRequestException(
        'periodStart must be on or before periodEnd',
      );
    if (start < addDays(end, -800))
      throw new BadRequestException(
        'A cycle cannot span more than about two years',
      );
  }

  /** An internship review is on the form and counted from each intern's own dates. */
  private assertTypeFits(
    type: AppraisalTypeValue,
    scoringMode: ScoringModeValue,
    periodBasis: AppraisalPeriodBasisValue,
  ): void {
    if (type !== 'INTERNSHIP') return;
    if (scoringMode !== 'FORM_100')
      throw new BadRequestException(
        'An internship review is scored on the form (scoringMode FORM_100)',
      );
    if (periodBasis !== 'JOIN_DATE')
      throw new BadRequestException(
        'An internship review is counted from each intern’s own dates (periodBasis JOIN_DATE)',
      );
  }

  private assertCompetencies(
    list: { key: string; label: string; description?: string }[],
  ): void {
    const error = validateCompetencies(list);
    if (error) throw new BadRequestException(error);
  }

  private changedUnderneath(): ConflictException {
    return new ConflictException(
      'This appraisal was changed by someone else; reload and try again',
    );
  }
}
