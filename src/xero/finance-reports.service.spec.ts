import { NotFoundException } from '@nestjs/common';
import { FinanceReportsService } from './finance-reports.service';
import { IN_BANK_TYPES, OUT_BANK_TYPES } from './finance-math';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const NOW = new Date('2026-09-15T06:00:00Z'); // 12:00 Dhaka, 15 Sep

function makePrisma() {
  const m = () => ({
    aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
  });
  return { xeroInvoice: m(), xeroContact: m(), xeroCreditNote: m(), xeroBankTransaction: m(), xeroPayment: m(), xeroAttachment: m() };
}

function setup() {
  const prisma = makePrisma();
  const connection = { get: jest.fn().mockResolvedValue({ shortCode: '!abc12', baseCurrency: 'USD' }) };
  const svc = new FinanceReportsService(prisma as never, connection as never);
  svc.now = () => NOW;
  return { svc, prisma };
}

describe('FinanceReportsService.summary', () => {
  it('computes KPIs, aging, top overdue and the 6-month series, excluding transfers', async () => {
    const { svc, prisma } = setup();
    // Argument-aware: keyed on the actual `where` (type + dueDate presence), not on
    // call order, so a mutation that swaps which type/dueDate a query filters on
    // changes the value that comes back — the existing s.owedToYou/s.overdue/s.youOwe
    // assertions below then do the discriminating instead of a separate assertion.
    prisma.xeroInvoice.aggregate.mockImplementation(async ({ where }: { where: { type: string; dueDate?: unknown } }) => {
      if (where.type === 'ACCREC' && where.dueDate) return { _sum: { amountDueBase: 900 }, _count: { _all: 2 } }; // overdue
      if (where.type === 'ACCREC') return { _sum: { amountDueBase: 1500 }, _count: { _all: 3 } }; // owed to you
      if (where.type === 'ACCPAY') return { _sum: { amountDueBase: 400 }, _count: { _all: 1 } }; // you owe
      return { _sum: {}, _count: { _all: 0 } };
    });
    prisma.xeroInvoice.findFirst.mockImplementation(async ({ where }: { where: { type: string; dueDate?: { lt?: unknown; gte?: unknown } } }) => {
      if (where.type === 'ACCREC' && where.dueDate?.lt) return { dueDate: d('2026-06-01') }; // oldest overdue
      if (where.type === 'ACCPAY' && where.dueDate?.gte) return { dueDate: d('2026-09-18') }; // next bill due
      return null;
    });
    prisma.xeroInvoice.findMany.mockResolvedValueOnce([
      { contactId: 'c1', contactName: 'Oakridge', dueDate: d('2026-06-01'), amountDueBase: 700 },
      { contactId: 'c2', contactName: 'Meridian', dueDate: d('2026-09-10'), amountDueBase: 200 },
      { contactId: 'c1', contactName: 'Oakridge', dueDate: d('2026-10-01'), amountDueBase: 600 },
    ]);
    prisma.xeroPayment.findMany.mockResolvedValueOnce([
      { date: d('2026-09-03'), amountBase: 1000, cashDirection: 'in' },
      { date: d('2026-08-20'), amountBase: 300, cashDirection: 'out' },
    ]);
    prisma.xeroBankTransaction.findMany.mockResolvedValueOnce([
      { date: d('2026-09-05'), totalBase: 50, type: 'SPEND' },
      { date: d('2026-09-06'), totalBase: 20, type: 'RECEIVE' },
    ]);

    const s = await svc.summary();

    expect(s.owedToYou).toEqual({ amount: 1500, count: 3 });
    expect(s.overdue).toEqual({ amount: 900, count: 2, oldestDays: 106 });
    expect(s.youOwe).toEqual({ amount: 400, count: 1, nextDueDate: '2026-09-18' });
    expect(s.moneyInMonth).toBe(1020);
    expect(s.moneyOutMonth).toBe(50);
    expect(s.aging).toEqual([
      { bucket: 'current', amount: 600 }, { bucket: '1-30', amount: 200 }, { bucket: '31-60', amount: 0 },
      { bucket: '61-90', amount: 0 }, { bucket: '90+', amount: 700 },
    ]);
    expect(s.topOverdue[0]).toEqual({ contactId: 'c1', contactName: 'Oakridge', amount: 700, invoices: 1, oldestDays: 106 });
    expect(s.series.map((p) => p.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(s.series[4]).toEqual({ month: '2026-08', in: 0, out: 300 });
    const bankWhere = prisma.xeroBankTransaction.findMany.mock.calls[0][0].where;
    expect(bankWhere.type.in).not.toContain('SPEND-TRANSFER');
    expect(bankWhere.type.in).not.toContain('RECEIVE-TRANSFER');

    // KPI where-clause assertions, matched by content (not call index) so a
    // harmless reorder of the Promise.all array doesn't break the test, but a
    // wrong filter (wrong type, missing status/dueDate/cashDirection) does.
    const aggCalls = prisma.xeroInvoice.aggregate.mock.calls.map(([arg]) => arg);
    const owedCall = aggCalls.find((c) => c.where.type === 'ACCREC' && !('dueDate' in c.where));
    expect(owedCall?.where).toEqual({ type: 'ACCREC', status: 'AUTHORISED' });
    const overdueCall = aggCalls.find((c) => c.where.type === 'ACCREC' && 'dueDate' in c.where);
    expect(overdueCall?.where).toEqual({ type: 'ACCREC', status: 'AUTHORISED', dueDate: { lt: d('2026-09-15') } });
    const oweCall = aggCalls.find((c) => c.where.type === 'ACCPAY');
    expect(oweCall?.where).toEqual({ type: 'ACCPAY', status: 'AUTHORISED' });

    expect(prisma.xeroPayment.findMany.mock.calls[0][0].where).toEqual({
      status: { not: 'DELETED' }, cashDirection: { not: null }, date: { gte: d('2026-04-01') },
    });
    expect(bankWhere).toEqual({
      status: 'AUTHORISED', type: { in: [...IN_BANK_TYPES, ...OUT_BANK_TYPES] }, date: { gte: d('2026-04-01') },
    });
  });
});

describe('FinanceReportsService.listInvoices', () => {
  it('ANDs the status bucket with search, maps decimals to numbers and flags overdue', async () => {
    const { svc, prisma } = setup();
    prisma.xeroInvoice.findMany.mockResolvedValueOnce([
      {
        invoiceId: 'i1', type: 'ACCREC', number: 'INV-0142', reference: null, contactId: 'c1', contactName: 'Oakridge',
        status: 'AUTHORISED', date: d('2026-08-01'), dueDate: d('2026-09-01'), currencyCode: 'GBP', total: '1100.00',
        amountDue: '660.00', amountPaid: '440.00', totalBase: '1397.00', amountDueBase: '838.20', hasAttachments: false,
      },
    ]);
    prisma.xeroInvoice.count.mockResolvedValueOnce(1);
    prisma.xeroInvoice.aggregate.mockResolvedValueOnce({ _sum: { totalBase: '1397.00', amountDueBase: '838.20' } });

    const res = await svc.listInvoices({ type: 'ACCREC', status: 'overdue', q: 'oak', limit: 25, offset: 0 });

    const where = prisma.xeroInvoice.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { type: 'ACCREC' },
        { status: 'AUTHORISED', dueDate: { lt: d('2026-09-15') } },
        { OR: [
          { number: { contains: 'oak', mode: 'insensitive' } },
          { reference: { contains: 'oak', mode: 'insensitive' } },
          { contactName: { contains: 'oak', mode: 'insensitive' } },
        ] },
      ]),
    );
    expect(res.total).toBe(1);
    expect(res.totals).toEqual({ totalBase: 1397, amountDueBase: 838.2 });
    expect(res.items[0]).toMatchObject({ id: 'i1', overdue: true, overdueDays: 14, partPaid: true, total: 1100, date: '2026-08-01', dueDate: '2026-09-01' });
  });

  it('status=unpaid filters AUTHORISED including overdue: no due-date clause (the "Owed to you" / "You owe" tiles)', async () => {
    const { svc, prisma } = setup();
    await svc.listInvoices({ type: 'ACCPAY', status: 'unpaid' } as never);
    expect(prisma.xeroInvoice.findMany.mock.calls[0][0].where).toEqual({ AND: [{ type: 'ACCPAY' }, { status: 'AUTHORISED' }] });
    expect(prisma.xeroInvoice.aggregate.mock.calls[0][0].where).toEqual({ AND: [{ type: 'ACCPAY' }, { status: 'AUTHORISED' }] });
  });

  it('caps limit at 200', async () => {
    const { svc, prisma } = setup();
    await svc.listInvoices({ type: 'ACCPAY', limit: 5000 } as never);
    expect(prisma.xeroInvoice.findMany.mock.calls[0][0].take).toBe(200);
  });
});

