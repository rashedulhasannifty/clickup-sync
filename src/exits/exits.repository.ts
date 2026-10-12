import { Injectable } from '@nestjs/common';
import type {
  EmployeeStatus,
  ExitAnswer,
  ExitChecklistGroup,
  ExitInterviewReason,
  ExitStatus,
  ExitType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isoToDateColumn } from '../people/people-dates';

/** What an exit view needs from the employee, so the service never loads the whole row. */
const EXIT_INCLUDE = {
  employee: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      designation: true,
      department: true,
      joinDate: true,
      userId: true,
      status: true,
      team: { select: { name: true } },
    },
  },
  items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.EmployeeExitInclude;

export type ExitRow = Prisma.EmployeeExitGetPayload<{
  include: typeof EXIT_INCLUDE;
}>;

const LIST_INCLUDE = {
  employee: {
    select: {
      fullName: true,
      designation: true,
      team: { select: { name: true } },
    },
  },
  items: { select: { done: true, notApplicable: true } },
} satisfies Prisma.EmployeeExitInclude;

export type ExitListItem = Prisma.EmployeeExitGetPayload<{
  include: typeof LIST_INCLUDE;
}>;

const ACTIVE: ExitStatus[] = ['NOTICE', 'INTERVIEW', 'CLEARANCE'];

export interface NewExit {
  employeeId: string;
  type: ExitType;
  /** `YYYY-MM-DD` */
  noticeDate: string;
  /** `YYYY-MM-DD` */
  lastWorkingDay: string;
  reason: string | null;
  previousStatus: EmployeeStatus;
  createdBy: string | null;
  clearanceItems: readonly {
    group: ExitChecklistGroup;
    key: string | null;
    label: string;
  }[];
}

export interface ExitDetailsUpdate {
  type?: ExitType;
  noticeDate?: string;
  lastWorkingDay?: string;
  reason?: string | null;
}

export interface InterviewData {
  interviewReason: ExitInterviewReason | null;
  ratingRole: number | null;
  ratingLead: number | null;
  ratingCompensation: number | null;
  ratingGrowth: number | null;
  ratingEnvironment: number | null;
  interviewFeedback: string | null;
  wouldRecommend: ExitAnswer | null;
  wouldRejoin: ExitAnswer | null;
  interviewNotes: string | null;
  interviewBy: string | null;
  interviewAt: Date;
}

/** Fields a status change may set alongside the status itself. */
export type StatusChange = Partial<
  Pick<
    Prisma.EmployeeExitUncheckedUpdateManyInput,
    | 'status'
    | 'completedAt'
    | 'completedBy'
    | 'overrideNote'
    | 'loginDisabled'
    | 'cancelledAt'
    | 'cancelledBy'
    | 'cancelNote'
  >
>;

export interface ItemPatch {
  label?: string;
  note?: string | null;
  done?: boolean;
  doneBy?: string | null;
  doneAt?: Date | null;
  notApplicable?: boolean;
  notApplicableBy?: string | null;
  notApplicableAt?: Date | null;
}

/**
 * Owns every write to `employee_exits` and `exit_clearance_items`. Org scoping goes through the
 * employee (`employee: { orgId }`), so a foreign id is "not found", never "forbidden".
 */
