import { Injectable, Logger } from '@nestjs/common';
import { XeroClient } from './xero.client';
import { XeroRepository, type SyncStateStatus } from './xero.repository';
import { XeroRateBudgetExhaustedError, XeroReconnectRequiredError } from './xero-errors';
import {
  ATTACHMENT_PARENTS, ENTITY_ENDPOINTS, RECONCILE_ID_BATCH, XERO_ENTITIES, type AttachmentParentType, type XeroEntity,
} from './xero.constants';
import {
  normalizeAttachment, normalizeBankTransaction, normalizeContact, normalizeCreditNote, normalizeInvoice, normalizePayment,
} from './xero-normalize';
import type {
  XeroAttachment, XeroBankTransaction, XeroContact, XeroCreditNote, XeroInvoice, XeroPayment,
} from './xero.types';

export interface XeroSyncResult {
  stopped: null | 'rate_limited' | 'reconnect';
  entities: { entity: string; upserted: number; watermark: string | null }[];
  attachmentsFetched: number;
}

type Candidate = { parentType: AttachmentParentType; id: string };

const maxDate = (dates: Date[]): Date | null =>
  dates.reduce<Date | null>((m, d) => (!m || d > m ? d : m), null);

/**
 * One sync run: contacts → invoices (both types) → credit notes → bank
 * transactions → payments → attachment lists. Each entity pages with
 * If-Modified-Since = its watermark, which only advances after the entity
 * completes. Voids and deletes are status changes that bump UpdatedDateUTC, so
 * they arrive through this same path; no deletion reconcile is needed.
 */
@Injectable()
export class XeroSyncService {
  private readonly logger = new Logger(XeroSyncService.name);

  constructor(
    private readonly client: XeroClient,
    private readonly repo: XeroRepository,
  ) {}

  async runSync(opts: { full?: boolean } = {}): Promise<XeroSyncResult> {
    this.client.beginRun();
    const result: XeroSyncResult = { stopped: null, entities: [], attachmentsFetched: 0 };
    const candidates: Candidate[] = [];
    for (const entity of XERO_ENTITIES) {
      try {
        result.entities.push(await this.syncEntity(entity, !!opts.full, candidates));
      } catch (e) {
        result.stopped = await this.stopReason(entity, e);
        return result;
      }
    }
    // Attachments get their own sync-state row, so Settings shows it on a healthy run too, not only on failure.
    await this.repo.startEntity('attachments');
    try {
      result.attachmentsFetched = await this.syncAttachments(candidates);
      await this.repo.finishEntity('attachments', null, result.attachmentsFetched);
    } catch (e) {
      result.stopped = await this.stopReason('attachments', e);
    }
    this.logger.log(`Xero sync finished: ${result.entities.map((r) => `${r.entity}=${r.upserted}`).join(' ')} attachments=${result.attachmentsFetched}`);
    return result;
  }

  /**
   * Nightly. Xero does not bump UpdatedDateUTC for some edits (e.g. a DueDate
   * change on a part-paid invoice), so unpaid invoices are re-read by ID. Contacts
   * get a full pass so balances and role flags stay right.
   */
  async reconcileOpen(): Promise<XeroSyncResult> {
    this.client.beginRun();
    const result: XeroSyncResult = { stopped: null, entities: [], attachmentsFetched: 0 };
    try {
      result.entities.push(await this.syncEntity('contacts', true, []));
      const ids = await this.repo.openInvoiceIds();
      let upserted = 0;
      for (let i = 0; i < ids.length; i += RECONCILE_ID_BATCH) {
        const batch = ids.slice(i, i + RECONCILE_ID_BATCH);
        const body = await this.client.get<{ Invoices?: XeroInvoice[] }>('/Invoices', { params: { IDs: batch.join(',') } });
        const rows = (body?.Invoices ?? []).map(normalizeInvoice);
        await this.repo.upsertInvoices(rows);
        upserted += rows.length;
      }
      result.entities.push({ entity: 'invoices', upserted, watermark: null });
    } catch (e) {
      result.stopped = await this.stopReason('invoices', e);
    }
    return result;
  }

