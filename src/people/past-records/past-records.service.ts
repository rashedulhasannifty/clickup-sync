import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthPrincipal } from '../../auth/auth.types';
import type { FormGrade } from '../../appraisals/appraisals.types';
import { assertNotExited } from '../employee-readonly';
import { EmployeesService } from '../employees.service';
import { eventEditability } from '../employment-events';
import { dateColumnToIso, dhakaDateOf } from '../people-dates';
import type { EmploymentEventTypeValue } from '../people.types';
import type { HistoryEvent, HistoryState } from './employee-history';
import {
  normalizeRow,
  type EmployeeRef,
  type PastRecordRowInput,
} from './past-record-input';
import {
  describeStored,
  evaluateHistory,
  pastRecordKeys,
  planEmployeeImport,
  type EmployeeHistory,
  type EmployeePlan,
  type IncomingRow,
  type PlannedAppraisal,
  type PlannedEvent,
  type RowError,
  type StoredPastAppraisal,
} from './past-record-rules';
import type { PastRecordDto, PastRecordRowDto } from './past-records.dto';
import {
  PastRecordsRepository,
  type Db,
  type HistoryRow,
  type PastAppraisalRow,
} from './past-records.repository';
import type {
  EmployeePastRecords,
  PastAppraisalView,
  PastRecordsApplyResult,
  PastRecordsEmployeeSummary,
  PastRecordsPreview,
  SummarySide,
} from './past-records.types';

/** A machine credential is not a user row; never store its synthetic id as an actor. */
const actorId = (p: AuthPrincipal): string | null =>
  p.isMachine ? null : p.userId;

const iso = (d: Date | null): string | null => (d ? dateColumnToIso(d) : null);

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'
  );
}

/** A stored row -> what the history rules read. */
export function historyOf(row: HistoryRow, noticeDate: string | null): EmployeeHistory {
  const stored: HistoryState = {
    joinDate: dateColumnToIso(row.joinDate),
    status: row.status,
    probationStartDate: iso(row.probationStartDate),
    internshipEndDate: iso(row.internshipEndDate),
    confirmationDate: iso(row.confirmationDate),
    designation: row.designation,
    teamId: row.teamId,
    grossSalary: row.grossSalary,
  };
  return {
    id: row.id,
    stored,
    baselines:
      row.pastRecordsBaseline && typeof row.pastRecordsBaseline === 'object'
        ? (row.pastRecordsBaseline as EmployeeHistory['baselines'])
        : null,
    events: row.events.map(
      (e): HistoryEvent => ({
        key: `event:${e.id}`,
        type: e.type as EmploymentEventTypeValue,
        source: e.source,
        effectiveDate: dateColumnToIso(e.effectiveDate),
        fromValue: e.fromValue,
        toValue: e.toValue,
        order: Number(e.id),
      }),
    ),
    pastAppraisals: row.pastAppraisals.map(
      (a): StoredPastAppraisal => ({
        key: `appraisal:${a.id}`,
        type: a.type,
        conductedOn: dateColumnToIso(a.conductedOn),
        dueDate: iso(a.dueDate),
        marks: a.marks,
        grade: (a.grade as FormGrade | null) ?? null,
      }),
    ),
    systemAppraisals: row.appraisals.map((a) => ({
      type: a.cycle.type,
      dueDate: iso(a.dueDate),
      periodEnd: dateColumnToIso(a.periodEnd ?? a.cycle.periodEnd),
    })),
    noticeDate: row.status === 'NOTICE' ? noticeDate : null,
  };
}

interface BuiltPlan {
  rowCount: number;
  errors: RowError[];
  alreadyRecorded: number;
  plans: { row: HistoryRow; plan: EmployeePlan }[];
  teamName: Map<string, string>;
}

/** `event:123` / `appraisal:abc` -> which table and id. */
function parseRecordId(
  recordId: string,
): { kind: 'event'; id: bigint } | { kind: 'appraisal'; id: string } {
  const m = /^(event|appraisal):(.+)$/.exec(recordId);
  if (m?.[1] === 'event' && /^\d{1,18}$/.test(m[2]))
    return { kind: 'event', id: BigInt(m[2]) };
  if (m?.[1] === 'appraisal' && /^[A-Za-z0-9_-]{1,64}$/.test(m[2]))
    return { kind: 'appraisal', id: m[2] };
  throw new NotFoundException('Past record not found');
}

