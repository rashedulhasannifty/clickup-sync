import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types';
import type {
  AddOnboardingItemDto,
  UpdateOnboardingItemDto,
} from './dto/onboarding.dto';
import { assertNotExited } from './employee-readonly';
import { EmployeesRepository, type EmployeeRow } from './employees.repository';
import {
  ONBOARDING_GROUP_LABEL,
  ONBOARDING_GROUPS,
  SUGGESTED_DOCUMENT,
  progressOf,
  resolveItemChange,
  resolveLinkedDocument,
} from './onboarding-checklist';
import {
  OnboardingRepository,
  type OnboardingItemPatch,
  type OnboardingItemRow,
} from './onboarding.repository';
import type {
  IssuedEquipment,
  OnboardingItemView,
  OnboardingView,
  Progress,
} from './onboarding.types';

/** A machine credential is not a user row; never store its synthetic id as an actor. */
const actorId = (p: AuthPrincipal): string | null =>
  p.isMachine ? null : p.userId;

const blankToNull = (s: string | undefined | null): string | null =>
  s?.trim() ? s.trim() : null;

/**
 * The joining checklist (the paper "Check List of Joining" form). Owner/Admin only (enforced by
 * the controller); the employee is looked up in the caller's org first, so a foreign id is a 404.
 * An exited employee's checklist is read-only (409 on every write), like the rest of their record.
 *
 * Seeded items (with a `key`) can be marked not applicable but never deleted, so the form's lines
 * stay comparable across employees and `issuedEquipment` keeps stable keys; custom items (no key)
 * can be deleted.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly repo: OnboardingRepository,
    private readonly employees: EmployeesRepository,
  ) {}

  async get(orgId: string, employeeId: string): Promise<OnboardingView> {
    const employee = await this.requireEmployee(orgId, employeeId);
    return this.view(employee);
  }

  /** Seeds the default checklist for an employee who has none (or is missing a default item). Idempotent. */
  async start(
    principal: AuthPrincipal,
    employeeId: string,
  ): Promise<OnboardingView> {
    const employee = await this.requireEmployee(principal.orgId, employeeId);
    assertNotExited(employee);
    await this.repo.seedDefaults(employeeId);
    return this.view(employee);
  }

  async addItem(
    principal: AuthPrincipal,
    employeeId: string,
    dto: AddOnboardingItemDto,
  ): Promise<OnboardingView> {
    const employee = await this.requireEmployee(principal.orgId, employeeId);
    assertNotExited(employee);
    const label = dto.label.trim();
    if (!label) throw new BadRequestException('label must not be blank');
    await this.repo.addItem(employeeId, dto.group, label);
    return this.view(employee);
  }

  async updateItem(
    principal: AuthPrincipal,
    employeeId: string,
    itemId: string,
    dto: UpdateOnboardingItemDto,
  ): Promise<OnboardingView> {
    const employee = await this.requireEmployee(principal.orgId, employeeId);
    assertNotExited(employee);
    const item = await this.requireItem(employeeId, itemId);

    const change = resolveItemChange(
      item,
      {
        done: dto.done,
        notApplicable: dto.notApplicable,
        documentId: dto.documentId,
      },
      actorId(principal),
      new Date(),
    );
    if (!change.ok) throw new BadRequestException(change.error);
    if (
      typeof dto.documentId === 'string' &&
      !(await this.repo.isLinkableDocument(employeeId, dto.documentId))
    )
      throw new BadRequestException(
        'That document is not a current document of this employee',
      );

    const patch: OnboardingItemPatch = { ...change.write };
    if (dto.note !== undefined) patch.note = blankToNull(dto.note);
    if (dto.detail !== undefined) patch.detail = blankToNull(dto.detail);
    if (Object.keys(patch).length > 0)
      await this.repo.updateItem(itemId, patch);
    return this.view(employee);
  }

  async removeItem(
    principal: AuthPrincipal,
    employeeId: string,
    itemId: string,
  ): Promise<OnboardingView> {
    const employee = await this.requireEmployee(principal.orgId, employeeId);
    assertNotExited(employee);
    const item = await this.requireItem(employeeId, itemId);
    if (item.key !== null)
      throw new ConflictException(
        'Items from the standard checklist cannot be removed. Mark it not applicable instead.',
      );
    await this.repo.deleteItem(itemId);
    return this.view(employee);
  }

  /**
   * Equipment handed over at joining (done EQUIPMENT items), for the exit flow to pre-fill what to
   * collect back. Not org-scoped: the caller must already have loaded the employee in its org.
   */
  async issuedEquipment(employeeId: string): Promise<IssuedEquipment[]> {
    return (await this.repo.issuedEquipment(employeeId)).map((i) => ({
      key: i.key,
      label: i.label,
      detail: i.detail,
    }));
  }

  /** Directory progress; employees with no checklist are absent (the directory shows null). */
  progressFor(employeeIds: string[]): Promise<Map<string, Progress>> {
    return this.repo.progressFor(employeeIds);
  }

  // -- helpers --------------------------------------------------------------

  private async requireEmployee(
    orgId: string,
    id: string,
  ): Promise<EmployeeRow> {
    const row = await this.employees.findById(orgId, id);
    if (!row) throw new NotFoundException('Employee not found');
    return row;
  }

  private async requireItem(
    employeeId: string,
    itemId: string,
  ): Promise<OnboardingItemRow> {
    const item = await this.repo.findItem(employeeId, itemId);
    if (!item) throw new NotFoundException('Checklist item not found');
    return item;
  }

  private async view(employee: EmployeeRow): Promise<OnboardingView> {
    const items = await this.repo.listForEmployee(employee.id);
    const actorIds = new Set<string>();
    for (const i of items) {
      if (i.doneBy) actorIds.add(i.doneBy);
      if (i.notApplicableBy) actorIds.add(i.notApplicableBy);
    }
    const hasLinks = items.some((i) => i.documentId !== null);
    const [users, docs] = await Promise.all([
      this.repo.userNames([...actorIds]),
      hasLinks
        ? this.repo.documentsForEmployee(employee.id)
        : Promise.resolve([]),
    ]);
    const nameOf = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
    const name = (id: string | null) => (id ? (nameOf.get(id) ?? null) : null);
    const docsById = new Map(docs.map((d) => [d.id, d]));

    const toView = (i: OnboardingItemRow): OnboardingItemView => {
      const link = resolveLinkedDocument(i.documentId, docsById);
      return {
        id: i.id,
        group: i.group,
        key: i.key,
        label: i.label,
        custom: i.key === null,
        done: i.done,
        doneAt: i.doneAt?.toISOString() ?? null,
        doneByName: name(i.doneBy),
        notApplicable: i.notApplicable,
        notApplicableAt: i.notApplicableAt?.toISOString() ?? null,
        notApplicableByName: name(i.notApplicableBy),
        note: i.note,
        detail: i.detail,
        suggested: i.key ? (SUGGESTED_DOCUMENT[i.key] ?? null) : null,
        documentStatus: link.status,
        document:
          link.status === 'linked'
            ? {
                id: link.document.id,
                fileName: link.document.fileName,
                contentType: link.document.contentType,
                version: link.document.version,
              }
            : null,
      };
    };

    const groups = ONBOARDING_GROUPS.map((group) => {
      const inGroup = items.filter((i) => i.group === group);
      return {
        group,
        label: ONBOARDING_GROUP_LABEL[group],
        ...progressOf(inGroup),
        items: inGroup.map(toView),
      };
    });
    return {
      employeeId: employee.id,
      started: items.length > 0,
      readOnly: employee.status === 'EXITED',
      ...progressOf(items),
      groups,
    };
  }
}
