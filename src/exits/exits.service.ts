import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ExitStatus } from '@prisma/client';
import { UsersService } from '../auth/users.service';
import type { AuthPrincipal } from '../auth/auth.types';
import { DocumentsService } from '../documents/documents.service';
import { EmployeesService } from '../people/employees.service';
import { OnboardingService } from '../people/onboarding.service';
import { dateColumnToIso, dhakaDateOf } from '../people/people-dates';
import type {
  CancelExitDto,
  CompleteExitDto,
  ListExitsQuery,
  SaveInterviewDto,
  StartExitDto,
  UpdateClearanceItemDto,
  UpdateExitDto,
} from './dto/exit.dto';
import {
  ACTIVE_EXIT_STATUSES,
  EXIT_INTERVIEW_ITEM_KEY,
  canDo,
  clearanceItemsFor,
  evaluateCompletion,
  isResolved,
  nextStatus,
  statusBeforeExit,
  validateExitDates,
  type EmployeeStatusName,
  type ExitAction,
  type ExitChecklistGroupValue,
  type ExitTypeValue,
} from './exit-status';
import { buildLetter, LETTER_DOC_TYPE, type LetterKind } from './letter-content';
import { renderLetterPdf } from './letter-pdf';
import {
  ExitsRepository,
  type ExitListItem,
  type ExitRow,
} from './exits.repository';
import type {
  EmployeeExitResponse,
  ExitDocumentView,
  ExitInterviewView,
  ExitListRow,
  ExitView,
} from './exits.types';

const TYPE_LABEL: Record<ExitTypeValue, string> = {
  RESIGNATION: 'Resignation',
  TERMINATION: 'Termination',
  CONTRACT_END: 'Contract end',
  OTHER: 'Other',
};

/** A machine credential is not a user row; never store its synthetic id as an actor. */
const actorId = (p: AuthPrincipal): string | null =>
  p.isMachine ? null : p.userId;

const blankToNull = (s: string | undefined | null): string | null =>
  s?.trim() ? s.trim() : null;

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'
  );
}

const ALLOWED_VERB: Record<ExitAction, string> = {
  edit: 'edited',
  advance: 'advanced',
  complete: 'completed',
  cancel: 'cancelled',
  letters: 'given letters',
};

/**
 * Offboarding. Owner/Admin only (enforced by the controller); every lookup is org-scoped and a
 * foreign id is a 404. The employee's own record changes only through `EmployeesService`
 * (NOTICE_GIVEN on start, EXITED on complete, a NOTE that restores the status on cancel), so the
 * employment history stays the single account of what happened to a person.
 *
 * The exit row and the employee row are written by different repositories, so the service orders
 * the writes to fail safe: a start creates the exit first and deletes it if the event fails, and
 * complete/cancel first claim the status transition (which also stops a double click), then do the
 * employee-side work and put the exit back if that fails.
 */
@Injectable()
export class ExitsService {
  constructor(
    private readonly repo: ExitsRepository,
    private readonly employees: EmployeesService,
    private readonly documents: DocumentsService,
    private readonly users: UsersService,
    private readonly onboarding: OnboardingService,
  ) {}

  // -- reads ----------------------------------------------------------------

  async forEmployee(
    orgId: string,
    employeeId: string,
  ): Promise<EmployeeExitResponse> {
    await this.employees.getProfile(orgId, employeeId); // 404 for a foreign id
    const row = await this.repo.findForEmployee(orgId, employeeId);
    return { exit: row ? await this.toView(orgId, row) : null };
  }

  async list(orgId: string, q: ListExitsQuery): Promise<ExitListRow[]> {
    const statuses: ExitStatus[] | undefined =
      q.status === undefined
        ? undefined
        : q.status === 'active'
          ? [...ACTIVE_EXIT_STATUSES]
          : [q.status];
    return (await this.repo.list(orgId, statuses)).map(toListRow);
  }

  // -- start / edit ---------------------------------------------------------

