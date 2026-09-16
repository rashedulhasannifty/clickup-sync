import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { XeroConnectionRepository } from './xero-connection.repository';
import type { NormalizedRows } from './xero-normalize';
import type { AttachmentParentType } from './xero.constants';

export type SyncStateStatus = 'IDLE' | 'RUNNING' | 'OK' | 'RATE_LIMITED' | 'NEEDS_RECONNECT' | 'FAILED';

/** Where the attachment phase is up to. `id` absent = strictly newer than the timestamp (a stored watermark). */
export type AttachmentCursor = { updatedDateUtc: Date; id?: string };
export type AttachmentParent = { parentType: AttachmentParentType; id: string; updatedDateUtc: Date };

/** Flagged rows after the cursor, in (updatedDateUtc, id) order. `idAfter` names the table's primary key. */
function attachmentWhere<W extends object>(c: AttachmentCursor | null, idAfter: (id: string) => W) {
  if (!c) return { hasAttachments: true };
  if (c.id === undefined) return { hasAttachments: true, updatedDateUtc: { gt: c.updatedDateUtc } };
  return { hasAttachments: true, OR: [{ updatedDateUtc: { gt: c.updatedDateUtc } }, { updatedDateUtc: c.updatedDateUtc, ...idAfter(c.id) }] };
}

// Postgres orders uuid columns bytewise, which matches comparing the lowercase hex strings Prisma returns.
const byDateThenId = (a: AttachmentParent, b: AttachmentParent) =>
  a.updatedDateUtc.getTime() - b.updatedDateUtc.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * All Xero writes. Upserts are idempotent (Xero GUID = conflict key), so a
 * retried page or an overlapping watermark rewrites the same rows harmlessly.
 */
