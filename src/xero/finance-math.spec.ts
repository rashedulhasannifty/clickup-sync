import {
  addMonths, agingBucket, bucketAging, dayString, IN_BANK_TYPES, invoiceStatusWhere, monthStartDhaka, OUT_BANK_TYPES,
  STATUS_BUCKETS, todayDhaka, xeroDeepLink,
} from './finance-math';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('Dhaka calendar', () => {
  it('uses the Dhaka date, not the UTC date (UTC+6)', () => {
    expect(dayString(todayDhaka(new Date('2026-09-14T19:00:00Z')))).toBe('2026-09-15');
    expect(dayString(todayDhaka(new Date('2026-09-14T17:59:00Z')))).toBe('2026-09-14');
  });
  it('month start and month arithmetic', () => {
    expect(dayString(monthStartDhaka(new Date('2026-09-30T20:00:00Z')))).toBe('2026-10-01');
    expect(dayString(addMonths(d('2026-09-01'), -5))).toBe('2026-04-01');
  });
});

describe('aging', () => {
  it.each([
    [-3, 'current'], [0, 'current'], [1, '1-30'], [30, '1-30'], [31, '31-60'], [60, '31-60'], [61, '61-90'], [90, '61-90'], [91, '90+'],
  ])('%d days past due → %s', (days, bucket) => {
    expect(agingBucket(days as number)).toBe(bucket);
  });

  it('sums base amounts per bucket; a missing due date counts as current', () => {
    const today = d('2026-09-15');
    const res = bucketAging(
      [
        { dueDate: d('2026-09-20'), amountDueBase: 100 },
        { dueDate: null, amountDueBase: 5 },
        { dueDate: d('2026-09-01'), amountDueBase: 200 },
        { dueDate: d('2026-05-01'), amountDueBase: 300 },
      ],
      today,
    );
    expect(res).toEqual({ current: 105, '1-30': 200, '31-60': 0, '61-90': 0, '90+': 300 });
  });
});

/** Tiny evaluator for exactly the where-shapes invoiceStatusWhere emits. */
function matches(inv: { status: string; dueDate: Date | null }, w: Record<string, any>): boolean {
  if (w.OR && !w.OR.some((o: Record<string, any>) => matches(inv, o))) return false;
  if (typeof w.status === 'string' && inv.status !== w.status) return false;
  if (w.status?.not && inv.status === w.status.not) return false;
  if (w.dueDate === null && inv.dueDate !== null) return false;
  if (w.dueDate?.lt && !(inv.dueDate && inv.dueDate < w.dueDate.lt)) return false;
  if (w.dueDate?.gte && !(inv.dueDate && inv.dueDate >= w.dueDate.gte)) return false;
  return true;
}

describe('invoiceStatusWhere', () => {
  const today = d('2026-09-15');
  const invoices = ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED', 'DELETED'].flatMap((status) =>
    [d('2026-09-01'), d('2026-09-15'), d('2026-10-01'), null].map((dueDate) => ({ status, dueDate })),
  );

  it('the buckets are exclusive and exhaustive over non-deleted invoices', () => {
    for (const inv of invoices) {
      const hits = STATUS_BUCKETS.filter((b) => matches(inv, invoiceStatusWhere(b, today)));
      expect(hits).toHaveLength(inv.status === 'DELETED' ? 0 : 1);
    }
  });

  it('"overdue" is AUTHORISED with a due date before today; due today is not overdue', () => {
    const w = invoiceStatusWhere('overdue', today);
    expect(matches({ status: 'AUTHORISED', dueDate: d('2026-09-14') }, w)).toBe(true);
    expect(matches({ status: 'AUTHORISED', dueDate: today }, w)).toBe(false);
  });

  it('"unpaid" is exactly AUTHORISED ∪ overdue: a union filter, deliberately NOT one of the exclusive buckets', () => {
    const w = invoiceStatusWhere('unpaid', today);
    let hits = 0;
    for (const inv of invoices) {
      const union = matches(inv, invoiceStatusWhere('AUTHORISED', today)) || matches(inv, invoiceStatusWhere('overdue', today));
      expect(matches(inv, w)).toBe(union);
      if (union) hits += 1;
    }
    expect(hits).toBe(4); // every AUTHORISED fixture: overdue, due today, due later, no due date
    expect(STATUS_BUCKETS).not.toContain('unpaid');
  });

  it('no bucket = everything except DELETED', () => {
    const w = invoiceStatusWhere(undefined, today);
    expect(matches({ status: 'DELETED', dueDate: null }, w)).toBe(false);
    expect(matches({ status: 'PAID', dueDate: null }, w)).toBe(true);
  });
});

describe('bank cash types', () => {
  it('exclude transfers between own accounts', () => {
    expect([...IN_BANK_TYPES, ...OUT_BANK_TYPES].some((t) => t.includes('TRANSFER'))).toBe(false);
    expect(IN_BANK_TYPES).toContain('RECEIVE');
    expect(OUT_BANK_TYPES).toContain('SPEND');
  });
});

describe('xeroDeepLink', () => {
  it('routes through organisationlogin with the shortcode so the right org opens', () => {
    const url = new URL(xeroDeepLink('!abc12', 'invoice', 'inv-1'));
    expect(url.origin + url.pathname).toBe('https://go.xero.com/organisationlogin/default.aspx');
    expect(url.searchParams.get('shortcode')).toBe('!abc12');
    expect(url.searchParams.get('redirecturl')).toBe('/AccountsReceivable/View.aspx?InvoiceID=inv-1');
  });
  it('uses the payable path for bills and falls back without a shortcode', () => {
    expect(xeroDeepLink(null, 'bill', 'b-1')).toBe('https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=b-1');
    expect(xeroDeepLink(null, 'contact', 'c-1')).toBe('https://go.xero.com/Contacts/View/c-1');
  });
});
