import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { LATEST_EXTENSION } from '../people/employees.repository';
import { isoToDateColumn } from '../people/people-dates';
import type {
  AppraisalCycleStatusValue,
  AppraisalPeriodBasisValue,
  AppraisalStatusValue,
  AppraisalTypeValue,
  Competency,
  FormHeader,
  ScoringModeValue,
} from './appraisals.types';

const APPRAISAL_INCLUDE = {
  cycle: true,
  employee: {
    include: { team: { select: { name: true } }, events: LATEST_EXTENSION },
  },
  reviewer: { select: { id: true, fullName: true } },
} satisfies Prisma.AppraisalInclude;

export type AppraisalRow = Prisma.AppraisalGetPayload<{
  include: typeof APPRAISAL_INCLUDE;
}>;
export type CycleRow = Prisma.AppraisalCycleGetPayload<object>;

export interface NewCycle {
  orgId: string;
  name: string;
  /** `YYYY-MM-DD` */
  periodStart: string;
  periodEnd: string;
  kpiWeight: number;
  competencies: Competency[];
  type: AppraisalTypeValue;
  scoringMode: ScoringModeValue;
  periodBasis: AppraisalPeriodBasisValue;
  createdBy: string | null;
}

export interface CycleUpdate {
  name?: string;
  periodStart?: string;
  periodEnd?: string;
  kpiWeight?: number;
  competencies?: Competency[];
  type?: AppraisalTypeValue;
  periodBasis?: AppraisalPeriodBasisValue;
  status?: AppraisalCycleStatusValue;
}

export interface LaunchCandidate {
  id: string;
  managerId: string | null;
  /** FORM_100 cycles: the header captured at launch. */
  formHeader?: FormHeader | null;
  /** JOIN_DATE cycles: this employee's own review period and due date (`YYYY-MM-DD`). */
  period?: { periodStart: string; periodEnd: string; dueDate: string } | null;
}

/** What launch and the due preview read about an employee. */
const CANDIDATE_SELECT = {
  id: true,
  managerId: true,
  fullName: true,
  designation: true,
  status: true,
  joinDate: true,
  confirmationDate: true,
  probationStartDate: true,
  internshipEndDate: true,
  events: LATEST_EXTENSION,
  team: { select: { name: true } },
} satisfies Prisma.EmployeeSelect;

export type CandidateRow = Prisma.EmployeeGetPayload<{
  select: typeof CANDIDATE_SELECT;
}>;

/** What the form header is built from: the employee row and its salary/promotion history. */
const HEADER_SELECT = {
  id: true,
  fullName: true,
  concernName: true,
  designation: true,
  department: true,
  joinDate: true,
  exitDate: true,
  academicQualification: true,
  experienceBeforeJoiningMonths: true,
  startingSalary: true,
  grossSalary: true,
  events: {
    where: { type: { in: ['INCREMENT', 'PROMOTED'] } },
    select: {
      type: true,
      effectiveDate: true,
      fromValue: true,
      toValue: true,
    },
    orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
  },
} satisfies Prisma.EmployeeSelect;

export type HeaderSourceRow = Prisma.EmployeeGetPayload<{
  select: typeof HEADER_SELECT;
}>;

/**
 * Owns every write to `appraisal_cycles` and `appraisals`. Appraisals carry no
 * org id of their own: every lookup goes through the cycle's `org_id`, so a
 * foreign id is simply not found.
 */
