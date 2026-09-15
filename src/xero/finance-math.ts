import type { Prisma } from '@prisma/client';

export const DHAKA_TZ = 'Asia/Dhaka';
const DAY_MS = 86_400_000;

const dhakaYmd = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: DHAKA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Dhaka's calendar date as UTC midnight, the same representation Prisma uses for @db.Date columns. */
export function todayDhaka(now: Date = new Date()): Date {
  return new Date(`${dhakaYmd(now)}T00:00:00.000Z`);
}

export function monthStartDhaka(now: Date = new Date()): Date {
  return new Date(`${dhakaYmd(now).slice(0, 7)}-01T00:00:00.000Z`);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

export function dayString(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function daysPastDue(dueDate: Date, today: Date): number {
  return Math.round((today.getTime() - dueDate.getTime()) / DAY_MS);
}

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';
export const AGING_BUCKETS: AgingBucket[] = ['current', '1-30', '31-60', '61-90', '90+'];

export function agingBucket(daysPast: number): AgingBucket {
  if (daysPast <= 0) return 'current';
  if (daysPast <= 30) return '1-30';
  if (daysPast <= 60) return '31-60';
  if (daysPast <= 90) return '61-90';
  return '90+';
}

export function bucketAging(rows: { dueDate: Date | null; amountDueBase: number }[], today: Date): Record<AgingBucket, number> {
  const out: Record<AgingBucket, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const r of rows) {
    const b = r.dueDate ? agingBucket(daysPastDue(r.dueDate, today)) : 'current';
    out[b] = Math.round((out[b] + r.amountDueBase) * 100) / 100;
  }
  return out;
}

export type StatusBucket = 'DRAFT' | 'SUBMITTED' | 'AUTHORISED' | 'overdue' | 'PAID' | 'VOIDED';
export const STATUS_BUCKETS: StatusBucket[] = ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'overdue', 'PAID', 'VOIDED'];

/**
 * What the invoice/bill list accepts: every exclusive bucket, plus `unpaid`, a UNION
 * (AUTHORISED ∪ overdue: everything awaiting payment) that matches the "Owed to you" and
 * "You owe" KPIs. `unpaid` is deliberately NOT a bucket, so the buckets stay exclusive.
 */
export type InvoiceStatusFilter = StatusBucket | 'unpaid';
export const INVOICE_STATUS_FILTERS: InvoiceStatusFilter[] = [...STATUS_BUCKETS, 'unpaid'];

/**
 * Exclusive status buckets for invoices and bills. "AUTHORISED" means awaiting
 * payment and NOT overdue; "overdue" is its own bucket. Together they cover every
 * non-DELETED invoice exactly once, a property enforced by finance-math.spec.ts.
 * If you add a way for an invoice to be split, change both buckets together.
 */
export function invoiceStatusWhere(bucket: InvoiceStatusFilter | undefined, today: Date): Prisma.XeroInvoiceWhereInput {
  if (!bucket) return { status: { not: 'DELETED' } };
  if (bucket === 'unpaid') return { status: 'AUTHORISED' };
  if (bucket === 'overdue') return { status: 'AUTHORISED', dueDate: { lt: today } };
  if (bucket === 'AUTHORISED') return { status: 'AUTHORISED', OR: [{ dueDate: { gte: today } }, { dueDate: null }] };
  return { status: bucket };
}

/** Real cash movements. *-TRANSFER is money moving between the company's own accounts. */
export const IN_BANK_TYPES = ['RECEIVE', 'RECEIVE-OVERPAYMENT', 'RECEIVE-PREPAYMENT'];
export const OUT_BANK_TYPES = ['SPEND', 'SPEND-OVERPAYMENT', 'SPEND-PREPAYMENT'];

export type DeepLinkKind = 'invoice' | 'bill' | 'contact' | 'bankTransaction' | 'creditNote';

/** Paths confirmed against the Demo Company in Task 13. */
export function xeroDeepLink(shortCode: string | null, kind: DeepLinkKind, id: string): string {
  const path = {
    invoice: `/AccountsReceivable/View.aspx?InvoiceID=${id}`,
    bill: `/AccountsPayable/View.aspx?InvoiceID=${id}`,
    contact: `/Contacts/View/${id}`,
    bankTransaction: `/Bank/ViewTransaction.aspx?bankTransactionID=${id}`,
    creditNote: `/AccountsReceivable/ViewCreditNote.aspx?creditNoteID=${id}`,
  }[kind];
  if (!shortCode) return `https://go.xero.com${path}`;
  const q = new URLSearchParams({ shortcode: shortCode, redirecturl: path });
  return `https://go.xero.com/organisationlogin/default.aspx?${q.toString()}`;
}
