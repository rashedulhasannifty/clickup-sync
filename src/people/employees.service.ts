import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth.types';
import { AddEmploymentEventDto } from './dto/add-employment-event.dto';
import { assertNotExited } from './employee-readonly';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { defaultInternshipEnd } from '../appraisals/appraisal-schedule';
import { scheduleFieldsOf, toProfile } from './employee-mapper';
import {
  EVENT_REQUIRES_TO_VALUE,
  eventEffects,
  eventPreconditionError,
} from './employment-events';
import {
  EmployeesRepository,
  type EmployeeListFilter,
  type EmployeeProfileUpdate,
  type EmployeeRow,
  type NewEmploymentEvent,
} from './employees.repository';
import { dateColumnToIso, dhakaDateOf } from './people-dates';
import type {
  EmployeeProfile,
  EmploymentEventTypeValue,
  EmploymentEventView,
  ImportFromUsersResult,
} from './people.types';

/** Imported users have no HR data yet; this is what a lead/admin then edits. */
export const UNASSIGNED_DESIGNATION = 'Unassigned';

const normaliseEmail = (e: string) => e.trim().toLowerCase();

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'
  );
}

/** The two events only the offboarding flow may write; the public `addEvent` refuses them. */
export type ExitLifecycleEventType = 'NOTICE_GIVEN' | 'EXITED';

export interface ExitLifecycleEvent {
  type: ExitLifecycleEventType;
  effectiveDate: string;
  notes?: string;
}

/** What an approved appraisal may write to the timeline (see `recordAppraisalOutcome`). */
export interface AppraisalOutcomeEvent {
  type:
    | 'CONFIRMED'
    | 'PROMOTED'
    | 'INCREMENT'
    | 'NOTE'
    | 'PROBATION_STARTED'
    | 'INTERNSHIP_EXTENDED';
  effectiveDate: string;
  /** Omitted: the event's default (the replaced designation for PROMOTED). */
  fromValue?: string | null;
  toValue: string | null;
  notes: string;
}

const EXIT_LIFECYCLE_TYPES: ReadonlySet<string> = new Set([
  'NOTICE_GIVEN',
  'EXITED',
]);

/** The employee's current expected internship end: stored, else join + 3 months. */
const currentInternshipEnd = (row: EmployeeRow): string => {
  const s = scheduleFieldsOf(row);
  return s.internshipEndDate ?? defaultInternshipEnd(s.joinDate);
};

/**
 * The lifecycle dates of a new or edited employee (0034), validated as a
 * whole: an intern has an internship end after the join date and no
 * probation start; anyone else has a probation start on or after the join
 * date and no internship end of their own to set.
 */
function lifecycleError(a: {
  status: string;
  joinDate: string;
  probationStartDate: string | null;
  internshipEndDate: string | null;
}): string | null {
  if (a.status === 'INTERN') {
    if (a.probationStartDate)
      return 'An intern has no probation start date yet: record "Moved to probation" when it starts';
    if (a.internshipEndDate !== null && a.internshipEndDate <= a.joinDate)
      return 'The internship end must be after the join date';
    return null;
  }
  if (a.probationStartDate !== null && a.probationStartDate < a.joinDate)
    return 'Probation cannot start before the join date';
  return null;
}

/** A machine credential is not a user row; never store its synthetic id as an actor. */
const actorId = (p: AuthPrincipal): string | null =>
  p.isMachine ? null : p.userId;

/**
 * Employee records and their employment history. Owner/Admin only (enforced by
 * the controller). Every query is org-scoped by the caller's `orgId`; a foreign
 * id is a 404, never a 403 that would confirm it exists.
 */
@Injectable()
export class EmployeesService {
  constructor(private readonly repo: EmployeesRepository) {}

  async getProfile(orgId: string, id: string): Promise<EmployeeProfile> {
    return toProfile(await this.require(orgId, id), dhakaDateOf(new Date()));
  }

