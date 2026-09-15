import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { XeroConnectionRepository } from './xero-connection.repository';
import {
  AGING_BUCKETS, addMonths, bucketAging, dayString, daysPastDue, IN_BANK_TYPES, invoiceStatusWhere, monthStartDhaka,
  OUT_BANK_TYPES, todayDhaka, xeroDeepLink,
} from './finance-math';
import type {
  BankTxListQueryDto, ContactListQueryDto, CreditNoteListQueryDto, InvoiceListQueryDto, PaymentListQueryDto,
} from './dto/finance-query.dto';

const num = (v: unknown): number => (v == null ? 0 : Math.round(Number(v) * 100) / 100);
const lim = (v?: number) => Math.min(Math.max(Number(v) || 50, 1), 200);
const off = (v?: number) => Math.max(Number(v) || 0, 0);
const ins = (q: string) => ({ contains: q, mode: 'insensitive' as const });
const dir = (d?: 'asc' | 'desc') => d ?? 'desc';

function rangeWhere(field: string, from?: string, to?: string) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { gte: new Date(`${from.slice(0, 10)}T00:00:00.000Z`) } : {}), ...(to ? { lte: new Date(`${to.slice(0, 10)}T00:00:00.000Z`) } : {}) } };
}

const lineItemsOut = (v: unknown) =>
  (Array.isArray(v) ? v : []).map((l: any) => ({
    description: l.description ?? null, quantity: l.quantity ?? null, unitAmount: l.unitAmount ?? null,
    accountCode: l.accountCode ?? null, taxType: l.taxType ?? null, taxAmount: l.taxAmount ?? null, lineAmount: l.lineAmount ?? null,
  }));

/**
 * Read-only queries behind /api/finance/*. Every money figure in a KPI is in the
 * organisation's base currency (*_base columns). List rows carry both the
 * document amount and its base equivalent.
 */
