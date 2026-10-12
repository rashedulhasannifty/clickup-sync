import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal } from '../../auth/auth.types';
import type { EmployeesService } from '../employees.service';
import { isoToDateColumn } from '../people-dates';
import type { HistoryBaselines, HistoryState } from './employee-history';
import type { PlannedAppraisal, PlannedEvent } from './past-record-rules';
import type { PastRecordsRepository } from './past-records.repository';
import { PastRecordsService } from './past-records.service';

const TODAY = '2026-10-12';
const ORG = 'org-1';
const principal = { userId: 'u1', orgId: ORG, role: 'OWNER', email: 'o@x', isMachine: false } as AuthPrincipal;

type EventRow = {
  id: bigint;
  type: string;
  source: 'APP' | 'PAST_RECORD';
  effectiveDate: Date;
  fromValue: string | null;
  toValue: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  appraisalId?: string | null;
};
/** What the repository may change: never an appraisal's event, notice, exit or a note. */
const changeable = (x: EventRow) => !x.appraisalId && !['NOTICE_GIVEN', 'EXITED', 'NOTE'].includes(x.type);
type AppraisalRow = {
  id: string;
  type: string;
  conductedOn: Date;
  dueDate: Date | null;
  marks: number | null;
  grade: string | null;
  outcome: string | null;
  actions: string[];
  notes: string | null;
  documentId: string | null;
  createdBy: string | null;
  createdAt: Date;
};

/** An in-memory stand-in for the repository: just enough of Prisma's shapes. */
class FakeRepo {
  employees: Record<string, unknown>[] = [];
  nextEvent = 1000n;
  nextAppraisal = 1;
  writes = 0;
  prisma = {};
  teamsList = [{ id: 'team-platform', name: 'Platform' }];