  async list(
    orgId: string,
    filter: EmployeeListFilter,
  ): Promise<EmployeeRow[]> {
    return this.repo.list(orgId, filter);
  }

  async create(
    principal: AuthPrincipal,
    dto: CreateEmployeeDto,
  ): Promise<EmployeeProfile> {
    const orgId = principal.orgId;
    const email = normaliseEmail(dto.email);
    const status = dto.status ?? 'PROBATION';
    if (status !== 'INTERN' && dto.internshipEndDate)
      throw new BadRequestException(
        'internshipEndDate is only for an INTERN',
      );
    const internshipEndDate =
      status === 'INTERN'
        ? (dto.internshipEndDate ?? defaultInternshipEnd(dto.joinDate))
        : null;
    const lifecycle = lifecycleError({
      status,
      joinDate: dto.joinDate,
      probationStartDate: dto.probationStartDate ?? null,
      internshipEndDate,
    });
    if (lifecycle) throw new BadRequestException(lifecycle);
    if (dto.teamId) await this.requireTeam(orgId, dto.teamId);
    if (dto.shiftId) await this.requireShift(orgId, dto.shiftId);
    if (dto.managerId) await this.requireManager(orgId, dto.managerId, null);

    // Linking is by email: an existing login in this org with the same address.
    const user = await this.repo.findUserByEmail(orgId, email);
    const linkable = user && !user.employee ? user : null;

    try {
      const row = await this.repo.create({
        orgId,
        fullName: dto.fullName.trim(),
        email,
        employeeCode: dto.employeeCode?.trim() || null,
        userId: linkable?.id ?? null,
        clickupUserId: dto.clickupUserId ?? linkable?.clickupUserId ?? null,
        attendanceId: dto.attendanceId ?? null,
        shiftId: dto.shiftId ?? null,
        designation: dto.designation.trim(),
        grade: dto.grade?.trim() || null,
        department: dto.department?.trim() || null,
        teamId: dto.teamId ?? null,
        managerId: dto.managerId ?? null,
        joinDate: dto.joinDate,
        status,
        // Defaults to the join date in the repository (null for an intern).
        ...(dto.probationStartDate
          ? { probationStartDate: dto.probationStartDate }
          : {}),
        internshipEndDate,
        createdBy: actorId(principal),
        concernName: dto.concernName?.trim() || null,
        academicQualification: dto.academicQualification?.trim() || null,
        experienceBeforeJoiningMonths: dto.experienceBeforeJoiningMonths ?? null,
        startingSalary: dto.startingSalary ?? null,
        grossSalary: dto.grossSalary ?? null,
      });
      return toProfile(row, dhakaDateOf(new Date()));
    } catch (e) {
      throw this.translate(e);
    }
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeProfile> {
    const current = await this.require(orgId, id);
    assertNotExited(current);
    const data: EmployeeProfileUpdate = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.designation !== undefined)
      data.designation = dto.designation.trim();
    if (dto.employeeCode !== undefined)
      data.employeeCode = dto.employeeCode?.trim() || null;
    if (dto.grade !== undefined) data.grade = dto.grade?.trim() || null;
    if (dto.department !== undefined)
      data.department = dto.department?.trim() || null;
    if (dto.clickupUserId !== undefined) data.clickupUserId = dto.clickupUserId;
    if (dto.attendanceId !== undefined) data.attendanceId = dto.attendanceId;
    if (dto.shiftId !== undefined) {
      if (dto.shiftId !== null) await this.requireShift(orgId, dto.shiftId);
      data.shiftId = dto.shiftId;
    }
    if (dto.joinDate !== undefined) data.joinDate = dto.joinDate;
    Object.assign(data, this.lifecycleUpdate(current, dto));
    if (dto.concernName !== undefined)
      data.concernName = dto.concernName?.trim() || null;
    if (dto.academicQualification !== undefined)
      data.academicQualification = dto.academicQualification?.trim() || null;
    for (const k of [
      'experienceBeforeJoiningMonths',
      'startingSalary',
      'grossSalary',
    ] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.teamId !== undefined) {
      if (dto.teamId !== null) await this.requireTeam(orgId, dto.teamId);
      data.teamId = dto.teamId;
    }
    if (dto.managerId !== undefined) {
      if (dto.managerId !== null)
        await this.requireManager(orgId, dto.managerId, id);
      data.managerId = dto.managerId;
    }
    if (dto.email !== undefined) {
      const email = normaliseEmail(dto.email);
      if (email !== current.email) {
        data.email = email;
        // A new address may match a different login; an old link to the previous
        // address's login is dropped rather than left pointing at someone else.
        const user = await this.repo.findUserByEmail(orgId, email);
        data.userId = user && !user.employee ? user.id : null;
        if (
          user &&
          !user.employee &&
          dto.clickupUserId === undefined &&
          !current.clickupUserId
        ) {
          data.clickupUserId = user.clickupUserId;
        }
      }
    }
    try {
      return toProfile(
        await this.repo.update(id, data),
        dhakaDateOf(new Date()),
      );
    } catch (e) {
      throw this.translate(e);
    }
  }

