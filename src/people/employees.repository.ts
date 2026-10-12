import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { defaultOnboardingRows } from './onboarding-checklist';
import { isoToDateColumn } from './people-dates';
import type { EmployeePatch } from './employment-events';
import type {
  EmployeeStatusValue,
  EmploymentEventTypeValue,
} from './people.types';

/**
 * The latest INTERNSHIP_EXTENDED event: its `fromValue` (the end date before
 * the extension) is where the current internship term starts, for the
 * internship review's period and "already reviewed" (0034).
 */
export const LATEST_EXTENSION = {
  where: { type: 'INTERNSHIP_EXTENDED' },
  select: { fromValue: true },
  orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
  take: 1,
} satisfies Prisma.Employee$eventsArgs;

/**
 * The relations every profile needs: team and manager names, and the
 * employee's appraisals as the schedule sees them (type, due date, reviewed
 * period end), so `nextAppraisal` can tell a missed due date from one that
 * already has an appraisal.
 */
const PROFILE_INCLUDE = {
  team: { select: { name: true } },
  manager: { select: { fullName: true } },
  appraisals: {
    select: {
      dueDate: true,
      periodEnd: true,
      cycle: { select: { type: true, periodEnd: true } },
    },
  },
  events: LATEST_EXTENSION,
  // Paper appraisals from before the system count as "already appraised" (0035).
  pastAppraisals: {
    select: { type: true, dueDate: true, conductedOn: true },
  },
} satisfies Prisma.EmployeeInclude;

export type EmployeeRow = Prisma.EmployeeGetPayload<{
  include: typeof PROFILE_INCLUDE;
}>;

export interface EmployeeListFilter {
  search?: string;
  status?: EmployeeStatusValue;
  teamId?: string;
}

export interface NewEmployee {
  orgId: string;
  fullName: string;
  email: string;
  employeeCode: string | null;
  userId: string | null;
  clickupUserId: string | null;
  designation: string;
  grade: string | null;
  department: string | null;
  teamId: string | null;
  managerId: string | null;
  /** `YYYY-MM-DD` */
  joinDate: string;
  status?: EmployeeStatusValue;
  /** Default: the join date, except for an INTERN (null until probation starts). */
  probationStartDate?: string | null;
  /** INTERN: the expected internship end. */
  internshipEndDate?: string | null;
  createdBy: string | null;
  concernName?: string | null;
  academicQualification?: string | null;
  experienceBeforeJoiningMonths?: number | null;
  startingSalary?: number | null;
  grossSalary?: number | null;
}

export interface EmployeeProfileUpdate {
  fullName?: string;
  email?: string;
  employeeCode?: string | null;
  clickupUserId?: string | null;
  userId?: string | null;
  designation?: string;
  grade?: string | null;
  department?: string | null;
  teamId?: string | null;
  managerId?: string | null;
  joinDate?: string;
  probationStartDate?: string | null;
  internshipEndDate?: string | null;
  concernName?: string | null;
  academicQualification?: string | null;
  experienceBeforeJoiningMonths?: number | null;
  startingSalary?: number | null;
  grossSalary?: number | null;
}

/** One event of a batch written by `addEvents`. */
export interface NewEmploymentEvent {
  type: EmploymentEventTypeValue;
  effectiveDate: string;
  fromValue: string | null;
  toValue: string | null;
  notes: string | null;
  patch: EmployeePatch;
}

/** An event's side-effects as a Prisma update. Only keys that change are present. */
function patchData(patch: EmployeePatch): Prisma.EmployeeUncheckedUpdateInput {
  return {
    ...(patch.designation !== undefined
      ? { designation: patch.designation }
      : {}),
    ...(patch.confirmationDate
      ? { confirmationDate: isoToDateColumn(patch.confirmationDate) }
      : {}),
    ...(patch.exitDate ? { exitDate: isoToDateColumn(patch.exitDate) } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.teamId ? { teamId: patch.teamId } : {}),
    ...(patch.grossSalary !== undefined
      ? { grossSalary: patch.grossSalary }
      : {}),
    ...(patch.probationStartDate
      ? { probationStartDate: isoToDateColumn(patch.probationStartDate) }
      : {}),
    ...(patch.internshipEndDate
      ? { internshipEndDate: isoToDateColumn(patch.internshipEndDate) }
      : {}),
  };
}