  async start(
    principal: AuthPrincipal,
    employeeId: string,
    dto: StartExitDto,
  ): Promise<ExitView> {
    const orgId = principal.orgId;
    const employee = await this.employees.getProfile(orgId, employeeId);
    if (employee.status === 'EXITED')
      throw new ConflictException('This employee has already exited');
    const dateProblem = validateExitDates({
      noticeDate: dto.noticeDate,
      lastWorkingDay: dto.lastWorkingDay,
      joinDate: employee.joinDate,
    });
    if (dateProblem) throw new BadRequestException(dateProblem);
    if (await this.repo.hasActive(employeeId)) throw activeExists();

    const reason = blankToNull(dto.reason);
    // What was handed over at joining is on the list of things to collect back.
    const clearanceItems = clearanceItemsFor(
      await this.onboarding.issuedEquipment(employeeId),
    );
    let created: ExitRow;
    try {
      created = await this.repo.create({
        employeeId,
        type: dto.type,
        noticeDate: dto.noticeDate,
        lastWorkingDay: dto.lastWorkingDay,
        reason,
        previousStatus: statusBeforeExit(
          employee.status,
          employee.confirmationDate,
        ),
        createdBy: actorId(principal),
        clearanceItems,
      });
    } catch (e) {
      // The partial unique index: two starts raced past the check above.
      if (isUniqueViolation(e)) throw activeExists();
      throw e;
    }

    try {
      await this.employees.recordExitEvent(principal, employeeId, {
        type: 'NOTICE_GIVEN',
        effectiveDate: dto.noticeDate,
        notes: `${TYPE_LABEL[dto.type]}${reason ? `: ${reason}` : ''}`,
      });
    } catch (e) {
      await this.repo.deleteById(created.id);
      throw e;
    }
    return this.toView(orgId, created);
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateExitDto,
  ): Promise<ExitView> {
    const row = await this.require(orgId, id);
    this.assertCan(row, 'edit');
    const noticeDate = dto.noticeDate ?? dateColumnToIso(row.noticeDate);
    const lastWorkingDay =
      dto.lastWorkingDay ?? dateColumnToIso(row.lastWorkingDay);
    const dateProblem = validateExitDates({
      noticeDate,
      lastWorkingDay,
      joinDate: dateColumnToIso(row.employee.joinDate),
    });
    if (dateProblem) throw new BadRequestException(dateProblem);
    await this.repo.updateDetails(id, {
      type: dto.type,
      noticeDate: dto.noticeDate,
      lastWorkingDay: dto.lastWorkingDay,
      reason: dto.reason === undefined ? undefined : blankToNull(dto.reason),
    });
    return this.reload(orgId, id);
  }

  async saveInterview(
    principal: AuthPrincipal,
    id: string,
    dto: SaveInterviewDto,
  ): Promise<ExitView> {
    const row = await this.require(principal.orgId, id);
    this.assertCan(row, 'edit');
    await this.repo.saveInterview(id, {
      interviewReason: dto.primaryReason ?? null,
      ratingRole: dto.ratingRole ?? null,
      ratingLead: dto.ratingTeamLead ?? null,
      ratingCompensation: dto.ratingCompensation ?? null,
      ratingGrowth: dto.ratingGrowth ?? null,
      ratingEnvironment: dto.ratingEnvironment ?? null,
      interviewFeedback: blankToNull(dto.couldHaveDone),
      wouldRecommend: dto.wouldRecommend ?? null,
      wouldRejoin: dto.wouldRejoin ?? null,
      interviewNotes: blankToNull(dto.notes),
      interviewBy: actorId(principal),
      interviewAt: new Date(),
    });
    // The checklist's "Conduct exit interview" line follows the interview: tick it if still open.
    // Matched by key, so a renamed label still works; a removed or N/A item is left alone.
    await this.repo.markKeyedItemDone(
      id,
      EXIT_INTERVIEW_ITEM_KEY,
      actorId(principal),
    );
    return this.reload(principal.orgId, id);
  }

  // -- clearance checklist --------------------------------------------------

  async addClearanceItem(
    orgId: string,
    id: string,
    label: string,
    group: ExitChecklistGroupValue = 'PROCESS',
  ): Promise<ExitView> {
    const row = await this.require(orgId, id);
    this.assertCan(row, 'edit');
    const clean = label.trim();
    if (!clean) throw new BadRequestException('label must not be blank');
    await this.repo.addItem(id, clean, group);
    return this.reload(orgId, id);
  }