  /**
   * The lifecycle date changes of an edit (0034). An intern's internship end
   * and anyone else's probation start may be corrected; the other one is
   * refused. A probation start that equalled the join date (the default)
   * moves with a corrected join date, so fixing a join date still moves the
   * schedule the way it did before 0034.
   */
  private lifecycleUpdate(
    current: EmployeeRow,
    dto: UpdateEmployeeDto,
  ): Pick<EmployeeProfileUpdate, 'probationStartDate' | 'internshipEndDate'> {
    const s = scheduleFieldsOf(current);
    const intern = current.status === 'INTERN';
    if (intern && dto.probationStartDate !== undefined)
      throw new BadRequestException(
        'An intern has no probation start date yet: record "Moved to probation" when it starts',
      );
    if (!intern && dto.internshipEndDate !== undefined)
      throw new BadRequestException('internshipEndDate is only for an INTERN');
    const joinDate = dto.joinDate ?? s.joinDate;
    const out: Pick<
      EmployeeProfileUpdate,
      'probationStartDate' | 'internshipEndDate'
    > = {};
    let probationStartDate = s.probationStartDate ?? null;
    if (dto.probationStartDate !== undefined) {
      probationStartDate = dto.probationStartDate ?? joinDate;
      out.probationStartDate = probationStartDate;
    } else if (
      !intern &&
      dto.joinDate !== undefined &&
      (probationStartDate === null || probationStartDate === s.joinDate)
    ) {
      probationStartDate = dto.joinDate;
      out.probationStartDate = probationStartDate;
    }
    let internshipEndDate = intern
      ? (s.internshipEndDate ?? defaultInternshipEnd(joinDate))
      : null;
    if (dto.internshipEndDate !== undefined) {
      internshipEndDate =
        dto.internshipEndDate ?? defaultInternshipEnd(joinDate);
      out.internshipEndDate = internshipEndDate;
    }
    const error = lifecycleError({
      status: current.status,
      joinDate,
      probationStartDate: intern ? null : probationStartDate,
      internshipEndDate,
    });
    if (error) throw new BadRequestException(error);
    return out;
  }

  async listEvents(orgId: string, id: string): Promise<EmploymentEventView[]> {
    await this.require(orgId, id);
    return this.eventViews(orgId, await this.repo.listEvents(id));
  }

