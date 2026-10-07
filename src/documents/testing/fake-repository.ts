import type { EmployeeDocument } from '@prisma/client';
import {
  ReplaceConflictError, type DocumentPatch, type DocumentWithEmployee, type EmployeeRef, type EmployeeWithDocuments, type NewDocumentRow,
} from '../documents.repository';

/** Test-only in-memory stand-in for DocumentsRepository with the same replace/delete semantics. */
export class FakeDocumentsRepository {
  employees: (EmployeeRef & { orgId: string })[] = [];
  docs: EmployeeDocument[] = [];
  /** Set to make the next create() fail, to exercise cleanup paths. */
  failNextCreate = false;
  /** Runs inside replace() after validation but before the conditional update, to simulate a race. */
  beforeReplaceCommit: (() => void) | null = null;

  async findEmployee(orgId: string, employeeId: string): Promise<EmployeeRef | null> {
    const e = this.employees.find((x) => x.id === employeeId && x.orgId === orgId);
    return e ? { id: e.id, fullName: e.fullName, status: e.status } : null;
  }

  async liveForEmployee(employeeId: string): Promise<EmployeeDocument[]> {
    return this.docs.filter((d) => d.employeeId === employeeId && !d.deletedAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findLive(orgId: string, id: string): Promise<DocumentWithEmployee | null> {
    const d = this.docs.find((x) => x.id === id && !x.deletedAt);
    const e = d && this.employees.find((x) => x.id === d.employeeId && x.orgId === orgId);
    return d && e ? { ...d, employee: { orgId } } : null;
  }

  private materialise(row: NewDocumentRow): EmployeeDocument {
    return { ...row, replacedById: null, createdAt: new Date(Date.now() + this.docs.length), deletedAt: null };
  }

  async create(row: NewDocumentRow): Promise<EmployeeDocument> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('db down');
    }
    const d = this.materialise(row);
    this.docs.push(d);
    return d;
  }

  async update(id: string, patch: DocumentPatch): Promise<EmployeeDocument> {
    const d = this.docs.find((x) => x.id === id)!;
    Object.assign(d, patch);
    return d;
  }

  async replace(oldId: string, row: NewDocumentRow): Promise<EmployeeDocument> {
    this.beforeReplaceCommit?.();
    const old = this.docs.find((x) => x.id === oldId);
    if (!old || old.replacedById !== null || old.deletedAt) throw new ReplaceConflictError();
    const created = this.materialise(row);
    this.docs.push(created);
    old.replacedById = created.id;
    return created;
  }

  async softDeleteChain(id: string, at: Date): Promise<number> {
    const ids = [id];
    for (let frontier = [id]; frontier.length; ) {
      frontier = this.docs.filter((d) => d.replacedById && frontier.includes(d.replacedById) && !d.deletedAt).map((d) => d.id);
      ids.push(...frontier);
    }
    let n = 0;
    for (const d of this.docs) if (ids.includes(d.id) && !d.deletedAt) { d.deletedAt = at; n++; }
    return n;
  }

  async employeesWithCurrentDocuments(orgId: string): Promise<EmployeeWithDocuments[]> {
    return this.employees
      .filter((e) => e.orgId === orgId)
      .map((e) => ({ id: e.id, fullName: e.fullName, status: e.status, documents: this.docs.filter((d) => d.employeeId === e.id && !d.deletedAt && d.replacedById === null) }));
  }
}
