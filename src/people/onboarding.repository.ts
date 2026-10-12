import { Injectable } from '@nestjs/common';
import { Prisma, type OnboardingItem } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  defaultOnboardingRows,
  type ItemWrite,
  type OnboardingGroupValue,
  type Progress,
} from './onboarding-checklist';

export type OnboardingItemRow = OnboardingItem;

export interface LinkedDocumentRow {
  id: string;
  fileName: string;
  contentType: string;
  version: number;
  replacedById: string | null;
  deletedAt: Date | null;
}

export interface OnboardingItemPatch extends ItemWrite {
  note?: string | null;
  detail?: string | null;
}

/**
 * Owns every write to `onboarding_items`. The caller has already checked the employee is in the
 * caller's org; item lookups are then scoped by `employeeId`, so an item id from another employee
 * is "not found".
 */
@Injectable()
export class OnboardingRepository {
  constructor(private readonly prisma: PrismaService) {}

  listForEmployee(employeeId: string): Promise<OnboardingItemRow[]> {
    return this.prisma.onboardingItem.findMany({
      where: { employeeId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Inserts every default item the employee does not have yet. `skipDuplicates` on the
   * `(employee_id, key)` unique index makes this idempotent and safe against a double click.
   * Positions follow the form; a later-added default lands after any custom items.
   */
  async seedDefaults(employeeId: string): Promise<number> {
    const last = await this.prisma.onboardingItem.aggregate({
      where: { employeeId },
      _max: { position: true },
    });
    const offset = last._max.position === null ? 0 : last._max.position + 1;
    const res = await this.prisma.onboardingItem.createMany({
      data: defaultOnboardingRows().map((r) => ({
        employeeId,
        group: r.group,
        key: r.key,
        label: r.label,
        position: offset + r.position,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  findItem(
    employeeId: string,
    itemId: string,
  ): Promise<OnboardingItemRow | null> {
    return this.prisma.onboardingItem.findFirst({
      where: { id: itemId, employeeId },
    });
  }

  async addItem(
    employeeId: string,
    group: OnboardingGroupValue,
    label: string,
  ): Promise<void> {
    const last = await this.prisma.onboardingItem.aggregate({
      where: { employeeId },
      _max: { position: true },
    });
    await this.prisma.onboardingItem.create({
      data: {
        employeeId,
        group,
        label,
        key: null,
        position: (last._max.position ?? -1) + 1,
      },
    });
  }

  async updateItem(itemId: string, patch: OnboardingItemPatch): Promise<void> {
    await this.prisma.onboardingItem.update({
      where: { id: itemId },
      data: patch,
    });
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.prisma.onboardingItem.delete({ where: { id: itemId } });
  }

  /** A document a checklist item may link to: this employee's, current (not replaced), not deleted. */
  async isLinkableDocument(
    employeeId: string,
    documentId: string,
  ): Promise<boolean> {
    return (
      (await this.prisma.employeeDocument.count({
        where: {
          id: documentId,
          employeeId,
          deletedAt: null,
          replacedById: null,
        },
      })) > 0
    );
  }

  /** Every version of the employee's documents (incl. deleted), so links can be followed on read. */
  documentsForEmployee(employeeId: string): Promise<LinkedDocumentRow[]> {
    return this.prisma.employeeDocument.findMany({
      where: { employeeId },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        version: true,
        replacedById: true,
        deletedAt: true,
      },
    });
  }

  /** Done EQUIPMENT items, in form order. */
  issuedEquipment(employeeId: string) {
    return this.prisma.onboardingItem.findMany({
      where: { employeeId, group: 'EQUIPMENT', done: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { key: true, label: true, detail: true },
    });
  }

  /** Resolved/total per employee in ONE query; employees with no items are absent from the map. */
  async progressFor(employeeIds: string[]): Promise<Map<string, Progress>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      { employee_id: string; total: number; resolved: number }[]
    >(Prisma.sql`
      SELECT employee_id,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE done OR not_applicable)::int AS resolved
      FROM onboarding_items
      WHERE employee_id IN (${Prisma.join(employeeIds)})
      GROUP BY employee_id
    `);
    return new Map(
      rows.map((r) => [
        r.employee_id,
        { resolved: Number(r.resolved), total: Number(r.total) },
      ]),
    );
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
}