  /**
   * The public path (controller, appraisals). Refuses NOTICE_GIVEN / EXITED, which only the exit
   * flow may write (`recordExitEvent`), and refuses everything for an exited employee.
   */
  async addEvent(
    principal: AuthPrincipal,
    id: string,
    dto: AddEmploymentEventDto,
  ): Promise<EmploymentEventView> {
    if (EXIT_LIFECYCLE_TYPES.has(dto.type))
      throw new BadRequestException(
        'Notice and exit events are written by the offboarding flow. Use Start offboarding on the employee page.',
      );
    const employee = await this.require(principal.orgId, id);
    assertNotExited(employee);
    return this.writeEvent(principal, employee, dto);
  }

  /**
   * Internal path for `ExitsService`, the only caller allowed to write NOTICE_GIVEN / EXITED. It
   * is a separate method, not a flag on the DTO, so nothing a client sends can reach it. No
   * exited check: completing an exit is what makes the employee exited.
   */
  async recordExitEvent(
    principal: AuthPrincipal,
    id: string,
    event: ExitLifecycleEvent,
  ): Promise<EmploymentEventView> {
    const employee = await this.require(principal.orgId, id);
    return this.writeEvent(principal, employee, event);
  }

  private async writeEvent(
    principal: AuthPrincipal,
    employee: EmployeeRow,
    dto: {
      type: string;
      effectiveDate: string;
      fromValue?: string;
      toValue?: string;
      notes?: string;
    },
  ): Promise<EmploymentEventView> {
    const id = employee.id;
    const type = dto.type as EmploymentEventTypeValue;
    const toValue = dto.toValue?.trim() || null;
    if (EVENT_REQUIRES_TO_VALUE.has(type) && !toValue) {
      throw new BadRequestException(
        `${type} needs a toValue (${type === 'TRANSFERRED' ? 'the team id' : type === 'INTERNSHIP_EXTENDED' ? 'the new internship end date' : 'the new designation'})`,
      );
    }
    const precondition = eventPreconditionError({
      type,
      effectiveDate: dto.effectiveDate,
      toValue,
      status: employee.status,
      joinDate: dateColumnToIso(employee.joinDate),
      internshipEndDate: currentInternshipEnd(employee),
    });
    if (precondition) throw new BadRequestException(precondition);

    // TRANSFERRED carries a team id; if it does not resolve to a team in this org
    // the event is still recorded (history is not lost) but the employee keeps their team.
    const team =
      type === 'TRANSFERRED' && toValue
        ? await this.repo.findTeamInOrg(principal.orgId, toValue)
        : null;
    const patch = eventEffects({
      type,
      effectiveDate: dto.effectiveDate,
      toValue,
      teamResolves: team !== null,
    });

    const defaultFrom =
      type === 'PROMOTED' || type === 'DESIGNATION_CHANGED'
        ? employee.designation
        : type === 'TRANSFERRED'
          ? employee.teamId
          : null;
    const event = await this.repo.addEvent({
      employeeId: id,
      type,
      effectiveDate: dto.effectiveDate,
      // The old end date is where the next internship term starts: never typed.
      fromValue:
        type === 'INTERNSHIP_EXTENDED'
          ? currentInternshipEnd(employee)
          : dto.fromValue?.trim() || defaultFrom,
      toValue,
      notes: dto.notes?.trim() || null,
      createdBy: actorId(principal),
      patch,
    });
    return (await this.eventViews(principal.orgId, [event]))[0];
  }