  async updateClearanceItem(
    principal: AuthPrincipal,
    id: string,
    itemId: string,
    dto: UpdateClearanceItemDto,
  ): Promise<ExitView> {
    if (dto.done === true && dto.notApplicable === true)
      throw new BadRequestException(
        'An item is either done or not applicable, not both',
      );
    const row = await this.require(principal.orgId, id);
    this.assertCan(row, 'edit');
    await this.requireItem(id, itemId);
    const actor = actorId(principal);
    const now = new Date();
    const clearDone = { done: false, doneBy: null, doneAt: null };
    const clearNa = {
      notApplicable: false,
      notApplicableBy: null,
      notApplicableAt: null,
    };
    // Done and N/A are mutually exclusive: setting one clears the other. Unsetting one touches
    // only its own fields. `null` (let through by @IsOptional) means "no change", like undefined.
    await this.repo.updateItem(itemId, {
      ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
      ...(dto.note !== undefined ? { note: blankToNull(dto.note) } : {}),
      ...(dto.done === false ? clearDone : {}),
      ...(dto.notApplicable === false ? clearNa : {}),
      ...(dto.done === true
        ? { done: true, doneBy: actor, doneAt: now, ...clearNa }
        : {}),
      ...(dto.notApplicable === true
        ? {
            notApplicable: true,
            notApplicableBy: actor,
            notApplicableAt: now,
            ...clearDone,
          }
        : {}),
    });
    return this.reload(principal.orgId, id);
  }

  async removeClearanceItem(
    orgId: string,
    id: string,
    itemId: string,
  ): Promise<ExitView> {
    const row = await this.require(orgId, id);
    this.assertCan(row, 'edit');
    await this.requireItem(id, itemId);
    await this.repo.deleteItem(itemId);
    return this.reload(orgId, id);
  }

  // -- letters --------------------------------------------------------------

  /**
   * Generates the letter, stores it as an EXIT document and returns it. Regenerating replaces the
   * current document (a new version) rather than adding a second one.
   */
  async generateLetter(
    principal: AuthPrincipal,
    id: string,
    kind: string,
  ): Promise<ExitDocumentView> {
    if (kind !== 'experience' && kind !== 'release')
      throw new BadRequestException('kind must be experience or release');
    const letterKind: LetterKind = kind;
    const row = await this.require(principal.orgId, id);
    this.assertCan(row, 'letters');

    const letter = buildLetter({
      kind: letterKind,
      companyName: await this.repo.organisationName(principal.orgId),
      employeeName: row.employee.fullName,
      employeeCode: row.employee.employeeCode,
      designation: row.employee.designation,
      department: row.employee.department,
      joinDate: dateColumnToIso(row.employee.joinDate),
      noticeDate: dateColumnToIso(row.noticeDate),
      lastWorkingDay: dateColumnToIso(row.lastWorkingDay),
      exitType: row.type,
      issuedOn: dhakaDateOf(new Date()),
    });
    const stored = await this.documents.storeGenerated(
      principal,
      row.employeeId,
      {
        category: 'EXIT',
        docType: LETTER_DOC_TYPE[letterKind],
        fileName: letter.fileName,
        buffer: await renderLetterPdf(letter),
      },
    );
    return toDocumentView(stored);
  }

  // -- life cycle -----------------------------------------------------------

  async advance(orgId: string, id: string): Promise<ExitView> {
    const row = await this.require(orgId, id);
    const next = nextStatus(row.status);
    if (!next)
      throw new ConflictException(
        row.status === 'CLEARANCE'
          ? 'Clearance is the last step. Complete the exit instead.'
          : `A ${row.status.toLowerCase()} offboarding cannot be advanced`,
      );
    if (!(await this.repo.claim(id, [row.status], { status: next })))
      throw changedUnderneath();
    return this.reload(orgId, id);
  }

