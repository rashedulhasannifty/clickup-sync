import { Injectable, Logger } from '@nestjs/common';
import { XeroClient } from './xero.client';
import { XeroRepository, type AttachmentCursor, type SyncStateStatus } from './xero.repository';
import { XeroApiError, XeroRateBudgetExhaustedError, XeroReconnectRequiredError } from './xero-errors';
import {
  ATTACHMENT_BATCH, ATTACHMENT_PARENTS, ATTACHMENT_RECONCILE_DAYS, ENTITY_ENDPOINTS, RECONCILE_ID_BATCH, XERO_ENTITIES, type XeroEntity,
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

type AttachmentProgress = { fetched: number; completedAt: Date | null };

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
  /** Overridable in tests. */
  attachmentBatch = ATTACHMENT_BATCH;

  constructor(
    private readonly client: XeroClient,
    private readonly repo: XeroRepository,
  ) {}

  async runSync(opts: { full?: boolean } = {}): Promise<XeroSyncResult> {
    this.client.beginRun();
    const result: XeroSyncResult = { stopped: null, entities: [], attachmentsFetched: 0 };
    for (const entity of XERO_ENTITIES) {
      try {
        result.entities.push(await this.syncEntity(entity, !!opts.full));
      } catch (e) {
        result.stopped = await this.stopReason(entity, e);
        return result;
      }
    }
    // Attachments get their own sync-state row, so Settings shows it on a healthy run too, not only on failure.
    // A full run restarts from the beginning. That is what makes `full` mean full: attaching a file in Xero
    // does NOT bump the parent's UpdatedDateUTC, so a parent only becomes flagged when it is re-read — and a
    // newly flagged parent is usually OLDER than this watermark, which would skip it for good. Honouring the
    // watermark here would leave the one case a full re-read exists to fix still broken.
    const stored = (await this.repo.getSyncState('attachments'))?.watermark ?? null;
    const since = opts.full ? null : stored;
    await this.repo.startEntity('attachments');
    const progress: AttachmentProgress = { fetched: 0, completedAt: null };
    try {
      await this.syncAttachments(since, progress, stored);
      await this.repo.finishEntity('attachments', maxDate([progress.completedAt, stored].filter((d): d is Date => !!d)), progress.fetched);
    } catch (e) {
      result.stopped = await this.stopReason('attachments', e);
    } finally {
      result.attachmentsFetched = progress.fetched;
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
    // Each phase is reported under its own entity: a contacts failure must not
    // overwrite the `invoices` sync-state row (or leave `contacts` stuck RUNNING).
    try {
      result.entities.push(await this.syncEntity('contacts', true));
    } catch (e) {
      result.stopped = await this.stopReason('contacts', e);
      return result;
    }
    try {
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
      return result;
    }
    // Third phase: refresh `has_attachments` for recent parents, then walk attachments from the
    // window start rather than the stored watermark. Both halves are needed. Re-reading alone
    // would flag the parent but the attachment phase skips anything older than its watermark;
    // walking alone would find nothing, because the flag is what makes a parent eligible.
    try {
      await this.reconcileAttachments(result);
    } catch (e) {
      result.stopped = await this.stopReason('attachments', e);
    }
    return result;
  }

  /**
   * Re-reads recent parents by ID so a file attached in Xero becomes visible. Xero does not bump
   * UpdatedDateUTC when a file is attached, so nothing else ever discovers it: the hourly
   * incremental asks "what changed?" and Xero truthfully answers "not this".
   */
  private async reconcileAttachments(result: XeroSyncResult): Promise<void> {
    const since = new Date(Date.now() - ATTACHMENT_RECONCILE_DAYS * 86_400_000);
    const ids = await this.repo.attachmentFlagParentIds(since);
    const phases: { path: string; key: string; ids: string[]; write: (rows: unknown[]) => Promise<void> }[] = [
      { path: '/Invoices', key: 'Invoices', ids: ids.invoices, write: (r) => this.repo.upsertInvoices(r as never) },
      { path: '/CreditNotes', key: 'CreditNotes', ids: ids.creditNotes, write: (r) => this.repo.upsertCreditNotes(r as never) },
      { path: '/BankTransactions', key: 'BankTransactions', ids: ids.bankTransactions, write: (r) => this.repo.upsertBankTransactions(r as never) },
    ];
    const normalize: Record<string, (x: never) => unknown> = {
      Invoices: normalizeInvoice as never, CreditNotes: normalizeCreditNote as never, BankTransactions: normalizeBankTransaction as never,
    };
    let refreshed = 0;
    for (const p of phases) {
      for (let i = 0; i < p.ids.length; i += RECONCILE_ID_BATCH) {
        const batch = p.ids.slice(i, i + RECONCILE_ID_BATCH);
        const body = await this.client.get<Record<string, unknown[]>>(p.path, { params: { IDs: batch.join(',') } });
        const rows = (body?.[p.key] ?? []).map((x) => normalize[p.key](x as never));
        await p.write(rows);
        refreshed += rows.length;
      }
    }
    result.entities.push({ entity: 'attachmentFlags', upserted: refreshed, watermark: null });

    // Walk from the window start, not the watermark: a newly flagged parent is almost always
    // older than the watermark, which is exactly the record this pass exists to reach.
    const stored = (await this.repo.getSyncState('attachments'))?.watermark ?? null;
    await this.repo.startEntity('attachments');
    const progress: AttachmentProgress = { fetched: 0, completedAt: null };
    try {
      // Walk from the window start, but never persist behind the stored watermark (see syncAttachments).
      await this.syncAttachments(since, progress, stored);
      await this.repo.finishEntity('attachments', maxDate([progress.completedAt, stored].filter((d): d is Date => !!d)), progress.fetched);
    } finally {
      result.attachmentsFetched = progress.fetched;
    }
  }

  private async syncEntity(entity: XeroEntity, full: boolean) {
    const state = await this.repo.getSyncState(entity);
    const since = full ? null : (state?.watermark ?? null);
    await this.repo.startEntity(entity);
    const { path, key, params } = ENTITY_ENDPOINTS[entity];
    let upserted = 0;
    let watermark: Date | null = null;
    for await (const page of this.client.pages<unknown>(path, key, { params, modifiedSince: since })) {
      const newest = await this.writePage(entity, page);
      upserted += page.length;
      if (newest && (!watermark || newest > watermark)) watermark = newest;
      await this.repo.recordProgress(entity, upserted);
    }
    await this.repo.finishEntity(entity, watermark, upserted);
    return { entity, upserted, watermark: watermark?.toISOString() ?? null };
  }

  /** Writes one page and returns its newest UpdatedDateUTC. */
  private async writePage(entity: XeroEntity, page: unknown[]): Promise<Date | null> {
    switch (entity) {
      case 'contacts': {
        const rows = (page as XeroContact[]).map(normalizeContact);
        await this.repo.upsertContacts(rows);
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'invoices': {
        const rows = (page as XeroInvoice[]).map(normalizeInvoice);
        await this.repo.upsertInvoices(rows);
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'creditNotes': {
        const rows = (page as XeroCreditNote[]).map(normalizeCreditNote);
        await this.repo.upsertCreditNotes(rows);
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'bankTransactions': {
        const rows = (page as XeroBankTransaction[]).map(normalizeBankTransaction);
        await this.repo.upsertBankTransactions(rows);
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'payments': {
        const rows = (page as XeroPayment[]).map(normalizePayment);
        await this.repo.upsertPayments(rows);
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
    }
  }

  /**
   * One call per flagged record newer than the `attachments` watermark, so cost scales
   * with change, not history. Driven by the DB rather than by what this run wrote, so a
   * stop (day budget, reconnect, failure) resumes from the last completed parent next
   * run instead of losing its names.
   */
  private async syncAttachments(since: Date | null, progress: AttachmentProgress, floor: Date | null = since): Promise<void> {
    let cursor: AttachmentCursor | null = since ? { updatedDateUtc: since } : null;
    // `floor` is the watermark ALREADY stored, which is not the same as where this pass starts
    // walking. A full pass (or the nightly window pass) deliberately restarts behind the stored
    // watermark to revisit parents, but must never persist a value older than one an earlier run
    // earned — that would rewind the resume point and make the next incremental run redo days of
    // work against the same 5,000/day budget. Seeding `persisted` with `since` did exactly that,
    // because on a full pass `since` is null.
    let persisted = floor;
    for (;;) {
      const batch = await this.repo.attachmentParentsAfter(cursor, this.attachmentBatch);
      for (const p of batch) {
        // Persist a timestamp only once every parent carrying it is done. The next run reads
        // strictly newer rows, so saving it mid-group would skip a parent that shares it.
        const done = progress.completedAt;
        if (done && p.updatedDateUtc > done && (!persisted || done > persisted)) {
          await this.repo.advanceWatermark('attachments', done, progress.fetched);
          persisted = done;
        }
        try {
          const body = await this.client.get<{ Attachments?: XeroAttachment[] }>(`${ATTACHMENT_PARENTS[p.parentType]}/${p.id}/Attachments`);
          const rows = (body?.Attachments ?? []).map((a) => normalizeAttachment(p.parentType, p.id, a));
          await this.repo.replaceAttachments(p.id, rows);
          progress.fetched += 1;
        } catch (e) {
          // A parent Xero no longer serves (404 — e.g. the record was deleted there) would
          // otherwise stall the phase for good: every run restarts at the same watermark and
          // fails on the same row, so no newer attachment list is ever fetched. Skip just this
          // parent and keep going. Everything else still halts the phase: budget exhaustion,
          // reconnect, 5xx, network, and 429s the client already gave up retrying.
          if (!(e instanceof XeroApiError) || e.status !== 404) throw e;
          this.logger.warn(`Xero attachments: skipped ${p.parentType} ${p.id} (404 from Xero)`);
        }
        progress.completedAt = p.updatedDateUtc;
        cursor = { updatedDateUtc: p.updatedDateUtc, id: p.id };
      }
      if (batch.length < this.attachmentBatch) return;
    }
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
