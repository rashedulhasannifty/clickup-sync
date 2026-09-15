import type { Prisma } from '@prisma/client';
import type { AttachmentParentType } from './xero.constants';
import type {
  XeroAttachment, XeroBankTransaction, XeroContact, XeroCreditNote, XeroInvoice, XeroLineItem, XeroPayment,
} from './xero.types';

const LEGACY_DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;
const HAS_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

/** Xero timestamps are either `/Date(ms+0000)/` or zone-less ISO strings, which Xero means as UTC. */
export function parseXeroTimestamp(value?: string | null): Date | null {
  if (!value) return null;
  const legacy = LEGACY_DATE.exec(value);
  if (legacy) return new Date(Number(legacy[1]));
  const d = new Date(HAS_ZONE.test(value) ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Date-only fields (invoice Date/DueDate). Prefer the `*String` variant
 * (`2026-09-01T00:00:00`) and keep only its calendar day, so no timezone can move
 * a due date across midnight. Falls back to the legacy timestamp's UTC date.
 */
export function parseXeroDateOnly(dateString?: string | null, legacy?: string | null): Date | null {
  const m = dateString ? /^(\d{4}-\d{2}-\d{2})/.exec(dateString) : null;
  if (m) {
    const d = new Date(`${m[1]}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ts = parseXeroTimestamp(legacy);
  return ts ? new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate())) : null;
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (v: unknown): number => round2(Number(v ?? 0) || 0);

/**
 * Document-currency amount → base currency. Xero's CurrencyRate is foreign units
 * per ONE base unit (1 for base-currency documents), so base = amount / rate.
 * Confirmed against the Demo Company in Task 13.
 */
export function toBase(amount: number | null | undefined, rate: number | null | undefined): number {
  const r = Number(rate);
  if (!r || !Number.isFinite(r) || r === 1) return money(amount);
  return round2(Number(amount ?? 0) / r);
}

/**
 * Which payments are real cash for the money-in/out KPIs. Overpayment and
 * prepayment allocations are excluded: their cash already appears as a
 * RECEIVE-/SPEND-OVERPAYMENT or -PREPAYMENT bank transaction, so counting the
 * allocation too would double count.
 */
export function cashDirection(paymentType?: string | null): 'in' | 'out' | null {
  switch (paymentType) {
    case 'ACCRECPAYMENT': // customer paid an invoice
    case 'APCREDITPAYMENT': // supplier refunded a credit note
      return 'in';
    case 'ACCPAYPAYMENT': // we paid a bill
    case 'ARCREDITPAYMENT': // we refunded a customer credit note
      return 'out';
    default:
      return null;
  }
}

function lineItems(items?: XeroLineItem[]): Prisma.InputJsonValue {
  return (items ?? []).map((l) => ({
    description: l.Description ?? null,
    quantity: l.Quantity ?? null,
    unitAmount: l.UnitAmount ?? null,
    accountCode: l.AccountCode ?? null,
    taxType: l.TaxType ?? null,
    taxAmount: l.TaxAmount ?? null,
    lineAmount: l.LineAmount ?? null,
    itemCode: l.ItemCode ?? null,
  }));
}

const raw = (v: unknown) => v as Prisma.InputJsonValue;
const updated = (v: string): Date => parseXeroTimestamp(v) ?? new Date(0);
const rate = (v?: number) => (v && Number.isFinite(v) ? v : 1);

export function normalizeContact(c: XeroContact) {
  return {
    contactId: c.ContactID,
    name: c.Name,
    firstName: c.FirstName ?? null,
    lastName: c.LastName ?? null,
    email: c.EmailAddress || null,
    phones: raw(c.Phones ?? []),
    addresses: raw(c.Addresses ?? []),
    taxNumber: c.TaxNumber || null,
    defaultCurrency: c.DefaultCurrency ?? null,
    isCustomer: c.IsCustomer ?? false,
    isSupplier: c.IsSupplier ?? false,
    status: c.ContactStatus ?? 'ACTIVE',
    updatedDateUtc: updated(c.UpdatedDateUTC),
    raw: raw(c),
  } satisfies Prisma.XeroContactCreateInput;
}

export function normalizeInvoice(i: XeroInvoice) {
  const r = rate(i.CurrencyRate);
  return {
    invoiceId: i.InvoiceID,
    type: i.Type,
    number: i.InvoiceNumber || null,
    reference: i.Reference || null,
    contactId: i.Contact?.ContactID ?? null,
    contactName: i.Contact?.Name ?? null,
    status: i.Status,
    date: parseXeroDateOnly(i.DateString, i.Date),
    dueDate: parseXeroDateOnly(i.DueDateString, i.DueDate),
    // 'XXX' is ISO 4217's "no currency" code. Xero always sends one; this only guards bad payloads.
    currencyCode: i.CurrencyCode ?? 'XXX',
    currencyRate: r,
    subTotal: money(i.SubTotal),
    totalTax: money(i.TotalTax),
    total: money(i.Total),
    amountDue: money(i.AmountDue),
    amountPaid: money(i.AmountPaid),
    amountCredited: money(i.AmountCredited),
    totalBase: toBase(i.Total, r),
    amountDueBase: toBase(i.AmountDue, r),
    lineItems: lineItems(i.LineItems),
    hasAttachments: i.HasAttachments ?? false,
    updatedDateUtc: updated(i.UpdatedDateUTC),
    raw: raw(i),
  } satisfies Prisma.XeroInvoiceCreateInput;
}

export function normalizeCreditNote(n: XeroCreditNote) {
  const r = rate(n.CurrencyRate);
  return {
    creditNoteId: n.CreditNoteID,
    type: n.Type,
    number: n.CreditNoteNumber || null,
    reference: n.Reference || null,
    contactId: n.Contact?.ContactID ?? null,
    contactName: n.Contact?.Name ?? null,
    status: n.Status,
    date: parseXeroDateOnly(n.DateString, n.Date),
    currencyCode: n.CurrencyCode ?? 'XXX',
    currencyRate: r,
    subTotal: money(n.SubTotal),
    totalTax: money(n.TotalTax),
    total: money(n.Total),
    remainingCredit: money(n.RemainingCredit),
    totalBase: toBase(n.Total, r),
    lineItems: lineItems(n.LineItems),
    hasAttachments: n.HasAttachments ?? false,
    updatedDateUtc: updated(n.UpdatedDateUTC),
    raw: raw(n),
  } satisfies Prisma.XeroCreditNoteCreateInput;
}

export function normalizeBankTransaction(t: XeroBankTransaction) {
  const r = rate(t.CurrencyRate);
  return {
    bankTransactionId: t.BankTransactionID,
    type: t.Type,
    contactId: t.Contact?.ContactID ?? null,
    contactName: t.Contact?.Name ?? null,
    bankAccountCode: t.BankAccount?.Code ?? null,
    bankAccountName: t.BankAccount?.Name ?? null,
    reference: t.Reference || null,
    status: t.Status,
    isReconciled: t.IsReconciled ?? false,
    date: parseXeroDateOnly(t.DateString, t.Date),
    currencyCode: t.CurrencyCode ?? 'XXX',
    currencyRate: r,
    subTotal: money(t.SubTotal),
    totalTax: money(t.TotalTax),
    total: money(t.Total),
    totalBase: toBase(t.Total, r),
    lineItems: lineItems(t.LineItems),
    hasAttachments: t.HasAttachments ?? false,
    updatedDateUtc: updated(t.UpdatedDateUTC),
    raw: raw(t),
  } satisfies Prisma.XeroBankTransactionCreateInput;
}

export function normalizePayment(p: XeroPayment) {
  const r = rate(p.CurrencyRate);
  const contact = p.Invoice?.Contact ?? p.CreditNote?.Contact;
  return {
    paymentId: p.PaymentID,
    paymentType: p.PaymentType ?? 'UNKNOWN',
    cashDirection: cashDirection(p.PaymentType),
    status: p.Status,
    invoiceId: p.Invoice?.InvoiceID ?? null,
    invoiceNumber: p.Invoice?.InvoiceNumber ?? null,
    creditNoteId: p.CreditNote?.CreditNoteID ?? null,
    creditNoteNumber: p.CreditNote?.CreditNoteNumber ?? null,
    contactId: contact?.ContactID ?? null,
    contactName: contact?.Name ?? null,
    date: parseXeroDateOnly(undefined, p.Date),
    currencyCode: p.Invoice?.CurrencyCode ?? p.CreditNote?.CurrencyCode ?? null,
    amount: money(p.Amount),
    currencyRate: r,
    amountBase: toBase(p.Amount, r),
    bankAccountCode: p.Account?.Code ?? null,
    bankAccountName: p.Account?.Name ?? null,
    reference: p.Reference || null,
    updatedDateUtc: updated(p.UpdatedDateUTC),
    raw: raw(p),
  } satisfies Prisma.XeroPaymentCreateInput;
}

export function normalizeAttachment(parentType: AttachmentParentType, parentId: string, a: XeroAttachment) {
  return {
    attachmentId: a.AttachmentID,
    parentType,
    parentId,
    fileName: a.FileName,
    mimeType: a.MimeType ?? null,
    contentLength: a.ContentLength ?? null,
  } satisfies Prisma.XeroAttachmentCreateManyInput;
}

export type NormalizedRows = {
  contacts: ReturnType<typeof normalizeContact>;
  invoices: ReturnType<typeof normalizeInvoice>;
  creditNotes: ReturnType<typeof normalizeCreditNote>;
  bankTransactions: ReturnType<typeof normalizeBankTransaction>;
  payments: ReturnType<typeof normalizePayment>;
};