  private async syncEntity(entity: XeroEntity, full: boolean, candidates: Candidate[]) {
    const state = await this.repo.getSyncState(entity);
    const since = full ? null : (state?.watermark ?? null);
    await this.repo.startEntity(entity);
    const { path, key, params } = ENTITY_ENDPOINTS[entity];
    let upserted = 0;
    let watermark: Date | null = null;
    for await (const page of this.client.pages<unknown>(path, key, { params, modifiedSince: since })) {
      const newest = await this.writePage(entity, page, candidates);
      upserted += page.length;
      if (newest && (!watermark || newest > watermark)) watermark = newest;
      await this.repo.recordProgress(entity, upserted);
    }
    await this.repo.finishEntity(entity, watermark, upserted);
    return { entity, upserted, watermark: watermark?.toISOString() ?? null };
  }

  /** Writes one page and returns its newest UpdatedDateUTC. */
  private async writePage(entity: XeroEntity, page: unknown[], candidates: Candidate[]): Promise<Date | null> {
    switch (entity) {
      case 'contacts': {
        const rows = (page as XeroContact[]).map(normalizeContact);
        await this.repo.upsertContacts(rows);
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'invoices': {
        const rows = (page as XeroInvoice[]).map(normalizeInvoice);
        await this.repo.upsertInvoices(rows);
        rows.filter((r) => r.hasAttachments).forEach((r) => candidates.push({ parentType: 'invoice', id: r.invoiceId }));
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'creditNotes': {
        const rows = (page as XeroCreditNote[]).map(normalizeCreditNote);
        await this.repo.upsertCreditNotes(rows);
        rows.filter((r) => r.hasAttachments).forEach((r) => candidates.push({ parentType: 'creditNote', id: r.creditNoteId }));
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'bankTransactions': {
        const rows = (page as XeroBankTransaction[]).map(normalizeBankTransaction);
        await this.repo.upsertBankTransactions(rows);
        rows.filter((r) => r.hasAttachments).forEach((r) => candidates.push({ parentType: 'bankTransaction', id: r.bankTransactionId }));
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'payments': {
        const rows = (page as XeroPayment[]).map(normalizePayment);
        await this.repo.upsertPayments(rows);
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
    }
  }

  /** One call per changed record that has attachments, so cost scales with change, not history. */
  private async syncAttachments(candidates: Candidate[]): Promise<number> {
    const seen = new Set<string>();
    let fetched = 0;
    for (const c of candidates) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const body = await this.client.get<{ Attachments?: XeroAttachment[] }>(`${ATTACHMENT_PARENTS[c.parentType]}/${c.id}/Attachments`);
      const rows = (body?.Attachments ?? []).map((a) => normalizeAttachment(c.parentType, c.id, a));
      await this.repo.replaceAttachments(c.id, rows);
      fetched += 1;
    }
    return fetched;
  }

  /**
   * Clean stops (budget, reconnect) are recorded and returned, so they don't burn
   * BullMQ retries. Anything else is recorded as FAILED and rethrown to retry.
   */
  private async stopReason(entity: string, e: unknown): Promise<'rate_limited' | 'reconnect'> {
    let status: SyncStateStatus = 'FAILED';
    if (e instanceof XeroRateBudgetExhaustedError) status = 'RATE_LIMITED';
    else if (e instanceof XeroReconnectRequiredError) status = 'NEEDS_RECONNECT';
    await this.repo.failEntity(entity, status, (e as Error)?.message ?? String(e));
    if (status === 'RATE_LIMITED') return 'rate_limited';
    if (status === 'NEEDS_RECONNECT') return 'reconnect';
    throw e;
  }
}