  employee(id: string) {
    return this.employees.find((e) => e.id === id) as Record<string, any>;
  }
  transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    // All-or-nothing: snapshot, and restore if the callback throws.
    const snapshot = structuredClone(this.employees);
    return fn({}).catch((e) => {
      this.employees = snapshot;
      throw e;
    });
  }
  orgHistories(_db: unknown, orgId: string) {
    return Promise.resolve(structuredClone(this.employees.filter((e) => e.orgId === orgId)));
  }
  employeeHistory(_db: unknown, orgId: string, id: string) {
    const e = this.employees.find((x) => x.id === id && x.orgId === orgId);
    return Promise.resolve(e ? structuredClone(e) : null);
  }
  teams() {
    return Promise.resolve(this.teamsList);
  }
  latestNoticeDate() {
    return Promise.resolve(null);
  }
  addEvents(_db: unknown, employeeId: string, createdBy: string | null, events: PlannedEvent[]) {
    for (const e of events) {
      const list = this.employee(employeeId).events as EventRow[];
      if (list.some((x) => x.source === 'PAST_RECORD' && x.type === e.type && +x.effectiveDate === +isoToDateColumn(e.date)))
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      list.push({
        id: this.nextEvent++,
        type: e.type,
        source: 'PAST_RECORD',
        effectiveDate: isoToDateColumn(e.date),
        fromValue: e.fromValue,
        toValue: e.toValue,
        notes: e.notes,
        createdBy,
        createdAt: new Date(),
      });
      this.writes++;
    }
    return Promise.resolve([]);
  }
  addAppraisals(_db: unknown, employeeId: string, createdBy: string | null, rows: (PlannedAppraisal & { documentId?: string | null })[]) {
    for (const a of rows) {
      (this.employee(employeeId).pastAppraisals as AppraisalRow[]).push({
        id: `pa${this.nextAppraisal++}`,
        type: a.type,
        conductedOn: isoToDateColumn(a.conductedOn),
        dueDate: a.dueDate ? isoToDateColumn(a.dueDate) : null,
        marks: a.marks,
        grade: a.grade,
        outcome: a.outcome,
        actions: a.actions,
        notes: a.notes,
        documentId: a.documentId ?? null,
        createdBy,
        createdAt: new Date(),
      });
      this.writes++;
    }
    return Promise.resolve([]);
  }
  updateEvent(_db: unknown, employeeId: string, id: bigint, e: PlannedEvent) {
    const row = (this.employee(employeeId).events as EventRow[]).find((x) => x.id === id && changeable(x));
    if (!row) return Promise.resolve(false);
    Object.assign(row, { type: e.type, effectiveDate: isoToDateColumn(e.date), fromValue: e.fromValue, toValue: e.toValue, notes: e.notes });
    return Promise.resolve(true);
  }
  deleteEvent(_db: unknown, employeeId: string, id: bigint) {
    const emp = this.employee(employeeId);
    const before = emp.events.length;
    emp.events = (emp.events as EventRow[]).filter((x) => !(x.id === id && changeable(x)));
    return Promise.resolve(emp.events.length < before);
  }
  updateAppraisal(_db: unknown, employeeId: string, id: string, a: PlannedAppraisal) {
    const row = (this.employee(employeeId).pastAppraisals as AppraisalRow[]).find((x) => x.id === id);
    if (!row) return Promise.resolve(false);
    Object.assign(row, { type: a.type, conductedOn: isoToDateColumn(a.conductedOn), marks: a.marks, grade: a.grade });
    return Promise.resolve(true);
  }
  deleteAppraisal(_db: unknown, employeeId: string, id: string) {
    const emp = this.employee(employeeId);
    emp.pastAppraisals = (emp.pastAppraisals as AppraisalRow[]).filter((x) => x.id !== id);
    return Promise.resolve(true);
  }
  applyEmployeeChanges(_db: unknown, employeeId: string, changes: Partial<HistoryState>, baselines: HistoryBaselines) {
    const emp = this.employee(employeeId);
    const date = (v: string | null) => (v ? isoToDateColumn(v) : null);
    for (const [k, v] of Object.entries(changes))
      emp[k] = ['joinDate', 'probationStartDate', 'internshipEndDate', 'confirmationDate'].includes(k)
        ? date(v as string | null)
        : v;
    emp.pastRecordsBaseline = Object.keys(baselines).length ? structuredClone(baselines) : null;
    return Promise.resolve();
  }
  pastEvents(employeeId: string) {
    return Promise.resolve((this.employee(employeeId).events as EventRow[]).filter((e) => e.source === 'PAST_RECORD'));
  }
  pastAppraisals(employeeId: string) {
    return Promise.resolve(
      (this.employee(employeeId).pastAppraisals as AppraisalRow[]).map((a) => ({ ...a, document: null })),
    );
  }
  documentOf() {
    return Promise.resolve(true);
  }
  userNames() {
    return Promise.resolve([]);
  }
}

function seedEmployee(repo: FakeRepo, over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? `e${repo.employees.length + 1}`;
  repo.employees.push({
    id,
    orgId: ORG,
    fullName: 'Ana',
    email: 'ana@x.test',
    employeeCode: 'E-1',
    status: 'ACTIVE',
    joinDate: isoToDateColumn('2024-05-01'),
    probationStartDate: isoToDateColumn('2024-05-01'),
    internshipEndDate: null,
    confirmationDate: null,
    designation: 'Unassigned',
    teamId: null,
    grossSalary: 30000,
    pastRecordsBaseline: null,
    events: [
      {
        id: BigInt(repo.employees.length + 1),
        type: 'JOINED',
        source: 'APP',
        effectiveDate: isoToDateColumn('2024-05-01'),
        fromValue: null,
        toValue: null,
        notes: null,
        createdBy: null,
        createdAt: new Date(),
      },
    ],
    pastAppraisals: [],
    appraisals: [],
    ...over,
  });
  return id;
}

function makeService(repo: FakeRepo) {
  const employees = {
    getProfile: (orgId: string, id: string) =>
      repo.employees.some((e) => e.id === id && e.orgId === orgId)
        ? Promise.resolve({})
        : Promise.reject(new NotFoundException('Employee not found')),
    eventViews: (_orgId: string, events: EventRow[]) =>
      Promise.resolve(events.map((e) => ({ id: e.id.toString(), type: e.type, source: e.source }))),
  } as unknown as EmployeesService;
  const svc = new PastRecordsService(repo as unknown as PastRecordsRepository, employees);
  jest.spyOn(svc as unknown as { today: () => string }, 'today').mockReturnValue(TODAY);
  return svc;
}