/** Owns every write to `employees` and `employment_events`. */
@Injectable()
export class EmployeesRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(orgId: string, f: EmployeeListFilter): Promise<EmployeeRow[]> {
    const search = f.search?.trim();
    return this.prisma.employee.findMany({
      where: {
        orgId,
        ...(f.status ? { status: f.status } : {}),
        ...(f.teamId ? { teamId: f.teamId } : {}),
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { employeeCode: { contains: search, mode: 'insensitive' } },
                { designation: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: PROFILE_INCLUDE,
      orderBy: { fullName: 'asc' },
    });
  }

  findById(orgId: string, id: string): Promise<EmployeeRow | null> {
    return this.prisma.employee.findFirst({
      where: { id, orgId },
      include: PROFILE_INCLUDE,
    });
  }

  /** Org-scoped existence check — 404 (not 403) for another org's id, as TeamsRepository does. */
  async existsInOrg(orgId: string, id: string): Promise<boolean> {
    return (await this.prisma.employee.count({ where: { id, orgId } })) > 0;
  }

  /**
   * `startId` and everyone above it: its manager, that manager's manager, ...
   * `UNION` (not `UNION ALL`) makes the walk terminate even if a loop already
   * exists in the data.
   */
  async managerChain(orgId: string, startId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE chain(id, manager_id) AS (
        SELECT id, manager_id FROM employees WHERE id = ${startId} AND org_id = ${orgId}
        UNION
        SELECT e.id, e.manager_id FROM employees e
        JOIN chain c ON e.id = c.manager_id
        WHERE e.org_id = ${orgId}
      )
      SELECT id FROM chain`;
    return rows.map((r) => r.id);
  }

  /** Employees an attendance sync should cover: employed at any point in [from, to]. */
  listForSync(from: string, to: string) {
    return this.prisma.employee.findMany({
      where: {
        joinDate: { lte: isoToDateColumn(to) },
        OR: [{ exitDate: null }, { exitDate: { gte: isoToDateColumn(from) } }],
      },
      select: { id: true, email: true, joinDate: true, exitDate: true },
    });
  }

  /**
   * Create the employee, its JOINED event and the default onboarding checklist atomically (one
   * nested write). Both POST create and import-from-users come through here.
   */
  create(data: NewEmployee): Promise<EmployeeRow> {
    return this.prisma.employee.create({
      data: {
        orgId: data.orgId,
        fullName: data.fullName,
        email: data.email,
        employeeCode: data.employeeCode,
        userId: data.userId,
        clickupUserId: data.clickupUserId,
        designation: data.designation,
        grade: data.grade,
        department: data.department,
        teamId: data.teamId,
        managerId: data.managerId,
        joinDate: isoToDateColumn(data.joinDate),
        probationStartDate: ((): Date | null => {
          const start =
            data.probationStartDate !== undefined
              ? data.probationStartDate
              : data.status === 'INTERN'
                ? null
                : data.joinDate;
          return start ? isoToDateColumn(start) : null;
        })(),
        internshipEndDate: data.internshipEndDate
          ? isoToDateColumn(data.internshipEndDate)
          : null,
        concernName: data.concernName ?? null,
        academicQualification: data.academicQualification ?? null,
        experienceBeforeJoiningMonths: data.experienceBeforeJoiningMonths ?? null,
        startingSalary: data.startingSalary ?? null,
        grossSalary: data.grossSalary ?? null,
        ...(data.status ? { status: data.status } : {}),
        events: {
          create: {
            type: 'JOINED',
            effectiveDate: isoToDateColumn(data.joinDate),
            createdBy: data.createdBy,
          },
        },
        onboarding: { create: defaultOnboardingRows() },
      },
      include: PROFILE_INCLUDE,
    });
  }

  update(id: string, data: EmployeeProfileUpdate): Promise<EmployeeRow> {
    const { joinDate, probationStartDate, internshipEndDate, ...rest } = data;
    const date = (v: string | null) => (v ? isoToDateColumn(v) : null);
    return this.prisma.employee.update({
      where: { id },
      data: {
        ...rest,
        ...(joinDate ? { joinDate: isoToDateColumn(joinDate) } : {}),
        ...(probationStartDate !== undefined
          ? { probationStartDate: date(probationStartDate) }
          : {}),
        ...(internshipEndDate !== undefined
          ? { internshipEndDate: date(internshipEndDate) }
          : {}),
      },
      include: PROFILE_INCLUDE,
    });
  }

  /** Links a login/ClickUp identity to an employee that has none (never overwrites a set link). */
  async linkIdentity(
    id: string,
    link: { userId?: string; clickupUserId?: string },
  ): Promise<void> {
    await this.prisma.employee.updateMany({
      where: { id, ...(link.userId ? { userId: null } : {}) },
      data: {
        ...(link.userId ? { userId: link.userId } : {}),
        ...(link.clickupUserId ? { clickupUserId: link.clickupUserId } : {}),
      },
    });
  }

  /** Inserts the event and applies its side-effects to the employee in ONE transaction. */
  async addEvent(args: {
    employeeId: string;
    type: EmploymentEventTypeValue;
    effectiveDate: string;
    fromValue: string | null;
    toValue: string | null;
    notes: string | null;
    createdBy: string | null;
    patch: EmployeePatch;
  }) {
    const { patch } = args;
    const [event] = await this.prisma.$transaction([
      this.prisma.employmentEvent.create({
        data: {
          employeeId: args.employeeId,
          type: args.type,
          effectiveDate: isoToDateColumn(args.effectiveDate),
          fromValue: args.fromValue,
          toValue: args.toValue,
          notes: args.notes,
          createdBy: args.createdBy,
        },
      }),
      this.prisma.employee.update({
        where: { id: args.employeeId },
        data: patchData(patch),
      }),
    ]);
    return event;
  }

  /**
   * Several events and their side-effects in ONE transaction, in order, so a
   * multi-event outcome (an appraisal's confirm + promote + increment) lands
   * whole or not at all and a retry never writes half of it twice.
   */
  async addEvents(
    employeeId: string,
    createdBy: string | null,
    events: NewEmploymentEvent[],
  ) {
    if (events.length === 0) return [];
    return this.prisma.$transaction(async (tx) => {
      const out = [];
      for (const e of events) {
        out.push(
          await tx.employmentEvent.create({
            data: {
              employeeId,
              type: e.type,
              effectiveDate: isoToDateColumn(e.effectiveDate),
              fromValue: e.fromValue,
              toValue: e.toValue,
              notes: e.notes,
              createdBy,
            },
          }),
        );
        await tx.employee.update({
          where: { id: employeeId },
          data: patchData(e.patch),
        });
      }
      return out;
    });
  }

  listEvents(employeeId: string) {
    return this.prisma.employmentEvent.findMany({
      where: { employeeId },
      orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
    });
  }

  findTeamInOrg(orgId: string, teamId: string) {
    return this.prisma.team.findFirst({
      where: { id: teamId, orgId },
      select: { id: true, name: true },
    });
  }

  teamNames(ids: string[]): Promise<{ id: string; name: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.team.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  userNames(
    ids: string[],
  ): Promise<{ id: string; name: string | null; email: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
  }

  /** A login in this org with this email (case-insensitive), for email-based linking. */
  findUserByEmail(orgId: string, email: string) {
    return this.prisma.user.findFirst({
      where: { orgId, email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        clickupUserId: true,
        employee: { select: { id: true } },
      },
    });
  }

  /** ACTIVE users in the org with no employee row yet. */
  usersWithoutEmployee(orgId: string) {
    return this.prisma.user.findMany({
      where: { orgId, status: 'ACTIVE', employee: null },
      select: {
        id: true,
        email: true,
        name: true,
        clickupUserId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Employees without a login, for email-based relinking during import. */
  unlinkedEmployees(orgId: string) {
    return this.prisma.employee.findMany({
      // An exited employee's record is read-only, so a late login match must not relink it.
      where: { orgId, userId: null, status: { not: 'EXITED' } },
      select: { id: true, email: true, clickupUserId: true },
    });
  }

  emailsTaken(
    emails: string[],
  ): Promise<{ email: string; clickupUserId: string | null }[]> {
    if (emails.length === 0) return Promise.resolve([]);
    return this.prisma.employee.findMany({
      where: { email: { in: emails } },
      select: { email: true, clickupUserId: true },
    });
  }

  clickupIdsTaken(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.employee
      .findMany({
        where: { clickupUserId: { in: ids } },
        select: { clickupUserId: true },
      })
      .then((rows) =>
        rows.flatMap((r) => (r.clickupUserId ? [r.clickupUserId] : [])),
      );
  }
}