  /**
   * Internal path for `AppraisalsService`: an approved appraisal's outcome
   * (CONFIRMED / PROMOTED / INCREMENT) as ONE transaction, so a retry after a
   * failure never writes half of it twice. Refused for an exited employee, like
   * every other event. Each event's side-effects come from `eventEffects`, and
   * a PROMOTED event's `fromValue` defaults to the designation it replaces.
   */
  async recordAppraisalOutcome(
    principal: AuthPrincipal,
    id: string,
    events: AppraisalOutcomeEvent[],
  ): Promise<void> {
    const employee = await this.require(principal.orgId, id);
    assertNotExited(employee);
    let designation = employee.designation;
    const batch: NewEmploymentEvent[] = events.map((e) => {
      const toValue = e.toValue?.trim() || null;
      if (EVENT_REQUIRES_TO_VALUE.has(e.type) && !toValue)
        throw new BadRequestException(`${e.type} needs a toValue`);
      const precondition = eventPreconditionError({
        type: e.type,
        effectiveDate: e.effectiveDate,
        toValue,
        status: employee.status,
        joinDate: dateColumnToIso(employee.joinDate),
        internshipEndDate: currentInternshipEnd(employee),
      });
      if (precondition) throw new BadRequestException(precondition);
      const patch = eventEffects({
        type: e.type,
        effectiveDate: e.effectiveDate,
        toValue,
        teamResolves: false,
      });
      const fromValue =
        e.fromValue !== undefined
          ? e.fromValue
          : e.type === 'PROMOTED'
            ? designation
            : null;
      if (patch.designation !== undefined) designation = patch.designation;
      return {
        type: e.type,
        effectiveDate: e.effectiveDate,
        fromValue,
        toValue,
        notes: e.notes.trim() || null,
        patch,
      };
    });
    await this.repo.addEvents(id, actorId(principal), batch);
  }

  /**
   * Puts an employee back on INTERN/PROBATION/ACTIVE with a NOTE event in the same transaction.
   * Used when an offboarding is cancelled: no event type restores a status, and NOTE alone changes
   * nothing.
   */
  async restoreStatus(
    principal: AuthPrincipal,
    id: string,
    status: 'INTERN' | 'PROBATION' | 'ACTIVE',
    notes: string,
  ): Promise<void> {
    const employee = await this.require(principal.orgId, id);
    await this.repo.addEvent({
      employeeId: id,
      type: 'NOTE',
      effectiveDate: dhakaDateOf(new Date()),
      fromValue: employee.status,
      toValue: status,
      notes,
      createdBy: actorId(principal),
      patch: { status },
    });
  }