@Injectable()
export class ExitsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(orgId: string, id: string): Promise<ExitRow | null> {
    return this.prisma.employeeExit.findFirst({
      where: { id, employee: { orgId } },
      include: EXIT_INCLUDE,
    });
  }

  /** The employee's active exit if there is one, else their most recent. */
  async findForEmployee(
    orgId: string,
    employeeId: string,
  ): Promise<ExitRow | null> {
    const where = { employeeId, employee: { orgId } };
    return (
      (await this.prisma.employeeExit.findFirst({
        where: { ...where, status: { in: ACTIVE } },
        include: EXIT_INCLUDE,
      })) ??
      this.prisma.employeeExit.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
        include: EXIT_INCLUDE,
      })
    );
  }

  async hasActive(employeeId: string): Promise<boolean> {
    return (
      (await this.prisma.employeeExit.count({
        where: { employeeId, status: { in: ACTIVE } },
      })) > 0
    );
  }

  list(orgId: string, statuses?: ExitStatus[]): Promise<ExitListItem[]> {
    return this.prisma.employeeExit.findMany({
      where: {
        employee: { orgId },
        ...(statuses ? { status: { in: statuses } } : {}),
      },
      include: LIST_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
  }

  /**
   * Inserts the exit and its seeded clearance items in one nested write. The partial unique index
   * (one active exit per employee) turns a race into a P2002 the service maps to a 409.
   */
  create(data: NewExit): Promise<ExitRow> {
    return this.prisma.employeeExit.create({
      data: {
        employeeId: data.employeeId,
        type: data.type,
        noticeDate: isoToDateColumn(data.noticeDate),
        lastWorkingDay: isoToDateColumn(data.lastWorkingDay),
        reason: data.reason,
        previousStatus: data.previousStatus,
        createdBy: data.createdBy,
        items: {
          create: data.clearanceItems.map((item, position) => ({
            group: item.group,
            key: item.key,
            label: item.label,
            position,
          })),
        },
      },
      include: EXIT_INCLUDE,
    });
  }

  /** Compensation for a start whose NOTICE_GIVEN event could not be written. */
  async deleteById(id: string): Promise<void> {
    await this.prisma.employeeExit.deleteMany({ where: { id } });
  }

  async updateDetails(id: string, d: ExitDetailsUpdate): Promise<void> {
    await this.prisma.employeeExit.update({
      where: { id },
      data: {
        ...(d.type ? { type: d.type } : {}),
        ...(d.noticeDate ? { noticeDate: isoToDateColumn(d.noticeDate) } : {}),
        ...(d.lastWorkingDay
          ? { lastWorkingDay: isoToDateColumn(d.lastWorkingDay) }
          : {}),
        ...(d.reason !== undefined ? { reason: d.reason } : {}),
      },
    });
  }

  async saveInterview(id: string, d: InterviewData): Promise<void> {
    await this.prisma.employeeExit.update({ where: { id }, data: d });
  }

  /**
   * Moves the exit out of one of the `from` statuses, atomically: the conditional update touches
   * nothing (false) if another request got there first, so two clicks cannot both win.
   */
  async claim(
    id: string,
    from: ExitStatus[],
    change: StatusChange,
  ): Promise<boolean> {
    const res = await this.prisma.employeeExit.updateMany({
      where: { id, status: { in: from } },
      data: change,
    });
    return res.count === 1;
  }

  /** A custom item (no key), placed after every existing item; the UI groups by `group`. */
  async addItem(
    exitId: string,
    label: string,
    group: ExitChecklistGroup,
  ): Promise<void> {
    const last = await this.prisma.exitClearanceItem.aggregate({
      where: { exitId },
      _max: { position: true },
    });
    await this.prisma.exitClearanceItem.create({
      data: { exitId, label, group, position: (last._max.position ?? -1) + 1 },
    });
  }

  /**
   * Ticks the seeded item with this key as done, only if it is still open (neither done nor N/A).
   * One conditional update, so it is atomic and idempotent; a removed item is simply not matched.
   */
  async markKeyedItemDone(
    exitId: string,
    key: string,
    doneBy: string | null,
  ): Promise<boolean> {
    const res = await this.prisma.exitClearanceItem.updateMany({
      where: { exitId, key, done: false, notApplicable: false },
      data: { done: true, doneBy, doneAt: new Date() },
    });
    return res.count > 0;
  }

  /** The item, only if it belongs to this exit. */
  findItem(exitId: string, itemId: string) {
    return this.prisma.exitClearanceItem.findFirst({
      where: { id: itemId, exitId },
    });
  }

  async updateItem(itemId: string, patch: ItemPatch): Promise<void> {
    await this.prisma.exitClearanceItem.update({
      where: { id: itemId },
      data: patch,
    });
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.prisma.exitClearanceItem.delete({ where: { id: itemId } });
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

  async organisationName(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    return org?.name ?? '';
  }
}
