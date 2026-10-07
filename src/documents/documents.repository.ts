import { Injectable } from '@nestjs/common';
import type { DocumentCategory, DocumentVisibility, EmployeeDocument, EmployeeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface NewDocumentRow {
  id: string;
  employeeId: string;
  category: DocumentCategory;
  docType: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  version: number;
  expiresOn: Date | null;
  visibility: DocumentVisibility;
  uploadedBy: string | null;
}

export interface DocumentPatch {
  category?: DocumentCategory;
  docType?: string;
  expiresOn?: Date | null;
  visibility?: DocumentVisibility;
}

export interface EmployeeRef {
  id: string;
  fullName: string;
  status: EmployeeStatus;
}

export type DocumentWithEmployee = EmployeeDocument & { employee: { orgId: string } };

export interface EmployeeWithDocuments extends EmployeeRef {
  documents: EmployeeDocument[];
}

/** A live row is one that has not been soft-deleted. A CURRENT row is live and not replaced. */
const CURRENT = { replacedById: null, deletedAt: null } as const;

/** Thrown inside the replace transaction so it rolls back when the row was replaced concurrently. */
export class ReplaceConflictError extends Error {}

@Injectable()
export class DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The employee, only if it belongs to the caller's org. */
  findEmployee(orgId: string, employeeId: string): Promise<EmployeeRef | null> {
    return this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, fullName: true, status: true } });
  }

  /** Every live version of every document an employee has, newest first. */
  liveForEmployee(employeeId: string): Promise<EmployeeDocument[]> {
    return this.prisma.employeeDocument.findMany({ where: { employeeId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  /** A live document (any version), only if its employee is in the caller's org. */
  findLive(orgId: string, id: string): Promise<DocumentWithEmployee | null> {
    return this.prisma.employeeDocument.findFirst({
      where: { id, deletedAt: null, employee: { orgId } },
      include: { employee: { select: { orgId: true } } },
    });
  }

  create(row: NewDocumentRow): Promise<EmployeeDocument> {
    return this.prisma.employeeDocument.create({ data: row });
  }

  update(id: string, patch: DocumentPatch): Promise<EmployeeDocument> {
    return this.prisma.employeeDocument.update({ where: { id }, data: patch });
  }

  /**
   * Inserts `row` as the new current version and points the old row at it, atomically. The old
   * row must still be current: if another replace (or a delete) got there first the conditional
   * update touches nothing and the whole transaction rolls back (`ReplaceConflictError`).
   */
  replace(oldId: string, row: NewDocumentRow): Promise<EmployeeDocument> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeDocument.create({ data: row });
      const res = await tx.employeeDocument.updateMany({ where: { id: oldId, ...CURRENT }, data: { replacedById: created.id } });
      if (res.count !== 1) throw new ReplaceConflictError();
      return created;
    });
  }

  /** Soft-deletes a document AND every older version of it. Objects stay in the bucket. */
  softDeleteChain(id: string, at: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const ids = [id];
      let frontier = [id];
      while (frontier.length > 0) {
        const older = await tx.employeeDocument.findMany({ where: { replacedById: { in: frontier }, deletedAt: null }, select: { id: true } });
        frontier = older.map((o) => o.id);
        ids.push(...frontier);
      }
      const res = await tx.employeeDocument.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: at } });
      return res.count;
    });
  }

  /** Every employee in the org with their CURRENT documents: the input to the company-wide report. */
  employeesWithCurrentDocuments(orgId: string): Promise<EmployeeWithDocuments[]> {
    const where: Prisma.EmployeeWhereInput = { orgId };
    return this.prisma.employee.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        status: true,
        documents: { where: CURRENT, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { fullName: 'asc' },
    });
  }
}