@Injectable()
export class AppraisalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- cycles -------------------------------------------------------------

  listCycles(orgId: string): Promise<CycleRow[]> {
    return this.prisma.appraisalCycle.findMany({
      where: { orgId },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findCycle(orgId: string, id: string): Promise<CycleRow | null> {
    return this.prisma.appraisalCycle.findFirst({ where: { id, orgId } });
  }

  createCycle(data: NewCycle): Promise<CycleRow> {
    return this.prisma.appraisalCycle.create({
      data: {
        orgId: data.orgId,
        name: data.name,
        periodStart: isoToDateColumn(data.periodStart),
        periodEnd: isoToDateColumn(data.periodEnd),
        kpiWeight: data.kpiWeight,
        competencies: data.competencies as unknown as Prisma.InputJsonValue,
        type: data.type,
        scoringMode: data.scoringMode,
        periodBasis: data.periodBasis,
        createdBy: data.createdBy,
      },
    });
  }

  updateCycle(id: string, data: CycleUpdate): Promise<CycleRow> {
    return this.prisma.appraisalCycle.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.periodStart
          ? { periodStart: isoToDateColumn(data.periodStart) }
          : {}),
        ...(data.periodEnd
          ? { periodEnd: isoToDateColumn(data.periodEnd) }
          : {}),
        ...(data.kpiWeight !== undefined ? { kpiWeight: data.kpiWeight } : {}),
        ...(data.competencies
          ? {
              competencies:
                data.competencies as unknown as Prisma.InputJsonValue,
            }
          : {}),
        ...(data.type ? { type: data.type } : {}),
        ...(data.periodBasis ? { periodBasis: data.periodBasis } : {}),
        ...(data.status ? { status: data.status } : {}),
      },
    });
  }

  /** Appraisal count per (cycle, status), for the progress bars. */
  async statusCounts(
    cycleIds: string[],
  ): Promise<
    { cycleId: string; status: AppraisalStatusValue; count: number }[]
  > {
    if (cycleIds.length === 0) return [];
    const rows = await this.prisma.appraisal.groupBy({
      by: ['cycleId', 'status'],
      where: { cycleId: { in: cycleIds } },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      cycleId: r.cycleId,
      status: r.status,
      count: r._count._all,
    }));
  }

  countAppraisals(cycleId: string): Promise<number> {
    return this.prisma.appraisal.count({ where: { cycleId } });
  }

  // --- launch -------------------------------------------------------------

  /**
   * The employees a launch covers. With explicit ids: those that exist in the
   * org. Without: every non-EXITED employee who joined on or before the period
   * end (for a JOIN_DATE cycle the caller then keeps only those with a due
   * date in the window). Also the due preview's source, by name.
   */
  launchCandidates(
    orgId: string,
    periodEnd: string,
    employeeIds?: string[],
  ): Promise<CandidateRow[]> {
    return this.prisma.employee.findMany({
      where: employeeIds
        ? { orgId, id: { in: employeeIds } }
        : {
            orgId,
            status: { not: 'EXITED' },
            joinDate: { lte: isoToDateColumn(periodEnd) },
          },
      select: CANDIDATE_SELECT,
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Creates the missing appraisals and opens a DRAFT cycle in one transaction.
   * Returns how many rows were actually created (duplicates are skipped by the
   * `(cycle_id, employee_id)` unique key, which also makes a double-click safe).
   */
  async createAppraisals(
    cycleId: string,
    rows: LaunchCandidate[],
  ): Promise<number> {
    const [created] = await this.prisma.$transaction([
      this.prisma.appraisal.createMany({
        data: rows.map((r) => ({
          cycleId,
          employeeId: r.id,
          reviewerId: r.managerId,
          ...(r.period
            ? {
                periodStart: isoToDateColumn(r.period.periodStart),
                periodEnd: isoToDateColumn(r.period.periodEnd),
                dueDate: isoToDateColumn(r.period.dueDate),
              }
            : {}),
          ...(r.formHeader
            ? {
                formHeader: r.formHeader as unknown as Prisma.InputJsonValue,
              }
            : {}),
        })),
        skipDuplicates: true,
      }),
      this.prisma.appraisalCycle.updateMany({
        where: { id: cycleId, status: 'DRAFT' },
        data: { status: 'OPEN' },
      }),
    ]);
    return created.count;
  }

  /**
   * Every appraisal the employees have, in any cycle and any status, with
   * the type, due date and the end of the period it reviews: what the
   * schedule needs to tell "already appraised" and "overdue". Org-scoped.
   */
  async appraisalsOnRecord(
    orgId: string,
    employeeIds?: string[],
  ): Promise<
    {
      employeeId: string;
      type: AppraisalTypeValue;
      dueDate: Date | null;
      periodEnd: Date;
    }[]
  > {
    if (employeeIds && employeeIds.length === 0) return [];
    const rows = await this.prisma.appraisal.findMany({
      where: {
        cycle: { orgId },
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      },
      select: {
        employeeId: true,
        dueDate: true,
        periodEnd: true,
        cycle: { select: { type: true, periodEnd: true } },
      },
    });
    // Paper appraisals from before the system (0035) count like any appraisal,
    // standing for their due date, else the date they were conducted.
    const past = await this.prisma.pastAppraisal.findMany({
      where: {
        employee: { orgId },
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      },
      select: { employeeId: true, type: true, dueDate: true, conductedOn: true },
    });
    return [
      ...rows.map((r) => ({
        employeeId: r.employeeId,
        type: r.cycle.type,
        dueDate: r.dueDate,
        periodEnd: r.periodEnd ?? r.cycle.periodEnd,
      })),
      ...past.map((p) => {
        const at = p.dueDate ?? p.conductedOn;
        return {
          employeeId: p.employeeId,
          type: p.type,
          dueDate: at,
          periodEnd: new Date(at.getTime() - 86_400_000),
        };
      }),
    ];
  }

  /** An employee's past (paper) appraisals as the schedule sees them (0035). */
  async pastAppraisalsOnRecord(
    employeeId: string,
  ): Promise<{ type: AppraisalTypeValue; dueDate: Date | null; conductedOn: Date }[]> {
    return this.prisma.pastAppraisal.findMany({
      where: { employeeId },
      select: { type: true, dueDate: true, conductedOn: true },
    });
  }

  // --- appraisals ---------------------------------------------------------

  listByCycle(orgId: string, cycleId: string): Promise<AppraisalRow[]> {
    return this.prisma.appraisal.findMany({
      where: { cycleId, cycle: { orgId } },
      include: APPRAISAL_INCLUDE,
      orderBy: [{ employee: { fullName: 'asc' } }],
    });
  }

  findAppraisal(orgId: string, id: string): Promise<AppraisalRow | null> {
    return this.prisma.appraisal.findFirst({
      where: { id, cycle: { orgId } },
      include: APPRAISAL_INCLUDE,
    });
  }

  listForEmployee(orgId: string, employeeId: string): Promise<AppraisalRow[]> {
    return this.prisma.appraisal.findMany({
      where: { employeeId, cycle: { orgId } },
      include: APPRAISAL_INCLUDE,
      orderBy: [{ cycle: { periodEnd: 'desc' } }, { createdAt: 'desc' }],
    });
  }

  /**
   * Compare-and-set: applies `data` only while the appraisal is still in
   * `expected`, so two admins clicking at once cannot both move it (or edit
   * fields the step no longer accepts). Returns whether a row was changed.
   */
  async updateIf(
    id: string,
    expected: AppraisalStatusValue,
    data: Prisma.AppraisalUpdateManyMutationInput,
  ): Promise<boolean> {
    const r = await this.prisma.appraisal.updateMany({
      where: { id, status: expected },
      data,
    });
    return r.count > 0;
  }

  // --- form header, names, documents --------------------------------------

  /** The employees' header sources, for the form header (org-scoped). */
  headerSources(orgId: string, ids: string[]): Promise<HeaderSourceRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.employee.findMany({
      where: { orgId, id: { in: ids } },
      select: HEADER_SELECT,
    });
  }

  async organisationName(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    return org?.name ?? '';
  }

  /** Display names for step actors (user ids). */
  async userNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true, email: true },
    });
    return new Map(rows.map((u) => [u.id, u.name?.trim() || u.email]));
  }

  /** Records the stored PDF. Plain update: the appraisal is already signed off and read-only otherwise. */
  async setFormDocument(id: string, documentId: string): Promise<void> {
    await this.prisma.appraisal.update({
      where: { id },
      data: { formDocumentId: documentId },
    });
  }

  /** Marks the outcome as written. Only the first call changes anything. */
  async markOutcomeApplied(id: string): Promise<boolean> {
    const r = await this.prisma.appraisal.updateMany({
      where: { id, outcomeAppliedAt: null },
      data: { outcomeAppliedAt: new Date() },
    });
    return r.count > 0;
  }
}