@Injectable()
export class FinanceReportsService {
  /** Overridable in tests. */
  now = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: XeroConnectionRepository,
  ) {}

  async summary() {
    const today = todayDhaka(this.now());
    const monthStart = monthStartDhaka(this.now());
    const seriesStart = addMonths(monthStart, -5);
    const recOpen = { type: 'ACCREC', status: 'AUTHORISED' };
    const [owed, overdue, owe, oldest, nextDue, open, payments, bank, conn] = await Promise.all([
      this.prisma.xeroInvoice.aggregate({ where: recOpen, _sum: { amountDueBase: true }, _count: { _all: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { ...recOpen, dueDate: { lt: today } }, _sum: { amountDueBase: true }, _count: { _all: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { type: 'ACCPAY', status: 'AUTHORISED' }, _sum: { amountDueBase: true }, _count: { _all: true } }),
      this.prisma.xeroInvoice.findFirst({ where: { ...recOpen, dueDate: { lt: today } }, orderBy: { dueDate: 'asc' }, select: { dueDate: true } }),
      this.prisma.xeroInvoice.findFirst({ where: { type: 'ACCPAY', status: 'AUTHORISED', dueDate: { gte: today } }, orderBy: { dueDate: 'asc' }, select: { dueDate: true } }),
      this.prisma.xeroInvoice.findMany({ where: recOpen, select: { contactId: true, contactName: true, dueDate: true, amountDueBase: true } }),
      this.prisma.xeroPayment.findMany({
        where: { status: { not: 'DELETED' }, cashDirection: { not: null }, date: { gte: seriesStart } },
        select: { date: true, amountBase: true, cashDirection: true },
      }),
      this.prisma.xeroBankTransaction.findMany({
        where: { status: 'AUTHORISED', type: { in: [...IN_BANK_TYPES, ...OUT_BANK_TYPES] }, date: { gte: seriesStart } },
        select: { date: true, totalBase: true, type: true },
      }),
      this.connection.get(),
    ]);

    const months = Array.from({ length: 6 }, (_, i) => dayString(addMonths(seriesStart, i))!.slice(0, 7));
    const series = new Map(months.map((m) => [m, { month: m, in: 0, out: 0 }]));
    const add = (date: Date | null, amount: number, way: 'in' | 'out') => {
      const p = date && series.get(dayString(date)!.slice(0, 7));
      if (p) p[way] = Math.round((p[way] + amount) * 100) / 100;
    };
    for (const p of payments) add(p.date, num(p.amountBase), p.cashDirection as 'in' | 'out');
    for (const t of bank) add(t.date, num(t.totalBase), IN_BANK_TYPES.includes(t.type) ? 'in' : 'out');

    const openRows = open.map((r) => ({ ...r, amountDueBase: num(r.amountDueBase) }));
    const aging = bucketAging(openRows, today);
    const byContact = new Map<string, { contactId: string; contactName: string; amount: number; invoices: number; oldestDays: number }>();
    for (const r of openRows) {
      if (!r.contactId || !r.dueDate || r.dueDate >= today) continue;
      const days = daysPastDue(r.dueDate, today);
      const cur = byContact.get(r.contactId) ?? { contactId: r.contactId, contactName: r.contactName ?? '', amount: 0, invoices: 0, oldestDays: 0 };
      cur.amount = Math.round((cur.amount + r.amountDueBase) * 100) / 100;
      cur.invoices += 1;
      cur.oldestDays = Math.max(cur.oldestDays, days);
      byContact.set(r.contactId, cur);
    }
    const last = series.get(months[5])!;
    return {
      baseCurrency: conn?.baseCurrency ?? null,
      owedToYou: { amount: num(owed._sum.amountDueBase), count: owed._count._all },
      overdue: { amount: num(overdue._sum.amountDueBase), count: overdue._count._all, oldestDays: oldest?.dueDate ? daysPastDue(oldest.dueDate, today) : null },
      youOwe: { amount: num(owe._sum.amountDueBase), count: owe._count._all, nextDueDate: dayString(nextDue?.dueDate) },
      moneyInMonth: last.in,
      moneyOutMonth: last.out,
      aging: AGING_BUCKETS.map((bucket) => ({ bucket, amount: aging[bucket] })),
      topOverdue: [...byContact.values()].sort((a, b) => b.amount - a.amount).slice(0, 3),
      series: [...series.values()],
    };
  }

  /**
   * Rollups are joined and sorted in memory. That's fine up to a few thousand
   * contacts. If the book grows past ~5k, move this to one SQL query with
   * LEFT JOINed aggregates.
   */
  async listContacts(q: ContactListQueryDto) {
    const today = todayDhaka(this.now());
    const and: Prisma.XeroContactWhereInput[] = [];
    if (!q.archived) and.push({ status: { not: 'ARCHIVED' } });
    if (q.role === 'customer') and.push({ isCustomer: true });
    if (q.role === 'supplier') and.push({ isSupplier: true });
    if (q.q) and.push({ OR: [{ name: ins(q.q) }, { email: ins(q.q) }, { firstName: ins(q.q) }, { lastName: ins(q.q) }] });
    const [contacts, owed, overdue, owing, lastInv, lastBank] = await Promise.all([
      this.prisma.xeroContact.findMany({
        where: { AND: and },
        select: { contactId: true, name: true, email: true, firstName: true, lastName: true, isCustomer: true, isSupplier: true, status: true, defaultCurrency: true },
      }),
      this.prisma.xeroInvoice.groupBy({ by: ['contactId'], where: { type: 'ACCREC', status: 'AUTHORISED' }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.groupBy({ by: ['contactId'], where: { type: 'ACCREC', status: 'AUTHORISED', dueDate: { lt: today } }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.groupBy({ by: ['contactId'], where: { type: 'ACCPAY', status: 'AUTHORISED' }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.groupBy({ by: ['contactId'], where: { status: { not: 'DELETED' } }, _max: { date: true } }),
      this.prisma.xeroBankTransaction.groupBy({ by: ['contactId'], where: { status: { not: 'DELETED' } }, _max: { date: true } }),
    ]);
    const sumMap = (rows: { contactId: string | null; _sum: { amountDueBase: unknown } }[]) =>
      new Map(rows.map((r) => [r.contactId, num(r._sum.amountDueBase)]));
    const [owedM, overdueM, owingM] = [sumMap(owed as never), sumMap(overdue as never), sumMap(owing as never)];
    const lastM = new Map<string | null, Date>();
    for (const r of [...(lastInv as any[]), ...(lastBank as any[])]) {
      const dt: Date | null = r._max?.date ?? null;
      if (dt && (!lastM.get(r.contactId) || dt > lastM.get(r.contactId)!)) lastM.set(r.contactId, dt);
    }
    const items = contacts.map((c) => ({
      id: c.contactId, name: c.name, email: c.email,
      person: [c.firstName, c.lastName].filter(Boolean).join(' ') || null,
      isCustomer: c.isCustomer, isSupplier: c.isSupplier, archived: c.status === 'ARCHIVED', defaultCurrency: c.defaultCurrency,
      owed: owedM.get(c.contactId) ?? 0, overdue: overdueM.get(c.contactId) ?? 0, owing: owingM.get(c.contactId) ?? 0,
      lastActivity: dayString(lastM.get(c.contactId)),
    }));
    const key = q.sort ?? 'owed';
    const sign = dir(q.dir) === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      const x = key === 'lastActivity' ? (a.lastActivity ?? '') : (a as any)[key];
      const y = key === 'lastActivity' ? (b.lastActivity ?? '') : (b as any)[key];
      if (key === 'name') return String(x).localeCompare(String(y)) * (q.dir === 'desc' ? -1 : 1);
      return (x > y ? 1 : x < y ? -1 : a.name.localeCompare(b.name) * -sign) * sign;
    });
    const start = off(q.offset);
    return { items: items.slice(start, start + lim(q.limit)), total: items.length };
  }

  async contactDetail(id: string) {
    const c = await this.prisma.xeroContact.findUnique({ where: { contactId: id } });
    if (!c) throw new NotFoundException('Contact not found');
    const today = todayDhaka(this.now());
    const [billed, owed, overdue, owing, spendBills, spendBank, invoices, bills, bank, creditNotes, payments, lastInv, conn] = await Promise.all([
      this.prisma.xeroInvoice.aggregate({ where: { contactId: id, type: 'ACCREC', status: { in: ['AUTHORISED', 'PAID'] } }, _sum: { totalBase: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { contactId: id, type: 'ACCREC', status: 'AUTHORISED' }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { contactId: id, type: 'ACCREC', status: 'AUTHORISED', dueDate: { lt: today } }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { contactId: id, type: 'ACCPAY', status: 'AUTHORISED' }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { contactId: id, type: 'ACCPAY', status: { in: ['AUTHORISED', 'PAID'] } }, _sum: { totalBase: true } }),
      // Plain 'SPEND' only: a prepayment/overpayment allocated to a bill marks the bill
      // PAID without a Payment row, so counting SPEND-PREPAYMENT/SPEND-OVERPAYMENT here
      // alongside the ACCPAY bill total above would double-count that spend.
      this.prisma.xeroBankTransaction.aggregate({ where: { contactId: id, status: 'AUTHORISED', type: 'SPEND' }, _sum: { totalBase: true } }),
      this.prisma.xeroInvoice.count({ where: { contactId: id, type: 'ACCREC', status: { not: 'DELETED' } } }),
      this.prisma.xeroInvoice.count({ where: { contactId: id, type: 'ACCPAY', status: { not: 'DELETED' } } }),
      this.prisma.xeroBankTransaction.count({ where: { contactId: id, status: { not: 'DELETED' } } }),
      this.prisma.xeroCreditNote.count({ where: { contactId: id, status: { not: 'DELETED' } } }),
      this.prisma.xeroPayment.count({ where: { contactId: id, status: { not: 'DELETED' } } }),
      this.prisma.xeroInvoice.findFirst({ where: { contactId: id, status: { not: 'DELETED' } }, orderBy: { date: 'desc' }, select: { date: true } }),
      this.connection.get(),
    ]);
    return {
      id: c.contactId, name: c.name, email: c.email, firstName: c.firstName, lastName: c.lastName,
      person: [c.firstName, c.lastName].filter(Boolean).join(' ') || null,
      isCustomer: c.isCustomer, isSupplier: c.isSupplier, archived: c.status === 'ARCHIVED', defaultCurrency: c.defaultCurrency,
      taxNumber: c.taxNumber, phones: (c.phones as unknown[]) ?? [], addresses: (c.addresses as unknown[]) ?? [],
      owed: num(owed._sum.amountDueBase), overdue: num(overdue._sum.amountDueBase), owing: num(owing._sum.amountDueBase), lastActivity: dayString(lastInv?.date),
      kpis: {
        billed: num(billed._sum.totalBase), owed: num(owed._sum.amountDueBase), overdue: num(overdue._sum.amountDueBase),
        spend: Math.round((num(spendBills._sum.totalBase) + num(spendBank._sum.totalBase)) * 100) / 100,
      },
      counts: { invoices, bills, bank, creditNotes, payments },
      xeroUrl: xeroDeepLink(conn?.shortCode ?? null, 'contact', c.contactId),
    };
  }

  async contactActivity(id: string) {
    const [inv, pay, bank, cn] = await Promise.all([
      this.prisma.xeroInvoice.findMany({ where: { contactId: id, status: { not: 'DELETED' } }, orderBy: { updatedDateUtc: 'desc' }, take: 20 }),
      this.prisma.xeroPayment.findMany({ where: { contactId: id, status: { not: 'DELETED' } }, orderBy: { date: 'desc' }, take: 20 }),
      this.prisma.xeroBankTransaction.findMany({ where: { contactId: id, status: { not: 'DELETED' } }, orderBy: { date: 'desc' }, take: 20 }),
      this.prisma.xeroCreditNote.findMany({ where: { contactId: id, status: { not: 'DELETED' } }, orderBy: { date: 'desc' }, take: 20 }),
    ]);
    const items = [
      ...inv.map((i) => ({
        kind: (i.type === 'ACCREC' ? 'invoice' : 'bill') as 'invoice' | 'bill', id: i.invoiceId, date: dayString(i.date),
        title: `${i.type === 'ACCREC' ? 'Invoice' : 'Bill'} ${i.number ?? ''}`.trim(), amount: num(i.total), currencyCode: i.currencyCode, status: i.status,
      })),
      ...pay.map((p) => ({
        kind: 'payment' as const, id: p.paymentId, date: dayString(p.date),
        title: `Payment ${p.cashDirection === 'in' ? 'received' : 'made'}${p.invoiceNumber ? ` for ${p.invoiceNumber}` : ''}`,
        amount: num(p.amount), currencyCode: p.currencyCode, status: p.status,
      })),
      ...bank.map((t) => ({
        kind: 'bank' as const, id: t.bankTransactionId, date: dayString(t.date),
        title: `${t.type.startsWith('SPEND') ? 'Spend money' : 'Receive money'}${t.reference ? ` · ${t.reference}` : ''}`,
        amount: num(t.total), currencyCode: t.currencyCode, status: t.status,
      })),
      ...cn.map((n) => ({
        kind: 'creditNote' as const, id: n.creditNoteId, date: dayString(n.date), title: `Credit note ${n.number ?? ''}`.trim(),
        amount: num(n.total), currencyCode: n.currencyCode, status: n.status,
      })),
    ];
    items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return { items: items.slice(0, 30) };
  }

  private invoiceItem(i: any, today: Date) {
    const overdue = i.status === 'AUTHORISED' && !!i.dueDate && i.dueDate < today;
    return {
      id: i.invoiceId, type: i.type, number: i.number, reference: i.reference, contactId: i.contactId, contactName: i.contactName,
      status: i.status, overdue, overdueDays: overdue ? daysPastDue(i.dueDate, today) : 0, partPaid: i.status === 'AUTHORISED' && num(i.amountPaid) > 0,
      date: dayString(i.date), dueDate: dayString(i.dueDate), currencyCode: i.currencyCode,
      total: num(i.total), amountDue: num(i.amountDue), amountPaid: num(i.amountPaid), totalBase: num(i.totalBase), amountDueBase: num(i.amountDueBase),
      hasAttachments: !!i.hasAttachments,
    };
  }

  async listInvoices(q: InvoiceListQueryDto) {
    const today = todayDhaka(this.now());
    const and: Prisma.XeroInvoiceWhereInput[] = [{ type: q.type }, invoiceStatusWhere(q.status, today)];
    if (q.currency) and.push({ currencyCode: q.currency });
    if (q.contactId) and.push({ contactId: q.contactId });
    if (q.from || q.to) and.push(rangeWhere('date', q.from, q.to));
    if (q.q) and.push({ OR: [{ number: ins(q.q) }, { reference: ins(q.q) }, { contactName: ins(q.q) }] });
    const where = { AND: and };
    const sortField = ({ date: 'date', dueDate: 'dueDate', number: 'number', contactName: 'contactName', total: 'totalBase', amountDue: 'amountDueBase' } as const)[
      (q.sort ?? 'date') as 'date'
    ] ?? 'date';
    const [rows, total, sums] = await Promise.all([
      this.prisma.xeroInvoice.findMany({ where, orderBy: [{ [sortField]: dir(q.dir) }, { invoiceId: 'asc' }], take: lim(q.limit), skip: off(q.offset) }),
      this.prisma.xeroInvoice.count({ where }),
      this.prisma.xeroInvoice.aggregate({ where, _sum: { totalBase: true, amountDueBase: true } }),
    ]);
    return {
      items: rows.map((r) => this.invoiceItem(r, today)),
      total,
      totals: { totalBase: num(sums._sum.totalBase), amountDueBase: num(sums._sum.amountDueBase) },
    };
  }

  async invoiceDetail(id: string) {
    const i = await this.prisma.xeroInvoice.findUnique({ where: { invoiceId: id } });
    if (!i) throw new NotFoundException('Invoice not found');
    const [payments, attachments, conn] = await Promise.all([
      this.prisma.xeroPayment.findMany({ where: { invoiceId: id, status: { not: 'DELETED' } }, orderBy: { date: 'asc' } }),
      this.prisma.xeroAttachment.findMany({ where: { parentId: id }, orderBy: { fileName: 'asc' } }),
      this.connection.get(),
    ]);
    return {
      ...this.invoiceItem(i, todayDhaka(this.now())),
      currencyRate: Number(i.currencyRate), subTotal: num(i.subTotal), totalTax: num(i.totalTax), amountCredited: num(i.amountCredited),
      lineItems: lineItemsOut(i.lineItems),
      payments: payments.map((p) => this.paymentItem(p)),
      attachments: attachments.map((a) => this.attachmentItem(a)),
      updatedDateUtc: i.updatedDateUtc?.toISOString?.() ?? null,
      xeroUrl: xeroDeepLink(conn?.shortCode ?? null, i.type === 'ACCREC' ? 'invoice' : 'bill', i.invoiceId),
    };
  }

  private bankItem(t: any) {
    const direction = t.type.endsWith('TRANSFER') ? 'transfer' : t.type.startsWith('RECEIVE') ? 'in' : 'out';
    const first = Array.isArray(t.lineItems) ? t.lineItems[0] : undefined;
    return {
      id: t.bankTransactionId, type: t.type, direction, contactId: t.contactId, contactName: t.contactName, reference: t.reference,
      description: first?.description ?? null, accountCode: first?.accountCode ?? null, bankAccountName: t.bankAccountName,
      status: t.status, isReconciled: t.isReconciled, date: dayString(t.date), currencyCode: t.currencyCode,
      total: num(t.total), totalBase: num(t.totalBase), hasAttachments: !!t.hasAttachments,
    };
  }

  async listBankTransactions(q: BankTxListQueryDto) {
    const and: Prisma.XeroBankTransactionWhereInput[] = [{ status: { not: 'DELETED' } }];
    if (q.type) and.push({ type: { startsWith: q.type } });
    if (q.reconciled !== undefined) and.push({ isReconciled: q.reconciled });
    if (q.contactId) and.push({ contactId: q.contactId });
    if (q.from || q.to) and.push(rangeWhere('date', q.from, q.to));
    if (q.q) and.push({ OR: [{ contactName: ins(q.q) }, { reference: ins(q.q) }, { bankAccountName: ins(q.q) }] });
    const where = { AND: and };
    const sortField = ({ date: 'date', total: 'totalBase', contactName: 'contactName' } as const)[(q.sort ?? 'date') as 'date'] ?? 'date';
    const [rows, total, spent, received] = await Promise.all([
      this.prisma.xeroBankTransaction.findMany({ where, orderBy: [{ [sortField]: dir(q.dir) }, { bankTransactionId: 'asc' }], take: lim(q.limit), skip: off(q.offset) }),
      this.prisma.xeroBankTransaction.count({ where }),
      this.prisma.xeroBankTransaction.aggregate({ where: { AND: [...and, { type: { in: OUT_BANK_TYPES } }] }, _sum: { totalBase: true } }),
      this.prisma.xeroBankTransaction.aggregate({ where: { AND: [...and, { type: { in: IN_BANK_TYPES } }] }, _sum: { totalBase: true } }),
    ]);
    return { items: rows.map((r) => this.bankItem(r)), total, totals: { spentBase: num(spent._sum.totalBase), receivedBase: num(received._sum.totalBase) } };
  }

  async bankTransactionDetail(id: string) {
    const t = await this.prisma.xeroBankTransaction.findUnique({ where: { bankTransactionId: id } });
    if (!t) throw new NotFoundException('Bank transaction not found');
    const [attachments, conn] = await Promise.all([
      this.prisma.xeroAttachment.findMany({ where: { parentId: id }, orderBy: { fileName: 'asc' } }),
      this.connection.get(),
    ]);
    return {
      ...this.bankItem(t), lineItems: lineItemsOut(t.lineItems), attachments: attachments.map((a) => this.attachmentItem(a)),
      xeroUrl: xeroDeepLink(conn?.shortCode ?? null, 'bankTransaction', t.bankTransactionId),
    };
  }

  private creditNoteItem(n: any) {
    return {
      id: n.creditNoteId, type: n.type, number: n.number, reference: n.reference, contactId: n.contactId, contactName: n.contactName,
      status: n.status, date: dayString(n.date), currencyCode: n.currencyCode, total: num(n.total), remainingCredit: num(n.remainingCredit),
      totalBase: num(n.totalBase),
    };
  }

  async listCreditNotes(q: CreditNoteListQueryDto) {
    const and: Prisma.XeroCreditNoteWhereInput[] = [{ status: { not: 'DELETED' } }];
    if (q.contactId) and.push({ contactId: q.contactId });
    if (q.from || q.to) and.push(rangeWhere('date', q.from, q.to));
    if (q.q) and.push({ OR: [{ number: ins(q.q) }, { reference: ins(q.q) }, { contactName: ins(q.q) }] });
    const where = { AND: and };
    const sortField = ({ date: 'date', number: 'number', total: 'totalBase' } as const)[(q.sort ?? 'date') as 'date'] ?? 'date';
    const [rows, total, sums] = await Promise.all([
      this.prisma.xeroCreditNote.findMany({ where, orderBy: [{ [sortField]: dir(q.dir) }, { creditNoteId: 'asc' }], take: lim(q.limit), skip: off(q.offset) }),
      this.prisma.xeroCreditNote.count({ where }),
      this.prisma.xeroCreditNote.aggregate({ where, _sum: { totalBase: true } }),
    ]);
    return { items: rows.map((r) => this.creditNoteItem(r)), total, totals: { totalBase: num(sums._sum.totalBase) } };
  }

  async creditNoteDetail(id: string) {
    const n = await this.prisma.xeroCreditNote.findUnique({ where: { creditNoteId: id } });
    if (!n) throw new NotFoundException('Credit note not found');
    const [payments, attachments, conn] = await Promise.all([
      this.prisma.xeroPayment.findMany({ where: { creditNoteId: id, status: { not: 'DELETED' } }, orderBy: { date: 'asc' } }),
      this.prisma.xeroAttachment.findMany({ where: { parentId: id }, orderBy: { fileName: 'asc' } }),
      this.connection.get(),
    ]);
    return {
      ...this.creditNoteItem(n), lineItems: lineItemsOut(n.lineItems), payments: payments.map((p) => this.paymentItem(p)),
      attachments: attachments.map((a) => this.attachmentItem(a)), xeroUrl: xeroDeepLink(conn?.shortCode ?? null, 'creditNote', n.creditNoteId),
    };
  }

  private paymentItem(p: any) {
    return {
      id: p.paymentId, paymentType: p.paymentType, direction: p.cashDirection, status: p.status, invoiceId: p.invoiceId, invoiceNumber: p.invoiceNumber,
      creditNoteId: p.creditNoteId, creditNoteNumber: p.creditNoteNumber, contactId: p.contactId, contactName: p.contactName,
      date: dayString(p.date), currencyCode: p.currencyCode, amount: num(p.amount), amountBase: num(p.amountBase),
      bankAccountName: p.bankAccountName, reference: p.reference,
    };
  }

  private attachmentItem(a: any) {
    return { id: a.attachmentId, fileName: a.fileName, mimeType: a.mimeType, contentLength: a.contentLength };
  }

  async listPayments(q: PaymentListQueryDto) {
    const and: Prisma.XeroPaymentWhereInput[] = [{ status: { not: 'DELETED' } }];
    if (q.direction) and.push({ cashDirection: q.direction });
    if (q.contactId) and.push({ contactId: q.contactId });
    if (q.from || q.to) and.push(rangeWhere('date', q.from, q.to));
    if (q.q) and.push({ OR: [{ contactName: ins(q.q) }, { invoiceNumber: ins(q.q) }, { reference: ins(q.q) }] });
    const where = { AND: and };
    const sortField = ({ date: 'date', amount: 'amountBase' } as const)[(q.sort ?? 'date') as 'date'] ?? 'date';
    const [rows, total, ins_, outs] = await Promise.all([
      this.prisma.xeroPayment.findMany({ where, orderBy: [{ [sortField]: dir(q.dir) }, { paymentId: 'asc' }], take: lim(q.limit), skip: off(q.offset) }),
      this.prisma.xeroPayment.count({ where }),
      this.prisma.xeroPayment.aggregate({ where: { AND: [...and, { cashDirection: 'in' }] }, _sum: { amountBase: true } }),
      this.prisma.xeroPayment.aggregate({ where: { AND: [...and, { cashDirection: 'out' }] }, _sum: { amountBase: true } }),
    ]);
    return { items: rows.map((r) => this.paymentItem(r)), total, totals: { inBase: num(ins_._sum.amountBase), outBase: num(outs._sum.amountBase) } };
  }
}
