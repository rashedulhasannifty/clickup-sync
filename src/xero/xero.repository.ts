import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { NormalizedRows } from './xero-normalize';

export type SyncStateStatus = 'IDLE' | 'RUNNING' | 'OK' | 'RATE_LIMITED' | 'NEEDS_RECONNECT' | 'FAILED';

/**
 * All Xero writes. Upserts are idempotent (Xero GUID = conflict key), so a
 * retried page or an overlapping watermark rewrites the same rows harmlessly.
 */
@Injectable()
export class XeroRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  async openInvoiceIds(): Promise<string[]> {
    const rows = await this.prisma.xeroInvoice.findMany({
      where: { status: { in: ['AUTHORISED', 'SUBMITTED'] } },
      select: { invoiceId: true },
    });
    return rows.map((r) => r.invoiceId);
  }
}
