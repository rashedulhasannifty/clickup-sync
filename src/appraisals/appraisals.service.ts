import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthPrincipal } from '../auth/auth.types';
import { EmployeesService } from '../people/employees.service';
import { assertNotExited } from '../people/employee-readonly';
import { addDays, dateColumnToIso, dhakaDateOf } from '../people/people-dates';
import { PeopleSummaryService } from '../people/people-summary.service';
import {
  cycleStatusAllowed,
  DEFAULT_COMPETENCIES,
  DEFAULT_KPI_WEIGHT,
  editableFields,
  isValidCalibratedScore,
  nextStatus,
  outcomePlan,
  parseRatings,
  previousStatus,
  signOffAction,
  validateCompetencies,
} from './appraisal-score';
import {
  blockersOf,
  competenciesOf,
  emptyCounts,
  scoreOf,
  toAppraisalView,
  toCycleView,
  toEmployeeRow,
  toListRow,
} from './appraisal-mapper';
import {
  AppraisalsRepository,
  type AppraisalRow,
  type CycleRow,
} from './appraisals.repository';
import type {
  AppraisalEditableField,
  AppraisalListRow,
  AppraisalView,
  CycleCounts,
  CycleView,
  EmployeeAppraisalRow,
  KpiSnapshot,
  LaunchResult,
} from './appraisals.types';
import { CreateCycleDto, LaunchCycleDto, UpdateCycleDto } from './dto/cycle.dto';
import { UpdateAppraisalDto } from './dto/update-appraisal.dto';

/** A machine credential is not a user row; never store its synthetic id as an actor. */
const actorId = (p: AuthPrincipal): string | null =>
  p.isMachine ? null : p.userId;

const clean = (v: string | null | undefined): string | null =>
  v === undefined || v === null ? null : v.trim() || null;

/**
 * Appraisal cycles and the review workflow. Owner/Admin only (enforced by the
 * controller). Every lookup is org-scoped through the cycle; a foreign id is a
 * 404, never a 403 that would confirm it exists. KPIs come from the slice-1
 * code via `PeopleSummaryService.kpisForPeriod`, never typed.
 */