  /**
   * One employee per ACTIVE login that has none (designation `Unassigned`, join
   * date = when the account was created, status ACTIVE since these people are
   * already working here). Also links existing employees that have no login to
   * a login with the same email.
   */
  async importFromUsers(
    principal: AuthPrincipal,
  ): Promise<ImportFromUsersResult> {
    const orgId = principal.orgId;
    const users = await this.repo.usersWithoutEmployee(orgId);
    const taken = new Set(
      (
        await this.repo.emailsTaken(users.map((u) => normaliseEmail(u.email)))
      ).map((r) => r.email),
    );
    const takenClickup = new Set(
      await this.repo.clickupIdsTaken(
        users.flatMap((u) => (u.clickupUserId ? [u.clickupUserId] : [])),
      ),
    );

    let created = 0;
    for (const u of users) {
      const email = normaliseEmail(u.email);
      if (taken.has(email)) continue; // handled by the relink pass below
      try {
        await this.repo.create({
          orgId,
          fullName: u.name?.trim() || email.split('@')[0],
          email,
          employeeCode: null,
          userId: u.id,
          clickupUserId:
            u.clickupUserId && !takenClickup.has(u.clickupUserId)
              ? u.clickupUserId
              : null,
          designation: UNASSIGNED_DESIGNATION,
          grade: null,
          department: null,
          teamId: null,
          managerId: null,
          joinDate: dhakaDateOf(u.createdAt),
          status: 'ACTIVE',
          createdBy: actorId(principal),
        });
        created++;
      } catch (e) {
        // Raced with another import/create for the same person: that is fine, skip.
        if (!isUniqueViolation(e)) throw e;
      }
    }

    let linked = 0;
    const byEmail = new Map(users.map((u) => [normaliseEmail(u.email), u]));
    for (const emp of await this.repo.unlinkedEmployees(orgId)) {
      const u = byEmail.get(emp.email);
      if (!u || !taken.has(emp.email)) continue;
      try {
        await this.repo.linkIdentity(emp.id, {
          userId: u.id,
          ...(!emp.clickupUserId &&
          u.clickupUserId &&
          !takenClickup.has(u.clickupUserId)
            ? { clickupUserId: u.clickupUserId }
            : {}),
        });
        linked++;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    return { created, linked };
  }

  /** Event rows -> API views, resolving actor names and (for TRANSFERRED) team names in one query each. */
  async eventViews(
    orgId: string,
    events: {
      id: bigint;
      type: EmploymentEventTypeValue;
      effectiveDate: Date;
      fromValue: string | null;
      toValue: string | null;
      notes: string | null;
      createdBy: string | null;
      createdAt: Date;
    }[],
  ): Promise<EmploymentEventView[]> {
    const teamIds = new Set<string>();
    const userIds = new Set<string>();
    for (const e of events) {
      if (e.type === 'TRANSFERRED') {
        if (e.fromValue) teamIds.add(e.fromValue);
        if (e.toValue) teamIds.add(e.toValue);
      }
      if (e.createdBy) userIds.add(e.createdBy);
    }
    const [teams, users] = await Promise.all([
      this.repo.teamNames([...teamIds]),
      this.repo.userNames([...userIds]),
    ]);
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const userName = new Map(
      users.map((u) => [u.id, u.name?.trim() || u.email]),
    );
    const label = (type: EmploymentEventTypeValue, v: string | null) =>
      v === null ? null : type === 'TRANSFERRED' ? (teamName.get(v) ?? v) : v;
    return events.map((e) => ({
      id: e.id.toString(),
      type: e.type,
      effectiveDate: dateColumnToIso(e.effectiveDate),
      fromValue: e.fromValue,
      toValue: e.toValue,
      fromLabel: label(e.type, e.fromValue),
      toLabel: label(e.type, e.toValue),
      notes: e.notes,
      createdByName: e.createdBy ? (userName.get(e.createdBy) ?? null) : null,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  private async require(orgId: string, id: string): Promise<EmployeeRow> {
    const row = await this.repo.findById(orgId, id);
    if (!row) throw new NotFoundException('Employee not found');
    return row;
  }

  private async requireShift(orgId: string, shiftId: string): Promise<void> {
    if (!(await this.repo.findShiftInOrg(orgId, shiftId)))
      throw new BadRequestException('Unknown shift');
  }

  private async requireTeam(orgId: string, teamId: string): Promise<void> {
    if (!(await this.repo.findTeamInOrg(orgId, teamId)))
      throw new BadRequestException('Unknown team');
  }

  private async requireManager(
    orgId: string,
    managerId: string,
    selfId: string | null,
  ): Promise<void> {
    if (selfId && managerId === selfId)
      throw new BadRequestException('An employee cannot be their own manager');
    if (!(await this.repo.existsInOrg(orgId, managerId)))
      throw new BadRequestException('Unknown manager');
    // A -> B -> ... -> A at any depth, not just A -> A: if the new manager
    // already reports up to this employee, the change would close a loop.
    if (selfId && (await this.repo.managerChain(orgId, managerId)).includes(selfId))
      throw new BadRequestException(
        'That would create a reporting loop: the chosen manager already reports to this employee',
      );
  }

  private translate(e: unknown): Error {
    if (isUniqueViolation(e)) {
      const target = String(
        (e as { meta?: { target?: unknown } }).meta?.target ?? '',
      );
      const field = /email/.test(target)
        ? 'email'
        : /employee_code/.test(target)
          ? 'employee code'
          : /clickup/.test(target)
            ? 'ClickUp user'
            : /attendance_?id/i.test(target)
              ? 'Stellar ID'
            : /user_id/.test(target)
              ? 'login'
              : 'value';
      return new ConflictException(
        `An employee with this ${field} already exists`,
      );
    }
    return e as Error;
  }
}
