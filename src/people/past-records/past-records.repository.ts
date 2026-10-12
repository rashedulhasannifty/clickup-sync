import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { isoToDateColumn } from '../people-dates';
import type { HistoryBaselines, HistoryState } from './employee-history';
import type { PlannedAppraisal, PlannedEvent } from './past-record-rules';

/** A Prisma client or an interactive transaction's client. */
export type Db = Prisma.TransactionClient | PrismaService;

/** What the history rules need about an employee, in one round trip. */
const HISTORY_SELECT = {
  id: true,
  orgId: true,
  fullName: true,
  email: true,
  employeeCode: true,
  status: true,
  joinDate: true,
  probationStartDate: true,
  internshipEndDate: true,
  confirmationDate: true,
  designation: true,
  teamId: true,
  grossSalary: true,
  pastRecordsBaseline: true,
  events: {
    select: {
      id: true,
      type: true,
      source: true,
      effectiveDate: true,
      fromValue: true,
      toValue: true,
      appraisalId: true,
    },
    orderBy: { id: 'asc' },
  },
  pastAppraisals: {
    select: {
      id: true,
      type: true,
      conductedOn: true,
      dueDate: true,
      marks: true,
      grade: true,
    },
  },
  appraisals: {
    select: {
      dueDate: true,
      periodEnd: true,
      cycle: { select: { type: true, periodEnd: true } },
    },
  },
} satisfies Prisma.EmployeeSelect;

export type HistoryRow = Prisma.EmployeeGetPayload<{
  select: typeof HISTORY_SELECT;
}>;

const PAST_APPRAISAL_INCLUDE = {
  document: { select: { id: true, fileName: true, deletedAt: true } },
} satisfies Prisma.PastAppraisalInclude;

export type PastAppraisalRow = Prisma.PastAppraisalGetPayload<{
  include: typeof PAST_APPRAISAL_INCLUDE;
}>;

const date = (v: string | null) => (v ? isoToDateColumn(v) : null);

/** Owns every write of a past record and of the employee fields a re-fold changes. */
/** The events the timeline may change or delete (the service checks the finer rules). */
const EDITABLE_EVENT = {
  appraisalId: null,
  type: { notIn: ['NOTICE_GIVEN', 'EXITED', 'NOTE'] },
} satisfies Prisma.EmploymentEventWhereInput;

@Injectable()
export class PastRecordsRepository {
  constructor(readonly prisma: PrismaService) {}