@Injectable()
export class AppraisalsService {
  constructor(
    private readonly repo: AppraisalsRepository,
    private readonly summaries: PeopleSummaryService,
    private readonly employees: EmployeesService,
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
    const competencies = dto.competencies ?? [...DEFAULT_COMPETENCIES];
    this.assertPeriod(dto.periodStart, dto.periodEnd);
    this.assertCompetencies(competencies);
    const row = await this.repo.createCycle({
      orgId: principal.orgId,
      name: dto.name.trim(),
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      kpiWeight: dto.kpiWeight ?? DEFAULT_KPI_WEIGHT,
      competencies,
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

    // Weights, period and competencies decide every score in the cycle: once
    // appraisals exist they can no longer move underneath them.
    const structural =
      periodStart !== view.periodStart ||
      periodEnd !== view.periodEnd ||
      (dto.kpiWeight !== undefined && dto.kpiWeight !== view.kpiWeight) ||
      (dto.competencies !== undefined &&
        JSON.stringify(dto.competencies) !== JSON.stringify(view.competencies));
    if (structural && view.counts.total > 0) {
      throw new ConflictException(
        'The period, KPI weight and competencies are locked once appraisals have been launched',
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
            ...(dto.kpiWeight !== undefined ? { kpiWeight: dto.kpiWeight } : {}),
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
    const candidates = await this.repo.launchCandidates(orgId, periodEnd, wanted);
    if (wanted && candidates.length !== wanted.length)
      throw new BadRequestException('Unknown employee in the selection');

    const created = await this.repo.createAppraisals(id, candidates);
    return {
      cycle: await this.getCycle(orgId, id),
      created,
      skipped: candidates.length - created,
    };
  }

  // --- appraisals ---------------------------------------------------------

  async listAppraisals(
    orgId: string,
    cycleId: string,
  ): Promise<AppraisalListRow[]> {
    await this.requireCycle(orgId, cycleId);
    return (await this.repo.listByCycle(orgId, cycleId)).map(toListRow);
  }

  async getAppraisal(orgId: string, id: string): Promise<AppraisalView> {
    return this.view(await this.requireAppraisal(orgId, id));
  }

  async employeeAppraisals(
    orgId: string,
    employeeId: string,
  ): Promise<EmployeeAppraisalRow[]> {
    await this.employees.getProfile(orgId, employeeId); // 404 for a foreign id
    return (await this.repo.listForEmployee(orgId, employeeId)).map(
      toEmployeeRow,
    );
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateAppraisalDto,
  ): Promise<AppraisalView> {
    const row = await this.requireOpen(orgId, id);
    const keys = competenciesOf(row.cycle).map((c) => c.key);
    const allowed = new Set<AppraisalEditableField>(editableFields(row.status));

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
      const parsed = parseRatings(dto[field], keys);
      if (!parsed.ok) throw new BadRequestException(parsed.error);
      data[field] = parsed.value;
    }
    for (const field of [
      'selfComment',
      'leadComment',
      'strengths',
      'improvements',
      'goals',
      'calibrationNote',
      'newDesignation',
    ] as const) {
      if (dto[field] !== undefined) data[field] = clean(dto[field]);
    }
    if (dto.recommendation !== undefined) {
      data.recommendation = dto.recommendation;
      // A designation only means something for a promotion; don't leave a stale one behind.
      if (dto.recommendation !== 'PROMOTE' && dto.newDesignation === undefined)
        data.newDesignation = null;
    }
    if (dto.calibratedScore !== undefined) {
      if (dto.calibratedScore !== null && !isValidCalibratedScore(dto.calibratedScore))
        throw new BadRequestException('calibratedScore must be between 0 and 5');
      data.calibratedScore = dto.calibratedScore;
    }

    if (Object.keys(data).length > 0) {
      if (!(await this.repo.updateIf(id, row.status, data)))
        throw this.changedUnderneath();
    }
    return this.getAppraisal(orgId, id);
  }

  /**
   * Forward one step. Entering LEAD_REVIEW snapshots the KPIs; signing off
   * freezes the score and applies the recommendation exactly once. Calling it
   * again on a signed-off appraisal is a no-op (or finishes an outcome that
   * never landed), never a second event.
   */
  async advance(
    principal: AuthPrincipal,
    id: string,
  ): Promise<AppraisalView> {
    const orgId = principal.orgId;
    const row = await this.requireAppraisal(orgId, id);

    if (row.status === 'SIGNED_OFF') {
      if (signOffAction(row) === 'apply-outcome')
        await this.applyOutcome(principal, row);
      return this.getAppraisal(orgId, id);
    }
    this.assertOpen(row);

    const blockers = blockersOf(row);
    if (blockers.length > 0) throw new BadRequestException(blockers.join('; '));
    const next = nextStatus(row.status);
    if (!next) throw new BadRequestException('Nothing follows sign-off');

    if (next === 'LEAD_REVIEW') {
      const snapshot = await this.snapshot(row);
      if (
        !(await this.repo.updateIf(id, row.status, {
          status: next,
          kpiSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          kpiSnapshotAt: new Date(snapshot.computedAt),
        }))
      )
        throw this.changedUnderneath();
    } else if (next === 'SIGNED_OFF') {
      const score = scoreOf(row);
      if (
        !(await this.repo.updateIf(id, row.status, {
          status: next,
          signedOffAt: new Date(),
          signedOffBy: actorId(principal),
          finalScore: score.final,
          finalPartial: score.partial,
        }))
      )
        throw this.changedUnderneath();
      // The status flip above is the claim: only the caller that won it gets here.
      await this.applyOutcome(principal, row);
    } else if (!(await this.repo.updateIf(id, row.status, { status: next }))) {
      throw this.changedUnderneath();
    }
    return this.getAppraisal(orgId, id);
  }

  /** Back one step for corrections. Not from the first step, never after sign-off. */
  async sendBack(orgId: string, id: string): Promise<AppraisalView> {
    const row = await this.requireOpen(orgId, id);
    const prev = previousStatus(row.status);
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

  /** Recompute the KPI snapshot from today's data. Frozen once signed off. */
  async refreshKpis(orgId: string, id: string): Promise<AppraisalView> {
    const row = await this.requireOpen(orgId, id);
    if (row.status === 'SIGNED_OFF')
      throw new ConflictException('The KPI snapshot is frozen at sign-off');
    const snapshot = await this.snapshot(row);
    if (
      !(await this.repo.updateIf(id, row.status, {
        kpiSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        kpiSnapshotAt: new Date(snapshot.computedAt),
      }))
    )
      throw this.changedUnderneath();
    return this.getAppraisal(orgId, id);
  }

  // --- internals ----------------------------------------------------------

  /** KPIs over the cycle period, clipped to today so future days don't count as available. */
  private async snapshot(row: AppraisalRow): Promise<KpiSnapshot> {
    const today = dhakaDateOf(new Date());
    const from = dateColumnToIso(row.cycle.periodStart);
    const end = dateColumnToIso(row.cycle.periodEnd);
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
   * Writes the recommendation's employment event (PROMOTED also moves the
   * designation) and records that it happened. The appraisal is already
   * SIGNED_OFF; if the event write throws, `outcomeAppliedAt` stays null and
   * the next `advance` finishes the job instead of skipping it.
   */
  private async applyOutcome(
    principal: AuthPrincipal,
    row: AppraisalRow,
  ): Promise<void> {
    const plan = outcomePlan({
      recommendation: row.recommendation,
      newDesignation: row.newDesignation,
      cycleName: row.cycle.name,
      effectiveDate: dhakaDateOf(new Date()),
    });
    if (plan) {
      await this.employees.addEvent(principal, row.employeeId, {
        type: plan.type,
        effectiveDate: plan.effectiveDate,
        toValue: plan.toValue ?? undefined,
        notes: plan.notes,
      });
    }
    await this.repo.markOutcomeApplied(row.id);
  }

  private async view(row: AppraisalRow): Promise<AppraisalView> {
    const [counts, history] = await Promise.all([
      this.countsFor([row.cycleId]),
      this.repo.listForEmployee(row.cycle.orgId, row.employeeId),
    ]);
    return toAppraisalView(
      row,
      counts.get(row.cycleId) ?? emptyCounts(),
      history.filter((h) => h.id !== row.id).map(toEmployeeRow),
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
      throw new BadRequestException('periodStart must be on or before periodEnd');
    if (start < addDays(end, -800))
      throw new BadRequestException('A cycle cannot span more than about two years');
  }

  private assertCompetencies(list: { key: string; label: string }[]): void {
    const error = validateCompetencies(list);
    if (error) throw new BadRequestException(error);
  }

  private changedUnderneath(): ConflictException {
    return new ConflictException(
      'This appraisal was changed by someone else; reload and try again',
    );
  }
}