/**
 * Past records (0035): an employee's history from before the system, entered
 * by HR through a spreadsheet import or one at a time. Each one is an ordinary
 * employment event (source PAST_RECORD) or a past (paper) appraisal. Writing
 * one never runs an appraisal outcome, generates a document or sends
 * anything: it re-derives the employee from their whole history
 * (`recomputeEmployee`) in the same transaction. Owner/Admin only, org-scoped
 * (a foreign id is a 404). Salaries are never logged or put in an error
 * message.
 */
@Injectable()
export class PastRecordsService {
  constructor(
    private readonly repo: PastRecordsRepository,
    private readonly employees: EmployeesService,
  ) {}

  /** Today's Dhaka date. One place, so tests can pin the clock. */
  protected today(): string {
    return dhakaDateOf(new Date());
  }

  // --- import ---------------------------------------------------------------

  async preview(orgId: string, rows: PastRecordRowDto[]): Promise<PastRecordsPreview> {
    const built = await this.build(this.repo.prisma, orgId, rows);
    return this.toPreview(built);
  }

  /**
   * Re-validates and applies every row in ONE transaction; refuses when any
   * row has an error. Rows already recorded are skipped, so applying the same
   * file twice adds nothing the second time.
   */
  async apply(principal: AuthPrincipal, rows: PastRecordRowDto[]): Promise<PastRecordsApplyResult> {
    const createdBy = actorId(principal);
    try {
      return await this.repo.transaction(async (tx) => {
        const built = await this.build(tx, principal.orgId, rows);
        if (built.errors.length > 0) {
          const n = new Set(built.errors.map((e) => e.row)).size;
          throw new BadRequestException(
            `${n} row${n === 1 ? ' has' : 's have'} errors: nothing was applied. Run the preview to see them.`,
          );
        }
        let events = 0;
        let appraisals = 0;
        let employeesUpdated = 0;
        for (const { row, plan } of built.plans) {
          const r = plan.evaluation.recomputed;
          const changedRecords = plan.events.length + plan.appraisals.length;
          if (changedRecords === 0) continue;
          await this.repo.addEvents(tx, row.id, createdBy, plan.events);
          await this.repo.addAppraisals(tx, row.id, createdBy, plan.appraisals);
          await this.repo.applyEmployeeChanges(tx, row.id, r.changes, r.baselines);
          events += plan.events.length;
          appraisals += plan.appraisals.length;
          if (Object.keys(r.changes).length > 0) employeesUpdated++;
        }
        return {
          eventsAdded: events,
          appraisalsAdded: appraisals,
          alreadyRecorded: built.alreadyRecorded,
          employeesUpdated,
        };
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ConflictException(
          'Some of these records were added by someone else just now. Run the preview again.',
        );
      throw e;
    }
  }

  private async build(db: Db, orgId: string, rows: PastRecordRowDto[]): Promise<BuiltPlan> {
    const [histories, teams] = await Promise.all([
      this.repo.orgHistories(db, orgId),
      this.repo.teams(db, orgId),
    ]);
    const byEmail = new Map(histories.map((h) => [h.email.toLowerCase(), h]));
    const byCode = new Map(
      histories.flatMap((h) => (h.employeeCode ? [[h.employeeCode.trim().toLowerCase(), h] as const] : [])),
    );
    const teamIdsByName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const errors: RowError[] = [];
    const grouped = new Map<string, { row: HistoryRow; rows: IncomingRow[] }>();

    rows.forEach((input, i) => {
      const rowNumber = input.row ?? i + 2;
      const n = normalizeRow(input as PastRecordRowInput);
      if (!n.ok) {
        for (const f of n.errors) errors.push({ row: rowNumber, ...f });
        return;
      }
      const employee = this.match(n.employee as EmployeeRef, byEmail, byCode);
      if (!employee) {
        const ref = n.employee as EmployeeRef;
        errors.push({
          row: rowNumber,
          field: 'employee',
          message:
            'email' in ref
              ? `No employee with the email ${ref.email}`
              : `No employee with the code ${ref.code}`,
        });
        return;
      }
      if (employee.status === 'EXITED') {
        errors.push({
          row: rowNumber,
          field: 'employee',
          message: `${employee.fullName} has exited; their record is read-only`,
        });
        return;
      }
      const g = grouped.get(employee.id) ?? { row: employee, rows: [] };
      g.rows.push({ row: rowNumber, record: n.record });
      grouped.set(employee.id, g);
    });

    const today = this.today();
    const plans: BuiltPlan['plans'] = [];
    let alreadyRecorded = 0;
    for (const { row, rows: incoming } of grouped.values()) {
      const notice =
        row.status === 'NOTICE' ? iso(await this.repo.latestNoticeDate(db, row.id)) : null;
      const plan = planEmployeeImport({
        employee: historyOf(row, notice),
        rows: incoming,
        today,
        teamIdsByName,
      });
      errors.push(...plan.rowErrors);
      alreadyRecorded += plan.alreadyRecorded.length;
      plans.push({ row, plan });
    }
    errors.sort((a, b) => a.row - b.row);
    return { rowCount: rows.length, errors, alreadyRecorded, plans, teamName };
  }

  private match(
    ref: EmployeeRef,
    byEmail: Map<string, HistoryRow>,
    byCode: Map<string, HistoryRow>,
  ): HistoryRow | null {
    if ('email' in ref) return byEmail.get(ref.email) ?? null;
    return byCode.get(ref.code.trim().toLowerCase()) ?? null;
  }

  private toPreview(built: BuiltPlan): PastRecordsPreview {
    const side = (o: EmployeePlan['evaluation']['before']): SummarySide => ({
      ...o,
      teamName: o.teamId ? (built.teamName.get(o.teamId) ?? null) : null,
    });
    const employees: PastRecordsEmployeeSummary[] = built.plans.map(({ row, plan }) => {
      const { before, after, warnings } = plan.evaluation;
      const fields = [
        'status',
        'designation',
        'teamId',
        'grossSalary',
        'joinDate',
        'probationStartDate',
        'confirmationDate',
      ] as const;
      const errorRows = new Set(plan.rowErrors.map((e) => e.row));
      return {
        employeeId: row.id,
        fullName: row.fullName,
        email: row.email,
        employeeCode: row.employeeCode,
        before: side(before),
        after: side(after),
        changed: fields.filter((f) => before[f] !== after[f]),
        overdueCleared: before.overdue.filter(
          (b) => !after.overdue.some((a) => a.type === b.type && a.dueDate === b.dueDate),
        ),
        eventsToAdd: plan.events.length,
        appraisalsToAdd: plan.appraisals.length,
        alreadyRecorded: plan.alreadyRecorded.length,
        rowsWithErrors: errorRows.size,
        warnings,
      };
    });
    const recordsToAdd = employees.reduce((n, e) => n + e.eventsToAdd + e.appraisalsToAdd, 0);
    return {
      rowCount: built.rowCount,
      errors: built.errors,
      alreadyRecorded: built.alreadyRecorded,
      recordsToAdd,
      employees,
    };
  }

  // --- one employee -----------------------------------------------------------

  async list(orgId: string, employeeId: string): Promise<EmployeePastRecords> {
    await this.employees.getProfile(orgId, employeeId); // 404 for a foreign id
    const [events, appraisals] = await Promise.all([
      this.repo.pastEvents(employeeId),
      this.repo.pastAppraisals(employeeId),
    ]);
    return {
      events: await this.employees.eventViews(orgId, events),
      appraisals: await this.appraisalViews(appraisals),
    };
  }

  async add(principal: AuthPrincipal, employeeId: string, dto: PastRecordDto): Promise<EmployeePastRecords> {
    const ctx = await this.context(principal.orgId, employeeId);
    const record = await this.planned(ctx, dto, 'new:1');
    const { events, appraisals } = this.withRecord(ctx.history, record, null);
    if (record.kind === 'event' && record.event.type === 'JOINED' && record.event.date === ctx.history.stored.joinDate)
      throw new ConflictException(`Already recorded: ${record.event.date} is the join date`);
    await this.commit(ctx, events, appraisals, [], async (tx) => {
      if (record.kind === 'event')
        await this.repo.addEvents(tx, employeeId, actorId(principal), [record.event]);
      else
        await this.repo.addAppraisals(tx, employeeId, actorId(principal), [
          { ...record.appraisal, documentId: record.documentId ?? null },
        ]);
    });
    return this.list(principal.orgId, employeeId);
  }

  async update(
    principal: AuthPrincipal,
    employeeId: string,
    recordId: string,
    dto: PastRecordDto,
  ): Promise<EmployeePastRecords> {
    const target = parseRecordId(recordId);
    const ctx = await this.context(principal.orgId, employeeId);
    const key = `${target.kind}:${target.id}`;
    const stored = this.requireEditable(ctx, target, key, 'edit');
    const record = await this.planned(ctx, dto, key);
    if (record.kind !== target.kind)
      throw new BadRequestException(
        'A past event cannot become an appraisal (or the other way round): delete it and add a new one',
      );
    if (record.kind === 'event' && stored?.source === 'APP') {
      const join = (t: string) => t === 'JOINED' || t === 'JOINED_AS_INTERN';
      if (join(stored.type) ? !join(record.event.type) : record.event.type !== stored.type)
        throw new BadRequestException(
          join(stored.type)
            ? 'The join can switch between "Joined" and "Joined as intern" only'
            : 'This entry keeps its type: delete it and add the other one instead',
        );
    }
    const { events, appraisals } = this.withRecord(ctx.history, record, key);
    await this.commit(ctx, events, appraisals, [key], async (tx) => {
      const ok =
        record.kind === 'event'
          ? await this.repo.updateEvent(tx, employeeId, target.id as bigint, record.event)
          : await this.repo.updateAppraisal(tx, employeeId, target.id as string, {
              ...record.appraisal,
              documentId: record.documentId,
            });
      if (!ok) throw new NotFoundException('Past record not found');
    });
    return this.list(principal.orgId, employeeId);
  }

  async remove(principal: AuthPrincipal, employeeId: string, recordId: string): Promise<EmployeePastRecords> {
    const target = parseRecordId(recordId);
    const ctx = await this.context(principal.orgId, employeeId);
    const key = `${target.kind}:${target.id}`;
    this.requireEditable(ctx, target, key, 'delete');
    const events = ctx.history.events.filter((e) => e.key !== key);
    const appraisals = ctx.history.pastAppraisals.filter((a) => a.key !== key);
    await this.commit(ctx, events, appraisals, [], async (tx) => {
      const ok =
        target.kind === 'event'
          ? await this.repo.deleteEvent(tx, employeeId, target.id)
          : await this.repo.deleteAppraisal(tx, employeeId, target.id);
      if (!ok) throw new NotFoundException('Past record not found');
    });
    return this.list(principal.orgId, employeeId);
  }

  private async context(orgId: string, employeeId: string) {
    const row = await this.repo.employeeHistory(this.repo.prisma, orgId, employeeId);
    if (!row) throw new NotFoundException('Employee not found');
    assertNotExited(row);
    const notice =
      row.status === 'NOTICE' ? iso(await this.repo.latestNoticeDate(this.repo.prisma, row.id)) : null;
    const teams = await this.repo.teams(this.repo.prisma, orgId);
    return { row, history: historyOf(row, notice), teams };
  }

  /**
   * A past appraisal of this employee, or an event the timeline lets HR change
   * (`eventEditability`: past records, and the app's own events except notice,
   * exit, notes and an approved appraisal's). Returns the stored event.
   */
  private requireEditable(
    ctx: Awaited<ReturnType<PastRecordsService['context']>>,
    target: ReturnType<typeof parseRecordId>,
    key: string,
    action: 'edit' | 'delete',
  ): HistoryRow['events'][number] | null {
    if (target.kind === 'appraisal') {
      if (!ctx.history.pastAppraisals.some((a) => a.key === key))
        throw new NotFoundException('Past record not found');
      return null;
    }
    const e = ctx.row.events.find((x) => x.id === target.id);
    if (!e) throw new NotFoundException('Past record not found');
    const hasPastJoin = ctx.row.events.some(
      (x) => x.source === 'PAST_RECORD' && (x.type === 'JOINED' || x.type === 'JOINED_AS_INTERN'),
    );
    const rules = eventEditability(
      { type: e.type as EmploymentEventTypeValue, source: e.source, appraisalId: e.appraisalId ?? null },
      hasPastJoin,
    );
    if (action === 'edit' && !rules.editable)
      throw new BadRequestException(rules.lockedReason ?? 'This entry cannot be edited: delete it and add a new one');
    if (action === 'delete' && !rules.deletable)
      throw new BadRequestException(
        rules.lockedReason ?? 'The join cannot be deleted: change its date or type instead',
      );
    return e;
  }

  /** The dialog's fields -> a planned record (team name or id resolved; the scan checked). */
  private async planned(
    ctx: Awaited<ReturnType<PastRecordsService['context']>>,
    dto: PastRecordDto,
    key: string,
  ): Promise<
    | { kind: 'event'; event: PlannedEvent }
    | { kind: 'appraisal'; appraisal: PlannedAppraisal; documentId: string | null | undefined }
  > {
    const n = normalizeRow(dto as PastRecordRowInput, { requireEmployee: false });
    if (!n.ok) throw new BadRequestException(n.errors.map((e) => e.message).join('; '));
    const r = n.record;
    if (r.kind === 'appraisal') {
      if (dto.documentId && !(await this.repo.documentOf(ctx.row.id, dto.documentId)))
        throw new BadRequestException('That document does not belong to this employee');
      return {
        kind: 'appraisal',
        appraisal: {
          row: 0,
          key,
          type: r.type,
          conductedOn: r.conductedOn,
          dueDate: r.dueDate,
          marks: r.marks,
          grade: r.grade,
          outcome: r.outcome,
          actions: r.actions,
          notes: r.notes,
        },
        documentId: dto.documentId,
      };
    }
    let { fromValue, toValue } = r;
    if (r.type === 'TRANSFERRED') {
      const find = (v: string | null) =>
        v === null
          ? null
          : (ctx.teams.find((t) => t.id === v) ??
            ctx.teams.find((t) => t.name.trim().toLowerCase() === v.trim().toLowerCase()) ??
            null);
      const to = find(toValue);
      if (!to) throw new BadRequestException(`Unknown team "${toValue}"`);
      toValue = to.id;
      fromValue = fromValue ? (find(fromValue)?.id ?? fromValue) : null;
    }
    return {
      kind: 'event',
      event: { row: 0, key, type: r.type, date: r.date, fromValue, toValue, notes: r.notes },
    };
  }

  /** The history's lists with `record` added (or put in place of `replacing`). */
  private withRecord(
    history: EmployeeHistory,
    record: Awaited<ReturnType<PastRecordsService['planned']>>,
    replacing: string | null,
  ): { events: HistoryEvent[]; appraisals: StoredPastAppraisal[] } {
    if (record.kind === 'event') {
      const e = record.event;
      const old = replacing ? history.events.find((x) => x.key === replacing) : undefined;
      const next: HistoryEvent = {
        key: e.key,
        type: e.type,
        source: old?.source ?? 'PAST_RECORD',
        effectiveDate: e.date,
        fromValue: e.fromValue,
        toValue: e.toValue,
        order: old?.order ?? 1e15,
      };
      return {
        events: [...history.events.filter((x) => x.key !== replacing), next],
        appraisals: history.pastAppraisals,
      };
    }
    const a = record.appraisal;
    return {
      events: history.events,
      appraisals: [
        ...history.pastAppraisals.filter((x) => x.key !== replacing),
        {
          key: a.key,
          type: a.type,
          conductedOn: a.conductedOn,
          dueDate: a.dueDate,
          marks: a.marks,
          grade: a.grade,
        },
      ],
    };
  }

  /**
   * Validates the employee's whole history as it would be, then writes the
   * record and the re-folded employee in one transaction. Every past record
   * is re-checked, so an edit or delete that would leave another one invalid
   * (a confirmation with no probation before it) is refused.
   */
  private async commit(
    ctx: Awaited<ReturnType<PastRecordsService['context']>>,
    events: HistoryEvent[],
    appraisals: StoredPastAppraisal[],
    /** Edited app events: checked like the past records. */
    alsoChanged: string[],
    write: (tx: Parameters<Parameters<PastRecordsRepository['transaction']>[0]>[0]) => Promise<void>,
  ): Promise<void> {
    const history = ctx.history;
    const changed = new Set([
      ...events.filter((e) => e.source === 'PAST_RECORD').map((e) => e.key),
      ...appraisals.map((a) => a.key),
      ...alsoChanged,
    ]);
    const evaluation = evaluateHistory({
      employee: history,
      events,
      pastAppraisals: appraisals,
      changed,
      today: this.today(),
      knownTeamIds: new Set(ctx.teams.map((t) => t.id)),
    });
    if (evaluation.errors.size > 0) {
      const own = new Set(pastRecordKeys(history));
      const messages = [...evaluation.errors].flatMap(([key, list]) =>
        list.map((m) => (own.has(key) ? `${describeStored(history, key)}: ${m}` : m)),
      );
      throw new BadRequestException(messages.join('; '));
    }
    const r = evaluation.recomputed;
    try {
      await this.repo.transaction(async (tx) => {
        await write(tx);
        await this.repo.applyEmployeeChanges(tx, history.id, r.changes, r.baselines);
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ConflictException('There is already a past record of this type on this date');
      throw e;
    }
  }

  private async appraisalViews(rows: PastAppraisalRow[]): Promise<PastAppraisalView[]> {
    const users = await this.repo.userNames([
      ...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : []))),
    ]);
    const name = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
    return rows.map((r) => ({
      id: `appraisal:${r.id}`,
      type: r.type,
      conductedOn: dateColumnToIso(r.conductedOn),
      dueDate: iso(r.dueDate),
      marks: r.marks,
      grade: (r.grade as FormGrade | null) ?? null,
      outcome: r.outcome,
      actions: r.actions,
      notes: r.notes,
      document:
        r.document && !r.document.deletedAt
          ? { id: r.document.id, fileName: r.document.fileName }
          : null,
      createdByName: r.createdBy ? (name.get(r.createdBy) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
