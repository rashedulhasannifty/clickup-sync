import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthPrincipal } from "../auth/auth.types";
import { AddEmploymentEventDto } from "./dto/add-employment-event.dto";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { UpdateEmployeeDto } from "./dto/update-employee.dto";
import { toProfile } from "./employee-mapper";
import { EVENT_REQUIRES_TO_VALUE, eventEffects } from "./employment-events";
import {
  EmployeesRepository,
  type EmployeeListFilter,
  type EmployeeProfileUpdate,
  type EmployeeRow,
} from "./employees.repository";
import { dateColumnToIso, dhakaDateOf } from "./people-dates";
import type {
  EmployeeProfile,
  EmploymentEventTypeValue,
  EmploymentEventView,
  ImportFromUsersResult,
} from "./people.types";

/** Imported users have no HR data yet; this is what a lead/admin then edits. */
export const UNASSIGNED_DESIGNATION = "Unassigned";

const normaliseEmail = (e: string) => e.trim().toLowerCase();

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002"
  );
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
    if (dto.teamId) await this.requireTeam(orgId, dto.teamId);
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
        designation: dto.designation.trim(),
        grade: dto.grade?.trim() || null,
        department: dto.department?.trim() || null,
        teamId: dto.teamId ?? null,
        managerId: dto.managerId ?? null,
        joinDate: dto.joinDate,
        createdBy: actorId(principal),
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
    if (dto.joinDate !== undefined) data.joinDate = dto.joinDate;
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

  async listEvents(orgId: string, id: string): Promise<EmploymentEventView[]> {
    await this.require(orgId, id);
    return this.eventViews(orgId, await this.repo.listEvents(id));
  }

  async addEvent(
    principal: AuthPrincipal,
    id: string,
    dto: AddEmploymentEventDto,
  ): Promise<EmploymentEventView> {
    const employee = await this.require(principal.orgId, id);
    const type = dto.type as EmploymentEventTypeValue;
    const toValue = dto.toValue?.trim() || null;
    if (EVENT_REQUIRES_TO_VALUE.has(type) && !toValue) {
      throw new BadRequestException(
        `${type} needs a toValue (${type === "TRANSFERRED" ? "the team id" : "the new designation"})`,
      );
    }

    // TRANSFERRED carries a team id; if it does not resolve to a team in this org
    // the event is still recorded (history is not lost) but the employee keeps their team.
    const team =
      type === "TRANSFERRED" && toValue
        ? await this.repo.findTeamInOrg(principal.orgId, toValue)
        : null;
    const patch = eventEffects({
      type,
      effectiveDate: dto.effectiveDate,
      toValue,
      teamResolves: team !== null,
    });

    const defaultFrom =
      type === "PROMOTED" || type === "DESIGNATION_CHANGED"
        ? employee.designation
        : type === "TRANSFERRED"
          ? employee.teamId
          : null;
    const event = await this.repo.addEvent({
      employeeId: id,
      type,
      effectiveDate: dto.effectiveDate,
      fromValue: dto.fromValue?.trim() || defaultFrom,
      toValue,
      notes: dto.notes?.trim() || null,
      createdBy: actorId(principal),
      patch,
    });
    return (await this.eventViews(principal.orgId, [event]))[0];
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
          fullName: u.name?.trim() || email.split("@")[0],
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
          status: "ACTIVE",
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
      if (e.type === "TRANSFERRED") {
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
      v === null ? null : type === "TRANSFERRED" ? (teamName.get(v) ?? v) : v;
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
    if (!row) throw new NotFoundException("Employee not found");
    return row;
  }

  private async requireTeam(orgId: string, teamId: string): Promise<void> {
    if (!(await this.repo.findTeamInOrg(orgId, teamId)))
      throw new BadRequestException("Unknown team");
  }

  private async requireManager(
    orgId: string,
    managerId: string,
    selfId: string | null,
  ): Promise<void> {
    if (selfId && managerId === selfId)
      throw new BadRequestException("An employee cannot be their own manager");
    if (!(await this.repo.existsInOrg(orgId, managerId)))
      throw new BadRequestException("Unknown manager");
  }

  private translate(e: unknown): Error {
    if (isUniqueViolation(e)) {
      const target = String(
        (e as { meta?: { target?: unknown } }).meta?.target ?? "",
      );
      const field = /email/.test(target)
        ? "email"
        : /employee_code/.test(target)
          ? "employee code"
          : /clickup/.test(target)
            ? "ClickUp user"
            : /user_id/.test(target)
              ? "login"
              : "value";
      return new ConflictException(
        `An employee with this ${field} already exists`,
      );
    }
    return e as Error;
  }
}
