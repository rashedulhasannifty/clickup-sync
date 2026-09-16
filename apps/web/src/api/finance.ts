import { apiClient } from './client';

export type XeroConnStatus = 'CONNECTED' | 'NEEDS_RECONNECT' | 'DISCONNECTED';

export type XeroEntityState = {
  entity: string; status: string; recordsUpserted: number; lastRunAt: string | null;
  lastSuccessAt: string | null; watermark: string | null; lastError: string | null;
};

export type XeroStatus = {
  configured: boolean; encryptionEnabled: boolean; redirectUri: string; scopes: string[]; status: XeroConnStatus;
  tenantName: string | null; tenantId: string | null; baseCurrency: string | null; connectedAt: string | null;
  connectedByEmail: string | null; refreshedAt: string | null; lastError: string | null; dayCallsRemaining: number | null;
  syncing: boolean; entities: XeroEntityState[];
};

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export type FinanceSummary = {
  baseCurrency: string | null;
  owedToYou: { amount: number; count: number };
  overdue: { amount: number; count: number; oldestDays: number | null };
  youOwe: { amount: number; count: number; nextDueDate: string | null };
  moneyInMonth: number;
  moneyOutMonth: number;
  aging: { bucket: AgingBucket; amount: number }[];
  topOverdue: { contactId: string; contactName: string; amount: number; invoices: number; oldestDays: number }[];
  series: { month: string; in: number; out: number }[];
};

export type Page<T, Totals = undefined> = { items: T[]; total: number; totals?: Totals };

export type ContactListItem = {
  id: string; name: string; email: string | null; person: string | null; isCustomer: boolean; isSupplier: boolean;
  archived: boolean; defaultCurrency: string | null; owed: number; overdue: number; owing: number; lastActivity: string | null;
};

export type ContactDetail = ContactListItem & {
  firstName: string | null; lastName: string | null; taxNumber: string | null;
  phones: { PhoneType?: string; PhoneNumber?: string; PhoneAreaCode?: string; PhoneCountryCode?: string }[];
  addresses: { AddressType?: string; AddressLine1?: string; City?: string; Region?: string; PostalCode?: string; Country?: string }[];
  kpis: { billed: number; owed: number; overdue: number; spend: number };
  counts: { invoices: number; bills: number; bank: number; creditNotes: number; payments: number };
  xeroUrl: string;
};

export type ActivityItem = {
  kind: 'invoice' | 'bill' | 'payment' | 'bank' | 'creditNote'; id: string; date: string | null; title: string;
  amount: number; currencyCode: string | null; status: string;
};

export type LineItem = {
  description: string | null; quantity: number | null; unitAmount: number | null; accountCode: string | null;
  taxType: string | null; taxAmount: number | null; lineAmount: number | null;
};
export type AttachmentItem = { id: string; fileName: string; mimeType: string | null; contentLength: number | null };

export type InvoiceListItem = {
  id: string; type: 'ACCREC' | 'ACCPAY'; number: string | null; reference: string | null; contactId: string | null;
  contactName: string | null; status: string; overdue: boolean; overdueDays: number; partPaid: boolean;
  date: string | null; dueDate: string | null; currencyCode: string; total: number; amountDue: number; amountPaid: number;
  totalBase: number; amountDueBase: number; hasAttachments: boolean;
};

export type PaymentListItem = {
  id: string; paymentType: string; direction: 'in' | 'out' | null; status: string; invoiceId: string | null;
  invoiceNumber: string | null; creditNoteId: string | null; creditNoteNumber: string | null; contactId: string | null;
  contactName: string | null; date: string | null; currencyCode: string | null; amount: number; amountBase: number;
  bankAccountName: string | null; reference: string | null;
};

export type InvoiceDetail = InvoiceListItem & {
  currencyRate: number; subTotal: number; totalTax: number; amountCredited: number; lineItems: LineItem[];
  payments: PaymentListItem[]; attachments: AttachmentItem[]; updatedDateUtc: string | null; xeroUrl: string;
};

export type BankTxListItem = {
  id: string; type: string; direction: 'in' | 'out' | 'transfer'; contactId: string | null; contactName: string | null;
  reference: string | null; description: string | null; accountCode: string | null; bankAccountName: string | null;
  status: string; isReconciled: boolean; date: string | null; currencyCode: string; total: number; totalBase: number;
  hasAttachments: boolean;
};
export type BankTxDetail = BankTxListItem & { lineItems: LineItem[]; attachments: AttachmentItem[]; xeroUrl: string };

export type CreditNoteListItem = {
  id: string; type: 'ACCRECCREDIT' | 'ACCPAYCREDIT' | string; number: string | null; reference: string | null;
  contactId: string | null; contactName: string | null; status: string; date: string | null; currencyCode: string;
  total: number; remainingCredit: number; totalBase: number;
};
export type CreditNoteDetail = CreditNoteListItem & {
  lineItems: LineItem[]; payments: PaymentListItem[]; attachments: AttachmentItem[]; xeroUrl: string;
};

type Paging = { limit?: number; offset?: number; q?: string; dir?: 'asc' | 'desc'; sort?: string };
type Range = Paging & { from?: string; to?: string; contactId?: string };
export type ContactListParams = Paging & { role?: 'customer' | 'supplier'; archived?: boolean };
export type InvoiceListParams = Range & { type: 'ACCREC' | 'ACCPAY'; status?: string; currency?: string };
export type BankTxListParams = Range & { type?: 'SPEND' | 'RECEIVE'; reconciled?: boolean };
export type CreditNoteListParams = Range;
export type PaymentListParams = Range & { direction?: 'in' | 'out' };

const get = <T,>(url: string, params?: object): Promise<T> => apiClient.get(url, { params }).then((r) => r.data);

export const xeroApi = {
  status: () => get<XeroStatus>('/xero/status'),
  connect: (): Promise<{ url: string }> => apiClient.post('/xero/connect').then((r) => r.data),
  disconnect: (): Promise<{ disconnected: true }> => apiClient.delete('/xero/connection').then((r) => r.data),
  eraseData: (): Promise<{ erased: true }> => apiClient.delete('/xero/data').then((r) => r.data),
  sync: (full?: boolean): Promise<{ queued: true }> =>
    apiClient.post(`/xero/sync${full ? '?full=true' : ''}`).then((r) => r.data),
};

export const financeApi = {
  summary: () => get<FinanceSummary>('/finance/summary'),
  contacts: (p: ContactListParams) => get<Page<ContactListItem>>('/finance/contacts', p),
  contact: (id: string) => get<ContactDetail>(`/finance/contacts/${id}`),
  contactActivity: (id: string) => get<{ items: ActivityItem[] }>(`/finance/contacts/${id}/activity`),
  invoices: (p: InvoiceListParams) => get<Page<InvoiceListItem, { totalBase: number; amountDueBase: number }>>('/finance/invoices', p),
  invoice: (id: string) => get<InvoiceDetail>(`/finance/invoices/${id}`),
  bankTransactions: (p: BankTxListParams) => get<Page<BankTxListItem, { spentBase: number; receivedBase: number }>>('/finance/bank-transactions', p),
  bankTransaction: (id: string) => get<BankTxDetail>(`/finance/bank-transactions/${id}`),
  creditNotes: (p: CreditNoteListParams) => get<Page<CreditNoteListItem, { totalBase: number }>>('/finance/credit-notes', p),
  creditNote: (id: string) => get<CreditNoteDetail>(`/finance/credit-notes/${id}`),
  payments: (p: PaymentListParams) => get<Page<PaymentListItem, { inBase: number; outBase: number }>>('/finance/payments', p),
};