  /** Runs `fn` in one interactive transaction, long enough for a 2,000-row import. */
  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { maxWait: 10_000, timeout: 120_000 });
  }

  /** Every employee of the org with their history (an import may name any of them). */
  orgHistories(db: Db, orgId: string): Promise<HistoryRow[]> {
    return db.employee.findMany({
      where: { orgId },
      select: HISTORY_SELECT,
      orderBy: { fullName: 'asc' },
    });
  }

  employeeHistory(db: Db, orgId: string, id: string): Promise<HistoryRow | null> {
    return db.employee.findFirst({ where: { id, orgId }, select: HISTORY_SELECT });
  }

  teams(db: Db, orgId: string): Promise<{ id: string; name: string }[]> {
    return db.team.findMany({
      where: { orgId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** The latest NOTICE_GIVEN date, for someone on notice. */
  async latestNoticeDate(db: Db, employeeId: string): Promise<Date | null> {
    const row = await db.employmentEvent.findFirst({
      where: { employeeId, type: 'NOTICE_GIVEN' },
      orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
      select: { effectiveDate: true },
    });
    return row?.effectiveDate ?? null;
  }

  async addEvents(
    db: Db,
    employeeId: string,
    createdBy: string | null,
    events: PlannedEvent[],
  ) {
    const out = [];
    for (const e of events)
      out.push(
        await db.employmentEvent.create({
          data: {
            employeeId,
            type: e.type,
            source: 'PAST_RECORD',
            effectiveDate: isoToDateColumn(e.date),
            fromValue: e.fromValue,
            toValue: e.toValue,
            notes: e.notes,
            createdBy,
          },
        }),
      );
    return out;
  }

  async addAppraisals(
    db: Db,
    employeeId: string,
    createdBy: string | null,
    rows: (PlannedAppraisal & { documentId?: string | null })[],
  ) {
    const out = [];
    for (const a of rows)
      out.push(
        await db.pastAppraisal.create({
          data: {
            employeeId,
            ...appraisalData(a),
            documentId: a.documentId ?? null,
            createdBy,
          },
          include: PAST_APPRAISAL_INCLUDE,
        }),
      );
    return out;
  }

  /**
   * An event of this employee the timeline may change (`eventEditability`, re-checked here as a
   * backstop: never an appraisal's, notice, exit or note). Returns whether a row changed.
   */
  async updateEvent(db: Db, employeeId: string, id: bigint, e: PlannedEvent) {
    const r = await db.employmentEvent.updateMany({
      where: { id, employeeId, ...EDITABLE_EVENT },
      data: {
        type: e.type,
        effectiveDate: isoToDateColumn(e.date),
        fromValue: e.fromValue,
        toValue: e.toValue,
        notes: e.notes,
      },
    });
    return r.count > 0;
  }

  async deleteEvent(db: Db, employeeId: string, id: bigint) {
    const r = await db.employmentEvent.deleteMany({
      where: { id, employeeId, ...EDITABLE_EVENT },
    });
    return r.count > 0;
  }

  async updateAppraisal(
    db: Db,
    employeeId: string,
    id: string,
    a: PlannedAppraisal & { documentId?: string | null },
  ) {
    const r = await db.pastAppraisal.updateMany({
      where: { id, employeeId },
      data: {
        ...appraisalData(a),
        ...(a.documentId !== undefined ? { documentId: a.documentId } : {}),
      },
    });
    return r.count > 0;
  }

  async deleteAppraisal(db: Db, employeeId: string, id: string) {
    const r = await db.pastAppraisal.deleteMany({ where: { id, employeeId } });
    return r.count > 0;
  }

  /** The re-fold's changes and the remembered baselines, in the caller's transaction. */
  async applyEmployeeChanges(
    db: Db,
    employeeId: string,
    changes: Partial<HistoryState>,
    baselines: HistoryBaselines,
  ): Promise<void> {
    const data: Prisma.EmployeeUncheckedUpdateInput = {
      pastRecordsBaseline:
        Object.keys(baselines).length > 0
          ? (baselines as Prisma.InputJsonValue)
          : Prisma.DbNull,
    };
    if (changes.joinDate !== undefined) data.joinDate = isoToDateColumn(changes.joinDate);
    if (changes.status !== undefined) data.status = changes.status;
    if (changes.probationStartDate !== undefined)
      data.probationStartDate = date(changes.probationStartDate);
    if (changes.internshipEndDate !== undefined)
      data.internshipEndDate = date(changes.internshipEndDate);
    if (changes.confirmationDate !== undefined)
      data.confirmationDate = date(changes.confirmationDate);
    if (changes.designation !== undefined) data.designation = changes.designation;
    if (changes.teamId !== undefined) data.teamId = changes.teamId;
    if (changes.grossSalary !== undefined) data.grossSalary = changes.grossSalary;
    await db.employee.update({ where: { id: employeeId }, data });
  }

  pastEvents(employeeId: string) {
    return this.prisma.employmentEvent.findMany({
      where: { employeeId, source: 'PAST_RECORD' },
      orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
    });
  }

  pastAppraisals(employeeId: string): Promise<PastAppraisalRow[]> {
    return this.prisma.pastAppraisal.findMany({
      where: { employeeId },
      include: PAST_APPRAISAL_INCLUDE,
      orderBy: [{ conductedOn: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findPastAppraisal(employeeId: string, id: string): Promise<PastAppraisalRow | null> {
    return this.prisma.pastAppraisal.findFirst({
      where: { id, employeeId },
      include: PAST_APPRAISAL_INCLUDE,
    });
  }

  /** A current (not deleted) document of this employee. */
  async documentOf(employeeId: string, documentId: string): Promise<boolean> {
    return (
      (await this.prisma.employeeDocument.count({
        where: { id: documentId, employeeId, deletedAt: null },
      })) > 0
    );
  }

  userNames(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
  }
}

function appraisalData(a: PlannedAppraisal) {
  return {
    type: a.type,
    conductedOn: isoToDateColumn(a.conductedOn),
    dueDate: date(a.dueDate),
    marks: a.marks,
    grade: a.grade,
    outcome: a.outcome,
    actions: a.actions,
    notes: a.notes,
  };
}
