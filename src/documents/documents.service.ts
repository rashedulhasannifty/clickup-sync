import {
  BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import type { DocumentCategory, DocumentVisibility, EmployeeDocument } from '@prisma/client';
import { assertNotExited } from '../people/employee-readonly';
import { attachmentDelivery } from '../xero/xero-attachment-delivery';
import type { AuthPrincipal } from '../auth/auth.types';
import { DOCUMENT_TYPES, isValidDocType, MAX_UPLOAD_BYTES, type DocumentCategoryName } from './document-catalog';
import {
  buildCompanyReport, classifyExpiry, computeChecklist, todayIsoDhaka, type ChecklistItem, type CompanyCounts, type CompanyRow,
  type ExpiryInfo, type ReportEmployee,
} from './document-report';
import { DOCUMENT_STORAGE, type DocumentStorage } from './document-storage';
import { DocumentsRepository, ReplaceConflictError, type EmployeeRef, type NewDocumentRow } from './documents.repository';
import { sanitizeFileName, sniffFileType, type SniffedType } from './file-sniff';
import type { CompanyDocumentsQueryDto, ReplaceDocumentDto, UpdateDocumentDto, UploadDocumentDto } from './dto/documents.dto';

/** The parts of a multer memory-storage file this service reads. */
export interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface PreviousVersion {
  id: string;
  version: number;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DocumentView {
  id: string;
  employeeId: string;
  category: DocumentCategory;
  docType: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  version: number;
  expiresOn: string | null;
  expiry: ExpiryInfo;
  visibility: DocumentVisibility;
  uploadedBy: string | null;
  createdAt: string;
  previousVersions: PreviousVersion[];
}

export interface EmployeeDocumentsResponse {
  items: DocumentView[];
  checklist: ChecklistItem[];
  /** The doc-type vocabulary per category, for the upload form. */
  docTypes: typeof DOCUMENT_TYPES;
}

export interface CompanyDocumentsResponse {
  counts: CompanyCounts;
  rows: CompanyRow[];
  total: number;
  page: number;
  limit: number;
}

export interface DocumentContent {
  stream: Readable;
  headers: Record<string, string>;
}

const isoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** `YYYY-MM-DD` that is a real calendar date, as a UTC-midnight Date (what a Postgres DATE round-trips as). */
function parseExpiry(iso: string): Date {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new BadRequestException('expiresOn is not a valid date.');
  return d;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly repo: DocumentsRepository,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
  ) {}

  // ── reads ──────────────────────────────────────────────────────────────────

  async listForEmployee(orgId: string, employeeId: string): Promise<EmployeeDocumentsResponse> {
    await this.requireEmployee(orgId, employeeId);
    const live = await this.repo.liveForEmployee(employeeId);
    const today = todayIsoDhaka(new Date());
    const current = live.filter((d) => d.replacedById === null);
    const olderOf = new Map<string, EmployeeDocument>();
    for (const d of live) if (d.replacedById) olderOf.set(d.replacedById, d);
    const items = current.map((d) => {
      const previousVersions: PreviousVersion[] = [];
      for (let p = olderOf.get(d.id); p; p = olderOf.get(p.id)) {
        previousVersions.push({ id: p.id, version: p.version, fileName: p.fileName, sizeBytes: p.sizeBytes, createdAt: p.createdAt.toISOString() });
      }
      return this.toView(d, today, previousVersions);
    });
    const checklist = computeChecklist(
      current.map((d) => ({ id: d.id, docType: d.docType, expiresOn: isoDate(d.expiresOn) })),
      today,
    );
    return { items, checklist, docTypes: DOCUMENT_TYPES };
  }

  async listCompany(orgId: string, q: CompanyDocumentsQueryDto): Promise<CompanyDocumentsResponse> {
    const employees = await this.repo.employeesWithCurrentDocuments(orgId);
    const input: ReportEmployee[] = employees.map((e) => ({
      id: e.id,
      fullName: e.fullName,
      status: e.status,
      documents: e.documents.map((d) => ({
        id: d.id,
        category: d.category,
        docType: d.docType,
        fileName: d.fileName,
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
        version: d.version,
        expiresOn: isoDate(d.expiresOn),
        visibility: d.visibility,
        createdAt: d.createdAt.toISOString(),
      })),
    }));
    const report = buildCompanyReport(input, todayIsoDhaka(new Date()), {
      status: q.status,
      category: q.category,
      employeeId: q.employeeId,
      search: q.search,
    });
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    return { counts: report.counts, rows: report.rows.slice((page - 1) * limit, page * limit), total: report.rows.length, page, limit };
  }

  /** Streams the stored bytes back with the delivery policy used for Xero attachments. */
  async content(orgId: string, id: string, forceDownload: boolean): Promise<DocumentContent> {
    const doc = await this.requireDocument(orgId, id);
    const stored = await this.storage.getStream(doc.storageKey);
    // contentType is the SNIFFED type recorded at upload, never the client's.
    const { headers } = attachmentDelivery(doc.fileName, doc.contentType, forceDownload);
    headers['Content-Length'] = String(doc.sizeBytes);
    return { stream: stored.stream, headers };
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  async upload(actor: AuthPrincipal, employeeId: string, file: UploadedFileLike | undefined, dto: UploadDocumentDto): Promise<DocumentView> {
    assertNotExited(await this.requireEmployee(actor.orgId, employeeId));
    return this.putNew(actor, employeeId, file, dto);
  }

  private async putNew(actor: AuthPrincipal, employeeId: string, file: UploadedFileLike | undefined, dto: UploadDocumentDto): Promise<DocumentView> {
    const sniffed = this.inspect(file);
    if (!isValidDocType(dto.category, dto.docType)) throw new BadRequestException('docType does not belong to that category.');
    const expiresOn = dto.expiresOn ? parseExpiry(dto.expiresOn) : null;
    const row = this.buildRow(randomUUID(), employeeId, file!, sniffed, 1, {
      category: dto.category,
      docType: dto.docType,
      expiresOn,
      visibility: dto.visibility ?? 'HR_ONLY',
      uploadedBy: actor.isMachine ? null : actor.userId,
    });
    await this.storage.put(row.storageKey, file!.buffer, sniffed.contentType);
    try {
      const created = await this.repo.create(row);
      return this.toView(created, todayIsoDhaka(new Date()), []);
    } catch (e) {
      await this.discardObject(row.storageKey);
      throw e;
    }
  }

  async replace(actor: AuthPrincipal, id: string, file: UploadedFileLike | undefined, dto: ReplaceDocumentDto): Promise<DocumentView> {
    const old = await this.requireDocument(actor.orgId, id);
    assertNotExited(old.employee);
    return this.putNextVersion(actor, old, file, dto);
  }

  private async putNextVersion(actor: AuthPrincipal, old: EmployeeDocument, file: UploadedFileLike | undefined, dto: ReplaceDocumentDto): Promise<DocumentView> {
    if (old.replacedById) throw new ConflictException('A newer version of this document exists. Replace that one instead.');
    const sniffed = this.inspect(file);
    const expiresOn = dto.expiresOn ? parseExpiry(dto.expiresOn) : old.expiresOn;
    const row = this.buildRow(randomUUID(), old.employeeId, file!, sniffed, old.version + 1, {
      category: old.category,
      docType: old.docType,
      expiresOn,
      visibility: old.visibility,
      uploadedBy: actor.isMachine ? null : actor.userId,
    });
    // The new object goes in first; the old one is never touched, so a failure leaves nothing lost.
    await this.storage.put(row.storageKey, file!.buffer, sniffed.contentType);
    try {
      const created = await this.repo.replace(old.id, row);
      return this.toView(created, todayIsoDhaka(new Date()), [
        { id: old.id, version: old.version, fileName: old.fileName, sizeBytes: old.sizeBytes, createdAt: old.createdAt.toISOString() },
      ]);
    } catch (e) {
      await this.discardObject(row.storageKey);
      if (e instanceof ReplaceConflictError) throw new ConflictException('This document was just replaced or deleted. Reload and try again.');
      throw e;
    }
  }

  async update(orgId: string, id: string, dto: UpdateDocumentDto): Promise<DocumentView> {
    const doc = await this.requireDocument(orgId, id);
    assertNotExited(doc.employee);
    if (doc.replacedById) throw new ConflictException('This is an older version and cannot be edited.');
    const category = (dto.category ?? doc.category) as DocumentCategoryName;
    const docType = dto.docType ?? doc.docType;
    if ((dto.category !== undefined || dto.docType !== undefined) && !isValidDocType(category, docType)) {
      throw new BadRequestException('docType does not belong to that category.');
    }
    const updated = await this.repo.update(id, {
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.docType !== undefined ? { docType: dto.docType } : {}),
      ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
      ...('expiresOn' in dto ? { expiresOn: dto.expiresOn ? parseExpiry(dto.expiresOn) : null } : {}),
    });
    return this.toView(updated, todayIsoDhaka(new Date()), []);
  }

  /** Soft delete of the document and its older versions; the objects stay in the bucket. */
  async remove(orgId: string, id: string): Promise<void> {
    const doc = await this.requireDocument(orgId, id);
    assertNotExited(doc.employee);
    if (doc.replacedById) throw new ConflictException('This is an older version. Delete the current version instead.');
    await this.repo.softDeleteChain(id, new Date());
  }

  /**
   * Files a server-generated document (e.g. an exit letter). If the employee already has a CURRENT
   * document of this category and type, the bytes become its next version (a regenerate replaces,
   * never duplicates); otherwise it is a first upload. Goes through the same type check, size limit,
   * magic-byte sniff and storage path as a person's upload. Deliberately NOT subject to the
   * exited-employee read-only rule: exit letters are issued after the exit completes.
   */
  async storeGenerated(
    actor: AuthPrincipal,
    employeeId: string,
    input: { category: DocumentCategoryName; docType: string; fileName: string; buffer: Buffer },
  ): Promise<DocumentView> {
    await this.requireEmployee(actor.orgId, employeeId);
    const file: UploadedFileLike = { originalname: input.fileName, buffer: input.buffer, size: input.buffer.length };
    const live = await this.repo.liveForEmployee(employeeId);
    const current = live.find((d) => d.replacedById === null && d.category === input.category && d.docType === input.docType);
    if (current) return this.putNextVersion(actor, current, file, {});
    return this.putNew(actor, employeeId, file, { category: input.category, docType: input.docType });
  }

  /** An employee's CURRENT documents in one category, newest first; the exit view lists these. */
  async currentInCategory(orgId: string, employeeId: string, category: DocumentCategoryName): Promise<DocumentView[]> {
    await this.requireEmployee(orgId, employeeId);
    const today = todayIsoDhaka(new Date());
    return (await this.repo.liveForEmployee(employeeId))
      .filter((d) => d.replacedById === null && d.category === category)
      .map((d) => this.toView(d, today, []));
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async requireEmployee(orgId: string, employeeId: string): Promise<EmployeeRef> {
    const employee = await this.repo.findEmployee(orgId, employeeId);
    if (!employee) throw new NotFoundException('Employee not found.');
    return employee;
  }

  private async requireDocument(orgId: string, id: string) {
    const doc = await this.repo.findLive(orgId, id);
    if (!doc) throw new NotFoundException('Document not found.');
    return doc;
  }

  /** Presence, size and magic-byte checks, in the order that is cheapest to fail. */
  private inspect(file: UploadedFileLike | undefined): SniffedType {
    if (!file?.buffer) throw new BadRequestException('Attach a file in the "file" field.');
    if (file.buffer.length === 0) throw new BadRequestException('The file is empty.');
    if (file.buffer.length > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('Files can be at most 20 MB.');
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed) throw new UnsupportedMediaTypeException('Only PDF, JPEG, PNG, WebP and DOCX files are accepted.');
    return sniffed;
  }

  private buildRow(
    id: string,
    employeeId: string,
    file: UploadedFileLike,
    sniffed: SniffedType,
    version: number,
    meta: Pick<NewDocumentRow, 'category' | 'docType' | 'expiresOn' | 'visibility' | 'uploadedBy'>,
  ): NewDocumentRow {
    return {
      id,
      employeeId,
      ...meta,
      fileName: sanitizeFileName(file.originalname, sniffed),
      contentType: sniffed.contentType,
      sizeBytes: file.buffer.length,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      storageKey: `employees/${employeeId}/${id}`,
      version,
    };
  }

  /** Best-effort cleanup of an object whose row never landed. A failure here only leaks an orphan. */
  private async discardObject(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch {
      this.logger.warn(`Could not remove orphaned document object ${key}`);
    }
  }

  private toView(d: EmployeeDocument, today: string, previousVersions: PreviousVersion[]): DocumentView {
    const expiresOn = isoDate(d.expiresOn);
    return {
      id: d.id,
      employeeId: d.employeeId,
      category: d.category,
      docType: d.docType,
      fileName: d.fileName,
      contentType: d.contentType,
      sizeBytes: d.sizeBytes,
      sha256: d.sha256,
      version: d.version,
      expiresOn,
      expiry: classifyExpiry(expiresOn, today),
      visibility: d.visibility,
      uploadedBy: d.uploadedBy,
      createdAt: d.createdAt.toISOString(),
      previousVersions,
    };
  }
}