  async complete(
    principal: AuthPrincipal,
    id: string,
    dto: CompleteExitDto,
  ): Promise<ExitView> {
    const orgId = principal.orgId;
    const row = await this.require(orgId, id);
    if (!canDo(row.status, 'complete'))
      throw new ConflictException(
        row.status === 'COMPLETED'
          ? 'This offboarding is already completed'
          : 'An offboarding can only be completed from the clearance step',
      );
    const overrideNote = blankToNull(dto.overrideNote);
    const verdict = evaluateCompletion(row.items, overrideNote);
    if (!verdict.ok)
      throw new BadRequestException(
        `${verdict.open} clearance item${verdict.open === 1 ? ' is' : 's are'} still open. Mark ${verdict.open === 1 ? 'it' : 'them'} done or not applicable, or complete with an override note.`,
      );

    const userId = row.employee.userId;
    const disableLogin = (dto.disableLogin ?? true) && userId !== null;
    const claimed = await this.repo.claim(id, ['CLEARANCE'], {
      status: 'COMPLETED',
      completedAt: new Date(),
      completedBy: actorId(principal),
      overrideNote: verdict.overridden ? overrideNote : null,
      loginDisabled: disableLogin,
    });
    if (!claimed) throw changedUnderneath();

    try {
      // Login first: UsersService refuses what the caller may not do (an Admin disabling an Owner,
      // the last Owner), and that must leave the exit exactly as it was. It is idempotent, so a
      // retry after a later failure is safe.
      if (disableLogin && userId)
        await this.users.setStatus(principal, userId, 'DISABLED');
      await this.employees.recordExitEvent(principal, row.employeeId, {
        type: 'EXITED',
        effectiveDate: dateColumnToIso(row.lastWorkingDay),
        notes: verdict.overridden
          ? `Offboarding completed with ${verdict.open} open clearance item${verdict.open === 1 ? '' : 's'}: ${overrideNote}`
          : 'Offboarding completed',
      });
    } catch (e) {
      await this.repo.claim(id, ['COMPLETED'], {
        status: 'CLEARANCE',
        completedAt: null,
        completedBy: null,
        overrideNote: null,
        loginDisabled: false,
      });
      throw e;
    }
    return this.reload(orgId, id);
  }

  async cancel(
    principal: AuthPrincipal,
    id: string,
    dto: CancelExitDto,
  ): Promise<ExitView> {
    const orgId = principal.orgId;
    const row = await this.require(orgId, id);
    this.assertCan(row, 'cancel');
    const note = blankToNull(dto.note);
    if (!note) throw new BadRequestException('note must not be blank');

    const claimed = await this.repo.claim(id, [row.status], {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy: actorId(principal),
      cancelNote: note,
    });
    if (!claimed) throw changedUnderneath();

    try {
      // Only undo the NOTICE this exit started. Someone who was moved on by hand in the meantime
      // keeps the status they were given.
      if (row.employee.status === 'NOTICE') {
        await this.employees.restoreStatus(
          principal,
          row.employeeId,
          row.previousStatus === 'ACTIVE' || row.previousStatus === 'INTERN'
            ? row.previousStatus
            : 'PROBATION',
          `Offboarding cancelled: ${note}`,
        );
      }
    } catch (e) {
      await this.repo.claim(id, ['CANCELLED'], {
        status: row.status,
        cancelledAt: null,
        cancelledBy: null,
        cancelNote: null,
      });
      throw e;
    }
    return this.reload(orgId, id);
  }

  // -- helpers --------------------------------------------------------------

  private async require(orgId: string, id: string): Promise<ExitRow> {
    const row = await this.repo.findById(orgId, id);
    if (!row) throw new NotFoundException('Offboarding not found');
    return row;
  }

  private async requireItem(exitId: string, itemId: string): Promise<void> {
    if (!(await this.repo.findItem(exitId, itemId)))
      throw new NotFoundException('Clearance item not found');
  }

  private assertCan(row: ExitRow, action: ExitAction): void {
    if (!canDo(row.status, action))
      throw new ConflictException(
        `A ${row.status.toLowerCase()} offboarding cannot be ${ALLOWED_VERB[action]}`,
      );
  }

  private async reload(orgId: string, id: string): Promise<ExitView> {
    return this.toView(orgId, await this.require(orgId, id));
  }