const history = [
  { row: 2, employee: 'ANA@x.test', record: 'Joined as intern', date: '01/01/2022' },
  { row: 3, employee: 'e-1', record: 'Moved to probation', date: '2022-04-01' },
  { row: 4, employee: 'ana@x.test', record: 'Confirmed', date: '2022-10-01' },
  { row: 5, employee: 'ana@x.test', record: 'Promotion', date: '2025-04-01', to: 'Senior Developer' },
  { row: 6, employee: 'ana@x.test', record: 'Increment', date: '2025-04-01', from: '40,000', to: '46000' },
  { row: 7, employee: 'ana@x.test', record: 'Appraisal', date: '2026-04-03', marks: 84, actions: 'Increment' },
];

describe('PastRecordsService: import', () => {
  it('preview: per-row errors and a per-employee before -> after', async () => {
    const repo = new FakeRepo();
    seedEmployee(repo);
    seedEmployee(repo, { id: 'gone', email: 'gone@x.test', employeeCode: null, fullName: 'Gone', status: 'EXITED' });
    const svc = makeService(repo);
    const preview = await svc.preview(ORG, [
      ...history,
      { row: 8, employee: 'nobody@x.test', record: 'Confirmed', date: '2022-01-01' },
      { row: 9, employee: 'gone@x.test', record: 'Confirmed', date: '2022-01-01' },
      { row: 10, employee: 'ana@x.test', record: 'Bonus', date: '2022-01-01' },
    ] as never);
    expect(preview.errors).toEqual([
      { row: 8, field: 'employee', message: 'No employee with the email nobody@x.test' },
      { row: 9, field: 'employee', message: 'Gone has exited; their record is read-only' },
      { row: 10, field: 'record', message: expect.stringMatching(/Unknown record type "Bonus"/) },
    ]);
    expect(preview).toMatchObject({ rowCount: 9, alreadyRecorded: 0, recordsToAdd: 6 });
    expect(preview.employees).toHaveLength(1);
    const [ana] = preview.employees;
    expect(ana).toMatchObject({
      fullName: 'Ana',
      eventsToAdd: 5,
      appraisalsToAdd: 1,
      before: { status: 'ACTIVE', designation: 'Unassigned', grossSalary: 30000, joinDate: '2024-05-01', confirmationDate: null },
      after: {
        status: 'ACTIVE',
        designation: 'Senior Developer',
        grossSalary: 46000,
        joinDate: '2022-01-01',
        probationStartDate: '2022-04-01',
        confirmationDate: '2022-10-01',
      },
      // The paper appraisal stands for the 1 Apr 2026 yearly; the 1 May one no longer exists.
      overdueCleared: [{ type: 'YEARLY', dueDate: '2026-05-01' }],
      warnings: [],
    });
    expect(ana.changed).toEqual(
      expect.arrayContaining(['designation', 'grossSalary', 'joinDate', 'probationStartDate', 'confirmationDate']),
    );
    // Anchored on the probation start now, the 1 Oct 2026 half-yearly is the one still owed.
    expect(ana.after.overdue).toEqual([{ type: 'HALF_YEARLY', dueDate: '2026-10-01' }]);
    expect(repo.writes).toBe(0); // a preview never writes
  });

  it('apply: refuses the whole file while any row has an error, without quoting salaries', async () => {
    const repo = new FakeRepo();
    seedEmployee(repo);
    const svc = makeService(repo);
    const rows = [...history, { row: 8, employee: 'ana@x.test', record: 'Increment', date: '2025-10-01', from: 50000, to: 45000 }];
    const err = await svc.apply(principal, rows as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe('1 row has errors: nothing was applied. Run the preview to see them.');
    expect(repo.writes).toBe(0);
  });

  it('apply: writes everything and re-derives the employee; applying again adds nothing', async () => {
    const repo = new FakeRepo();
    const id = seedEmployee(repo);
    const svc = makeService(repo);
    const first = await svc.apply(principal, history as never);
    expect(first).toEqual({ eventsAdded: 5, appraisalsAdded: 1, alreadyRecorded: 0, employeesUpdated: 1 });
    const emp = repo.employee(id);
    expect(emp).toMatchObject({
      status: 'ACTIVE',
      designation: 'Senior Developer',
      grossSalary: 46000,
      joinDate: isoToDateColumn('2022-01-01'),
      confirmationDate: isoToDateColumn('2022-10-01'),
      probationStartDate: isoToDateColumn('2022-04-01'),
    });
    expect(emp.pastRecordsBaseline).toMatchObject({
      designation: { designation: 'Unassigned' },
      gross: { grossSalary: 30000 },
      lifecycle: { joinDate: '2024-05-01', status: 'ACTIVE' },
    });
    const writes = repo.writes;
    const second = await svc.apply(principal, history as never);
    expect(second).toEqual({ eventsAdded: 0, appraisalsAdded: 0, alreadyRecorded: 6, employeesUpdated: 0 });
    expect(repo.writes).toBe(writes);
    const preview = await svc.preview(ORG, history as never);
    expect(preview).toMatchObject({ errors: [], alreadyRecorded: 6, recordsToAdd: 0 });
  });

  it('apply: a record added by someone else meanwhile is a 409, and nothing is half-written', async () => {
    const repo = new FakeRepo();
    seedEmployee(repo);
    const svc = makeService(repo);
    const real = repo.addEvents.bind(repo);
    jest.spyOn(repo, 'addEvents').mockImplementation(() => Promise.reject(Object.assign(new Error('u'), { code: 'P2002' })));
    await expect(svc.apply(principal, history as never)).rejects.toBeInstanceOf(ConflictException);
    repo.addEvents = real;
  });
});

describe('PastRecordsService: one employee', () => {
  it('adds, edits and deletes a record; deleting the last one restores the employee', async () => {
    const repo = new FakeRepo();
    const id = seedEmployee(repo);
    const svc = makeService(repo);
    const added = await svc.add(principal, id, { record: 'Promotion', date: '2025-01-01', to: 'Developer' });
    expect(added.events).toHaveLength(1);
    expect(repo.employee(id).designation).toBe('Developer');
    const recordId = `event:${added.events[0].id}`;
    await svc.update(principal, id, recordId, { record: 'Promotion', date: '2025-01-01', to: 'Designer' });
    expect(repo.employee(id).designation).toBe('Designer');
    await svc.remove(principal, id, recordId);
    expect(repo.employee(id).designation).toBe('Unassigned');
    expect(repo.employee(id).pastRecordsBaseline).toBeNull();
  });

  it('an increment and a past appraisal from the dialog', async () => {
    const repo = new FakeRepo();
    const id = seedEmployee(repo);
    const svc = makeService(repo);
    await svc.add(principal, id, { record: 'INCREMENT', date: '2025-07-01', to: '36000', amount: '20%' });
    expect(repo.employee(id).grossSalary).toBe(36000);
    const r = await svc.add(principal, id, { record: 'Appraisal', date: '2026-05-05', grade: 'b', appraisalType: 'Yearly', documentId: 'doc-1' });
    expect(r.appraisals).toEqual([expect.objectContaining({ id: 'appraisal:pa1', grade: 'B', type: 'YEARLY' })]);
  });

  it('refuses invalid records with every reason', async () => {
    const repo = new FakeRepo();
    const id = seedEmployee(repo);
    const svc = makeService(repo);
    await expect(svc.add(principal, id, { record: 'Confirmed', date: '2027-01-01' })).rejects.toThrow(
      'The date is in the future',
    );
    await expect(svc.add(principal, id, { record: 'Joined', date: '2024-05-01' })).rejects.toThrow(/already/i);
    await expect(svc.remove(principal, id, 'event:999')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove(principal, id, 'nonsense')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the app’s join: date, "Joined as intern" and the designation can change; it is never deleted', async () => {
    const repo = new FakeRepo();
    const id = seedEmployee(repo, { status: 'PROBATION' });
    const svc = makeService(repo);
    const join = `event:${(repo.employee(id).events as EventRow[])[0].id}`;
    await svc.update(principal, id, join, { record: 'Joined', date: '2024-03-01', to: 'Senior Software Engineer' });
    expect(repo.employee(id)).toMatchObject({
      joinDate: isoToDateColumn('2024-03-01'),
      probationStartDate: isoToDateColumn('2024-03-01'),
      designation: 'Senior Software Engineer',
      status: 'PROBATION',
    });
    // The app's own row stays the app's: no "From records" tag appears.
    expect((repo.employee(id).events as EventRow[])[0]).toMatchObject({ source: 'APP', toValue: 'Senior Software Engineer' });
    await svc.update(principal, id, join, { record: 'Joined as intern', date: '2024-03-01' });
    expect(repo.employee(id)).toMatchObject({ status: 'INTERN', probationStartDate: null });
    await expect(svc.update(principal, id, join, { record: 'Confirmed', date: '2024-09-01' })).rejects.toThrow(
      /"Joined" and "Joined as intern" only/,
    );
    await expect(svc.remove(principal, id, join)).rejects.toThrow(/cannot be deleted/);
  });

  it('the app’s confirmation can be moved or deleted; offboarding and appraisal events stay locked', async () => {
    const repo = new FakeRepo();
    const id = seedEmployee(repo, { confirmationDate: isoToDateColumn('2024-11-01') });
    const app = (n: bigint, type: string, date: string, extra: Partial<EventRow> = {}): EventRow => ({
      id: n, type, source: 'APP', effectiveDate: isoToDateColumn(date), fromValue: null, toValue: null,
      notes: null, createdBy: null, createdAt: new Date(), ...extra,
    });
    (repo.employee(id).events as EventRow[]).push(
      app(50n, 'CONFIRMED', '2024-11-01'),
      app(51n, 'PROMOTED', '2025-06-01', { toValue: 'Lead', fromValue: 'Unassigned', appraisalId: 'appr-1' }),
      app(52n, 'NOTE', '2025-07-01', { notes: 'hi' }),
    );
    const svc = makeService(repo);
    await svc.update(principal, id, 'event:50', { record: 'Confirmed', date: '2024-12-01' });
    expect(repo.employee(id)).toMatchObject({ status: 'ACTIVE', confirmationDate: isoToDateColumn('2024-12-01') });
    await expect(svc.update(principal, id, 'event:50', { record: 'Promotion', date: '2024-12-01', to: 'X' })).rejects.toThrow(
      /keeps its type/,
    );
    await expect(svc.update(principal, id, 'event:51', { record: 'Promotion', date: '2025-06-01', to: 'Boss' })).rejects.toThrow(
      /approved appraisal/,
    );
    await expect(svc.remove(principal, id, 'event:52')).rejects.toThrow(/Notes stay/);
    await svc.remove(principal, id, 'event:50');
    expect(repo.employee(id)).toMatchObject({ status: 'PROBATION', confirmationDate: null });
  });

  it('refuses a delete that would leave another record invalid', async () => {
    const repo = new FakeRepo();
    const id = seedEmployee(repo);
    const svc = makeService(repo);
    await svc.add(principal, id, { record: 'Joined as intern', date: '2022-01-01' });
    const r = await svc.add(principal, id, { record: 'Moved to probation', date: '2022-04-01' });
    await svc.add(principal, id, { record: 'Confirmed', date: '2022-10-01' });
    const probation = r.events.find((e) => e.type === 'PROBATION_STARTED')!;
    await expect(svc.remove(principal, id, `event:${probation.id}`)).rejects.toThrow(
      'Confirmed of 2022-10-01: An intern cannot be confirmed directly: add "Moved to probation" first',
    );
  });

  it('an exited employee is read-only; a foreign employee is a 404', async () => {
    const repo = new FakeRepo();
    const id = seedEmployee(repo, { status: 'EXITED' });
    const other = seedEmployee(repo, { id: 'other-org', orgId: 'org-2', email: 'z@x', employeeCode: null });
    const svc = makeService(repo);
    await expect(svc.add(principal, id, { record: 'Confirmed', date: '2024-06-01' })).rejects.toThrow(/read-only/);
    await expect(svc.add(principal, other, { record: 'Confirmed', date: '2024-06-01' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.list(ORG, other)).rejects.toBeInstanceOf(NotFoundException);
  });
});