@Injectable()
export class XeroRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: XeroConnectionRepository,
  ) {}

  async upsertContacts(rows: NormalizedRows['contacts'][]) {
    if (!rows.length) return;
    await this.prisma.$transaction(rows.map((r) => this.prisma.xeroContact.upsert({ where: { contactId: r.contactId }, create: r, update: r })));
  }

  async upsertInvoices(rows: NormalizedRows['invoices'][]) {
    if (!rows.length) return;
    await this.prisma.$transaction(rows.map((r) => this.prisma.xeroInvoice.upsert({ where: { invoiceId: r.invoiceId }, create: r, update: r })));
  }

  async upsertCreditNotes(rows: NormalizedRows['creditNotes'][]) {
    if (!rows.length) return;
    await this.prisma.$transaction(rows.map((r) => this.prisma.xeroCreditNote.upsert({ where: { creditNoteId: r.creditNoteId }, create: r, update: r })));
  }

  async upsertBankTransactions(rows: NormalizedRows['bankTransactions'][]) {
    if (!rows.length) return;
    await this.prisma.$transaction(
      rows.map((r) => this.prisma.xeroBankTransaction.upsert({ where: { bankTransactionId: r.bankTransactionId }, create: r, update: r })),
    );
  }

  async upsertPayments(rows: NormalizedRows['payments'][]) {
    if (!rows.length) return;
    await this.prisma.$transaction(rows.map((r) => this.prisma.xeroPayment.upsert({ where: { paymentId: r.paymentId }, create: r, update: r })));
  }

  /** The attachment list of a record is replaced wholesale, so removed files disappear too. */
  async replaceAttachments(parentId: string, rows: Prisma.XeroAttachmentCreateManyInput[]) {
    await this.prisma.$transaction([
      this.prisma.xeroAttachment.deleteMany({ where: { parentId } }),
      this.prisma.xeroAttachment.createMany({ data: rows, skipDuplicates: true }),
    ]);
  }

  /**
   * The next page of records whose attachment list must be fetched: every flagged
   * invoice, credit note and bank transaction after `cursor`, in ONE global
   * (updatedDateUtc, id) order across the three tables, because one watermark covers
   * all three. Each table returns at most `take`, so the merged head is exact.
   */
  async attachmentParentsAfter(cursor: AttachmentCursor | null, take: number): Promise<AttachmentParent[]> {
    const order = { updatedDateUtc: 'asc' as const };
    const [invoices, creditNotes, bankTransactions] = await Promise.all([
      this.prisma.xeroInvoice.findMany({
        where: attachmentWhere(cursor, (id) => ({ invoiceId: { gt: id } })),
        orderBy: [order, { invoiceId: 'asc' }], take, select: { invoiceId: true, updatedDateUtc: true },
      }),
      this.prisma.xeroCreditNote.findMany({
        where: attachmentWhere(cursor, (id) => ({ creditNoteId: { gt: id } })),
        orderBy: [order, { creditNoteId: 'asc' }], take, select: { creditNoteId: true, updatedDateUtc: true },
      }),
      this.prisma.xeroBankTransaction.findMany({
        where: attachmentWhere(cursor, (id) => ({ bankTransactionId: { gt: id } })),
        orderBy: [order, { bankTransactionId: 'asc' }], take, select: { bankTransactionId: true, updatedDateUtc: true },
      }),
    ]);
    const rows: AttachmentParent[] = [
      ...invoices.map((r) => ({ parentType: 'invoice' as const, id: r.invoiceId, updatedDateUtc: r.updatedDateUtc })),
      ...creditNotes.map((r) => ({ parentType: 'creditNote' as const, id: r.creditNoteId, updatedDateUtc: r.updatedDateUtc })),
      ...bankTransactions.map((r) => ({ parentType: 'bankTransaction' as const, id: r.bankTransactionId, updatedDateUtc: r.updatedDateUtc })),
    ];
    return rows.sort(byDateThenId).slice(0, take);
  }

  /** Moves a watermark (and progress) mid-phase WITHOUT marking the entity OK: it's still running. */
  async advanceWatermark(entity: string, watermark: Date, recordsUpserted: number) {
    const data = { watermark, recordsUpserted };
    await this.prisma.xeroSyncState.upsert({ where: { entity }, create: { entity, ...data }, update: data });
  }

  getSyncState(entity: string) {
    return this.prisma.xeroSyncState.findUnique({ where: { entity } });
  }

  async startEntity(entity: string) {
    const data = { status: 'RUNNING' as SyncStateStatus, lastRunAt: new Date(), lastError: null, recordsUpserted: 0 };
    await this.prisma.xeroSyncState.upsert({ where: { entity }, create: { entity, ...data }, update: data });
  }

  async recordProgress(entity: string, recordsUpserted: number) {
    await this.prisma.xeroSyncState.upsert({ where: { entity }, create: { entity, recordsUpserted }, update: { recordsUpserted } });
  }

  /** The watermark only moves forward after an entity completes, so an interrupted entity is re-read next run. */
  async finishEntity(entity: string, watermark: Date | null, recordsUpserted: number) {
    const data = {
      status: 'OK' as SyncStateStatus, lastSuccessAt: new Date(), recordsUpserted, lastError: null,
      ...(watermark ? { watermark } : {}),
    };
    await this.prisma.xeroSyncState.upsert({ where: { entity }, create: { entity, ...data }, update: data });
  }

  async failEntity(entity: string, status: SyncStateStatus, error: string) {
    const data = { status, lastError: error.slice(0, 1000) };
    await this.prisma.xeroSyncState.upsert({ where: { entity }, create: { entity, ...data }, update: data });
  }

  /**
   * Erases the local Xero mirror: the connection's tenant identity first, then every synced
   * row. Nothing in Xero itself is touched — this only drops our copy.
   *
   * The connection clear leads the transaction on purpose (see `clearConnection`): it revokes
   * the in-process ability to sync, so a run already under way cannot write rows back behind
   * the deletes. The tables have no foreign keys between them (every link is a denormalised
   * scalar `contactId`/`parentId`), so delete order can't abort the transaction; children are
   * still listed before parents to keep the intent readable if constraints are ever added.
   */
  async eraseAll(): Promise<void> {
    await this.prisma.$transaction([
      this.connections.clearConnection(this.prisma),
      this.prisma.xeroAttachment.deleteMany({}),
      this.prisma.xeroPayment.deleteMany({}),
      this.prisma.xeroBankTransaction.deleteMany({}),
      this.prisma.xeroCreditNote.deleteMany({}),
      this.prisma.xeroInvoice.deleteMany({}),
      this.prisma.xeroContact.deleteMany({}),
      this.prisma.xeroSyncState.deleteMany({}),
    ]);
  }

  async openInvoiceIds(): Promise<string[]> {
    const rows = await this.prisma.xeroInvoice.findMany({
      where: { status: { in: ['AUTHORISED', 'SUBMITTED'] } },
      select: { invoiceId: true },
    });
    return rows.map((r) => r.invoiceId);
  }
}