  private async toView(orgId: string, row: ExitRow): Promise<ExitView> {
    const actorIds = new Set<string>();
    for (const i of row.items) {
      if (i.doneBy) actorIds.add(i.doneBy);
      if (i.notApplicableBy) actorIds.add(i.notApplicableBy);
    }
    if (row.interviewBy) actorIds.add(row.interviewBy);
    if (row.completedBy) actorIds.add(row.completedBy);
    const [docs, users] = await Promise.all([
      this.documents.currentInCategory(orgId, row.employeeId, 'EXIT'),
      this.repo.userNames([...actorIds]),
    ]);
    const nameOf = new Map(
      users.map((u) => [u.id, u.name?.trim() || u.email]),
    );
    const name = (id: string | null) => (id ? (nameOf.get(id) ?? null) : null);

    const interview: ExitInterviewView | null = row.interviewAt
      ? {
          primaryReason: row.interviewReason,
          ratings: {
            role: row.ratingRole,
            teamLead: row.ratingLead,
            compensation: row.ratingCompensation,
            growth: row.ratingGrowth,
            environment: row.ratingEnvironment,
          },
          couldHaveDone: row.interviewFeedback,
          wouldRecommend: row.wouldRecommend,
          wouldRejoin: row.wouldRejoin,
          notes: row.interviewNotes,
          conductedByName: name(row.interviewBy),
          conductedAt: row.interviewAt.toISOString(),
        }
      : null;

    return {
      id: row.id,
      employee: {
        id: row.employee.id,
        fullName: row.employee.fullName,
        employeeCode: row.employee.employeeCode,
        designation: row.employee.designation,
        department: row.employee.department,
        teamName: row.employee.team?.name ?? null,
        joinDate: dateColumnToIso(row.employee.joinDate),
        status: row.employee.status as EmployeeStatusName,
        hasLogin: row.employee.userId !== null,
      },
      type: row.type,
      status: row.status,
      noticeDate: dateColumnToIso(row.noticeDate),
      lastWorkingDay: dateColumnToIso(row.lastWorkingDay),
      reason: row.reason,
      interview,
      clearance: {
        items: row.items.map((i) => ({
          id: i.id,
          group: i.group,
          key: i.key,
          label: i.label,
          done: i.done,
          doneAt: i.doneAt?.toISOString() ?? null,
          doneByName: name(i.doneBy),
          notApplicable: i.notApplicable,
          notApplicableAt: i.notApplicableAt?.toISOString() ?? null,
          notApplicableByName: name(i.notApplicableBy),
          note: i.note,
        })),
        done: row.items.filter((i) => i.done).length,
        notApplicable: row.items.filter((i) => i.notApplicable).length,
        resolved: row.items.filter(isResolved).length,
        total: row.items.length,
      },
      documents: docs.map(toDocumentView),
      allowed: {
        edit: canDo(row.status, 'edit'),
        advance: canDo(row.status, 'advance'),
        complete: canDo(row.status, 'complete'),
        cancel: canDo(row.status, 'cancel'),
        letters: canDo(row.status, 'letters'),
      },
      overrideNote: row.overrideNote,
      loginDisabled: row.loginDisabled,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedByName: name(row.completedBy),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelNote: row.cancelNote,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

const activeExists = () =>
  new ConflictException('This employee already has an offboarding in progress');

const changedUnderneath = () =>
  new ConflictException(
    'This offboarding was just changed by someone else. Reload and try again.',
  );

function toDocumentView(d: {
  id: string;
  docType: string;
  fileName: string;
  contentType: string;
  version: number;
  createdAt: string;
}): ExitDocumentView {
  return {
    id: d.id,
    docType: d.docType,
    fileName: d.fileName,
    contentType: d.contentType,
    version: d.version,
    createdAt: d.createdAt,
  };
}

function toListRow(r: ExitListItem): ExitListRow {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employee.fullName,
    designation: r.employee.designation,
    teamName: r.employee.team?.name ?? null,
    type: r.type,
    status: r.status,
    noticeDate: dateColumnToIso(r.noticeDate),
    lastWorkingDay: dateColumnToIso(r.lastWorkingDay),
    clearanceResolved: r.items.filter(isResolved).length,
    clearanceTotal: r.items.length,
    createdAt: r.createdAt.toISOString(),
  };
}
