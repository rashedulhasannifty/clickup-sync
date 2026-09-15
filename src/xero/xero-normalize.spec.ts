import {
  cashDirection, normalizeAttachment, normalizeBankTransaction, normalizeContact, normalizeCreditNote,
  normalizeInvoice, normalizePayment, parseXeroDateOnly, parseXeroTimestamp, toBase,
} from './xero-normalize';

const UPDATED = '/Date(1757930400000+0000)/'; // 2025-09-15T10:00:00Z

describe('parseXeroTimestamp', () => {
  it('parses the legacy /Date(ms+zone)/ form', () => {
    expect(parseXeroTimestamp(UPDATED)?.toISOString()).toBe('2025-09-15T10:00:00.000Z');
  });
  it('treats a zone-less ISO string as UTC', () => {
    expect(parseXeroTimestamp('2026-09-15T08:30:00')?.toISOString()).toBe('2026-09-15T08:30:00.000Z');
  });
  it('returns null for empty or garbage input', () => {
    expect(parseXeroTimestamp(undefined)).toBeNull();
    expect(parseXeroTimestamp('nope')).toBeNull();
  });
});

describe('parseXeroDateOnly', () => {
  it('prefers DateString and never shifts the calendar day', () => {
    expect(parseXeroDateOnly('2026-09-01T00:00:00', '/Date(1756684800000+0000)/')?.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });
  it('falls back to the legacy timestamp, truncated to its UTC date', () => {
    expect(parseXeroDateOnly(undefined, '/Date(1757930400000+0000)/')?.toISOString()).toBe('2025-09-15T00:00:00.000Z');
  });
});

describe('toBase', () => {
  it('returns the amount for base-currency documents (rate 1 or missing)', () => {
    expect(toBase(1234.5, 1)).toBe(1234.5);
    expect(toBase(1234.5, undefined)).toBe(1234.5);
    expect(toBase(1234.5, 0)).toBe(1234.5);
  });
  it('divides by the rate (Xero rate = foreign units per 1 base unit)', () => {
    // 1 USD = 1.515 AUD, so AUD 1,000 = USD 660.07
    expect(toBase(1000, 1.515)).toBe(660.07);
  });
});

describe('cashDirection', () => {
  it.each([
    ['ACCRECPAYMENT', 'in'],
    ['APCREDITPAYMENT', 'in'],
    ['ACCPAYPAYMENT', 'out'],
    ['ARCREDITPAYMENT', 'out'],
    ['AROVERPAYMENTPAYMENT', null],
    ['APPREPAYMENTPAYMENT', null],
    [undefined, null],
  ])('%s → %s', (type, expected) => {
    expect(cashDirection(type as string | undefined)).toBe(expected);
  });
});

describe('normalizeContact', () => {
  it('maps roles, email, status and keeps raw', () => {
    const c = {
      ContactID: '11111111-1111-4111-8111-111111111111', Name: 'Harbourline Dental', EmailAddress: 'a@b.c',
      IsCustomer: true, IsSupplier: false, DefaultCurrency: 'AUD', UpdatedDateUTC: UPDATED,
    };
    const row = normalizeContact(c);
    expect(row).toMatchObject({
      contactId: c.ContactID, name: 'Harbourline Dental', email: 'a@b.c', isCustomer: true, isSupplier: false,
      defaultCurrency: 'AUD', status: 'ACTIVE',
    });
    expect(row.updatedDateUtc.toISOString()).toBe('2025-09-15T10:00:00.000Z');
    expect(row.raw).toEqual(c);
  });
});

describe('normalizeInvoice', () => {
  const inv = {
    InvoiceID: '22222222-2222-4222-8222-222222222222', Type: 'ACCREC', InvoiceNumber: 'INV-0142', Reference: 'PO 4471',
    Contact: { ContactID: '11111111-1111-4111-8111-111111111111', Name: 'Harbourline Dental' },
    Status: 'AUTHORISED', DateString: '2026-08-20T00:00:00', DueDateString: '2026-09-03T00:00:00',
    CurrencyCode: 'AUD', CurrencyRate: 1.515, SubTotal: 1000, TotalTax: 100, Total: 1100, AmountDue: 660,
    AmountPaid: 440, AmountCredited: 0, HasAttachments: true, UpdatedDateUTC: UPDATED,
    LineItems: [{ Description: 'SEO — monthly', Quantity: 1, UnitAmount: 1000, AccountCode: '200', TaxType: 'OUTPUT', TaxAmount: 100, LineAmount: 1000 }],
  };

  it('maps header, contact, dates, money and base amounts', () => {
    const row = normalizeInvoice(inv);
    expect(row).toMatchObject({
      invoiceId: inv.InvoiceID, type: 'ACCREC', number: 'INV-0142', reference: 'PO 4471',
      contactId: inv.Contact.ContactID, contactName: 'Harbourline Dental', status: 'AUTHORISED',
      currencyCode: 'AUD', currencyRate: 1.515, subTotal: 1000, totalTax: 100, total: 1100,
      amountDue: 660, amountPaid: 440, amountCredited: 0, totalBase: 726.07, amountDueBase: 435.64,
      hasAttachments: true,
    });
    expect(row.date?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(row.dueDate?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    expect(row.lineItems).toEqual([
      { description: 'SEO — monthly', quantity: 1, unitAmount: 1000, accountCode: '200', taxType: 'OUTPUT', taxAmount: 100, lineAmount: 1000, itemCode: null },
    ]);
  });

  it('defaults missing optional fields', () => {
    const row = normalizeInvoice({ InvoiceID: inv.InvoiceID, Type: 'ACCPAY', Status: 'DRAFT', UpdatedDateUTC: UPDATED });
    expect(row).toMatchObject({
      number: null, contactId: null, contactName: null, currencyCode: 'XXX', currencyRate: 1, total: 0,
      amountDueBase: 0, hasAttachments: false, lineItems: [],
    });
    expect(row.date).toBeNull();
  });
});

describe('normalizeCreditNote', () => {
  it('maps remaining credit and base total', () => {
    const row = normalizeCreditNote({
      CreditNoteID: '33333333-3333-4333-8333-333333333333', Type: 'ACCRECCREDIT', CreditNoteNumber: 'CN-0031',
      Status: 'AUTHORISED', CurrencyCode: 'USD', Total: 450, RemainingCredit: 450, UpdatedDateUTC: UPDATED,
    });
    expect(row).toMatchObject({ number: 'CN-0031', type: 'ACCRECCREDIT', total: 450, remainingCredit: 450, totalBase: 450 });
  });
});

describe('normalizeBankTransaction', () => {
  it('keeps the transfer variant type and bank account', () => {
    const row = normalizeBankTransaction({
      BankTransactionID: '44444444-4444-4444-8444-444444444444', Type: 'SPEND-TRANSFER', Status: 'AUTHORISED',
      BankAccount: { Code: '090', Name: 'Business Bank Account' }, CurrencyCode: 'USD', Total: 500,
      UpdatedDateUTC: UPDATED,
    });
    expect(row).toMatchObject({
      type: 'SPEND-TRANSFER', bankAccountCode: '090', bankAccountName: 'Business Bank Account', isReconciled: false,
      total: 500, totalBase: 500, contactId: null,
    });
  });
});

describe('normalizePayment', () => {
  it('links an invoice payment and derives cash direction and base amount', () => {
    const row = normalizePayment({
      PaymentID: '55555555-5555-4555-8555-555555555555', PaymentType: 'ACCRECPAYMENT', Status: 'AUTHORISED',
      Date: '/Date(1757894400000+0000)/', Amount: 1515, CurrencyRate: 1.515, Reference: 'Stripe payout',
      Account: { Code: '090', Name: 'Business Bank Account' },
      Invoice: { InvoiceID: '22222222-2222-4222-8222-222222222222', InvoiceNumber: 'INV-0142', CurrencyCode: 'AUD', Contact: { ContactID: '11111111-1111-4111-8111-111111111111', Name: 'Harbourline Dental' } },
      UpdatedDateUTC: UPDATED,
    });
    expect(row).toMatchObject({
      cashDirection: 'in', invoiceId: '22222222-2222-4222-8222-222222222222', invoiceNumber: 'INV-0142',
      creditNoteId: null, contactName: 'Harbourline Dental', currencyCode: 'AUD', amount: 1515, amountBase: 1000,
      bankAccountCode: '090',
    });
    expect(row.date?.toISOString()).toBe('2025-09-15T00:00:00.000Z');
  });

  it('links a credit-note refund', () => {
    const row = normalizePayment({
      PaymentID: '66666666-6666-4666-8666-666666666666', PaymentType: 'ARCREDITPAYMENT', Status: 'AUTHORISED',
      Amount: 100, CreditNote: { CreditNoteID: '33333333-3333-4333-8333-333333333333', CreditNoteNumber: 'CN-0031' },
      UpdatedDateUTC: UPDATED,
    });
    expect(row).toMatchObject({ cashDirection: 'out', invoiceId: null, creditNoteId: '33333333-3333-4333-8333-333333333333' });
  });
});

describe('normalizeAttachment', () => {
  it('maps file metadata onto its parent', () => {
    expect(
      normalizeAttachment('invoice', 'p1', { AttachmentID: 'a1', FileName: 'SOW.pdf', MimeType: 'application/pdf', ContentLength: 2048 }),
    ).toEqual({ attachmentId: 'a1', parentType: 'invoice', parentId: 'p1', fileName: 'SOW.pdf', mimeType: 'application/pdf', contentLength: 2048 });
  });
});