describe('FinanceReportsService.listContacts', () => {
  it('joins rollups, hides archived by default, sorts by owed desc and pages', async () => {
    const { svc, prisma } = setup();
    prisma.xeroContact.findMany.mockResolvedValueOnce([
      { contactId: 'c1', name: 'A', email: null, firstName: null, lastName: null, isCustomer: true, isSupplier: false, status: 'ACTIVE', defaultCurrency: 'USD' },
      { contactId: 'c2', name: 'B', email: null, firstName: 'Bo', lastName: 'Li', isCustomer: true, isSupplier: true, status: 'ACTIVE', defaultCurrency: 'USD' },
    ]);
    prisma.xeroInvoice.groupBy
      .mockResolvedValueOnce([{ contactId: 'c1', _sum: { amountDueBase: 100 } }, { contactId: 'c2', _sum: { amountDueBase: 900 } }]) // owed
      .mockResolvedValueOnce([{ contactId: 'c2', _sum: { amountDueBase: 300 } }]) // overdue
      .mockResolvedValueOnce([{ contactId: 'c2', _sum: { amountDueBase: 50 } }]) // owing
      .mockResolvedValueOnce([{ contactId: 'c1', _max: { date: d('2026-09-01') } }]); // last invoice/bill
    const res = await svc.listContacts({ limit: 1, offset: 0 });
    expect(prisma.xeroContact.findMany.mock.calls[0][0].where.AND).toContainEqual({ status: { not: 'ARCHIVED' } });
    expect(res.total).toBe(2);
    expect(res.items).toEqual([expect.objectContaining({ id: 'c2', owed: 900, overdue: 300, owing: 50, person: 'Bo Li' })]);
  });
});

describe('FinanceReportsService.listContacts sorting', () => {
  const contact = (contactId: string, name: string) => ({
    contactId, name, email: null, firstName: null, lastName: null, isCustomer: true, isSupplier: false, status: 'ACTIVE', defaultCurrency: 'USD',
  });

  // Alpha and Bravo tie on owed (100); Charlie owes more (500). Argument-aware groupBy,
  // keyed on the actual `where`, so the rollups can't be fed to the wrong column.
  function sorted(q: { sort?: 'name' | 'owed'; dir?: 'asc' | 'desc' }) {
    const { svc, prisma } = setup();
    prisma.xeroContact.findMany.mockResolvedValueOnce([contact('c2', 'Bravo'), contact('c3', 'Charlie'), contact('c1', 'Alpha')]);
    prisma.xeroInvoice.groupBy.mockImplementation(async ({ where }: { where: { type?: string; dueDate?: unknown } }) => {
      if (where.type === 'ACCREC' && !where.dueDate) {
        return [{ contactId: 'c1', _sum: { amountDueBase: 100 } }, { contactId: 'c2', _sum: { amountDueBase: 100 } }, { contactId: 'c3', _sum: { amountDueBase: 500 } }];
      }
      return [];
    });
    return svc.listContacts(q).then((r) => r.items.map((i) => i.name));
  }

  it('ties follow dir: desc breaks a tie Z→A, asc breaks it A→Z', async () => {
    expect(await sorted({ sort: 'owed', dir: 'desc' })).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect(await sorted({ sort: 'owed', dir: 'asc' })).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sort=name honours the default dir (desc) like every other key, and an explicit asc', async () => {
    expect(await sorted({ sort: 'name' })).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect(await sorted({ sort: 'name', dir: 'asc' })).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('the default sort is owed desc', async () => {
    expect(await sorted({})).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });
});

describe('FinanceReportsService.contactDetail', () => {
  it('kpis.spend counts bills plus plain SPEND only, excluding prepayments/overpayments already reflected in the bill total', async () => {
    const { svc, prisma } = setup();
    prisma.xeroContact.findUnique.mockResolvedValueOnce({
      contactId: 'c1', name: 'AWS', email: null, firstName: null, lastName: null, isCustomer: false, isSupplier: true,
      status: 'ACTIVE', defaultCurrency: 'USD', taxNumber: null, phones: [], addresses: [],
    });
    // Argument-aware, keyed on `type` + whether `dueDate` is present: billed/owed share
    // one ACCREC-no-dueDate bucket (they differ only by status, which this mock doesn't
    // key on — the two queries pick different `_sum` fields off the same object, so one
    // shared object serves both), overdue gets its own ACCREC+dueDate bucket, and
    // owing/spendBills share an ACCPAY-no-dueDate bucket. Distinct amountDueBase/totalBase
    // per bucket means swapping any of these type literals changes an asserted kpi.
    // spendBills: one PAID ACCPAY bill of 1000 (a prepayment allocated to it marks it PAID
    // without a Payment row — see the comment on the service's spendBank query).
    prisma.xeroInvoice.aggregate.mockImplementation(async ({ where }: { where: { type: string; dueDate?: unknown } }) => {
      if (where.type === 'ACCREC' && where.dueDate) return { _sum: { totalBase: 0, amountDueBase: 250 } }; // overdue
      if (where.type === 'ACCREC') return { _sum: { totalBase: 1500, amountDueBase: 300 } }; // billed / owed
      if (where.type === 'ACCPAY') return { _sum: { totalBase: 1000, amountDueBase: 150 } }; // owing / spendBills
      return { _sum: {} };
    });
    // Bank rows on this contact: a SPEND-PREPAYMENT of 1000 (the allocation for the bill
    // above — must NOT be counted again) and a plain SPEND of 200 (must be counted).
    const bankRows = [
      { type: 'SPEND', totalBase: 200 },
      { type: 'SPEND-PREPAYMENT', totalBase: 1000 },
    ];
    prisma.xeroBankTransaction.aggregate.mockImplementationOnce(async (args: { where: { type: unknown } }) => {
      const t = args.where.type;
      const matches = typeof t === 'string' ? bankRows.filter((r) => r.type === t) : bankRows.filter((r) => (t as { in: string[] })?.in?.includes(r.type));
      return { _sum: { totalBase: matches.reduce((sum, r) => sum + r.totalBase, 0) } };
    });

    const res = await svc.contactDetail('c1');

    expect(res.kpis.billed).toBe(1500);
    expect(res.kpis.owed).toBe(300);
    expect(res.kpis.overdue).toBe(250);
    expect(res.owing).toBe(150);
    expect(res.kpis.spend).toBe(1200);
    const spendBankWhere = prisma.xeroBankTransaction.aggregate.mock.calls[0][0].where;
    expect(spendBankWhere.type).toBe('SPEND');
  });
});

describe('FinanceReportsService.invoiceDetail', () => {
  it('404s an unknown invoice', async () => {
    const { svc } = setup();
    await expect(svc.invoiceDetail('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('includes payments, attachments and a shortcode deep link (bill path for ACCPAY)', async () => {
    const { svc, prisma } = setup();
    prisma.xeroInvoice.findUnique.mockResolvedValueOnce({
      invoiceId: 'b1', type: 'ACCPAY', number: 'AWS-1', status: 'PAID', date: d('2026-08-01'), dueDate: d('2026-08-15'),
      currencyCode: 'USD', currencyRate: 1, total: 100, amountDue: 0, amountPaid: 100, amountCredited: 0, subTotal: 100,
      totalTax: 0, totalBase: 100, amountDueBase: 0, lineItems: [], hasAttachments: true, updatedDateUtc: new Date(), contactId: 'c9', contactName: 'AWS', reference: null,
    });
    prisma.xeroPayment.findMany.mockResolvedValueOnce([{ paymentId: 'p1', paymentType: 'ACCPAYPAYMENT', cashDirection: 'out', status: 'AUTHORISED', invoiceId: 'b1', amount: 100, amountBase: 100, date: d('2026-08-10') }]);
    prisma.xeroAttachment.findMany.mockResolvedValueOnce([{ attachmentId: 'a1', parentId: 'inv-1', fileName: 'inv.pdf', mimeType: 'application/pdf', contentLength: 900 }]);
    const res = await svc.invoiceDetail('b1');
    expect(res.payments).toHaveLength(1);
    // toStrictEqual, not toEqual: toEqual ignores undefined keys, so it passed even when parentId was
    // missing. The in-app viewer builds the file URL from parentId; without it every Open is broken.
    expect(res.attachments).toStrictEqual([{ id: 'a1', parentId: 'inv-1', fileName: 'inv.pdf', mimeType: 'application/pdf', contentLength: 900 }]);
    expect(decodeURIComponent(res.xeroUrl)).toContain('/AccountsPayable/View.aspx?InvoiceID=b1');
  });
});
