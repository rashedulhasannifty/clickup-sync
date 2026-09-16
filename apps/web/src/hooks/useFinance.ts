import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  financeApi, xeroApi, type BankTxListParams, type ContactListParams, type CreditNoteListParams, type InvoiceListParams,
  type PaymentListParams,
} from '../api/finance';

export function useXeroStatus(enabled = true) {
  return useQuery({
    queryKey: ['xero', 'status'],
    queryFn: xeroApi.status,
    enabled,
    // Poll while a sync runs so the Settings progress rows and the "Synced N min ago" label stay live.
    refetchInterval: (q) => (q.state.data?.syncing ? 3000 : false),
  });
}

export function useConnectXero() {
  return useMutation({
    mutationFn: xeroApi.connect,
    // Full-page navigation to Xero's consent screen; Xero redirects back to /api/xero/callback.
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function useDisconnectXero() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: xeroApi.disconnect,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['xero'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

/** Disconnects AND deletes every synced row, so a different Xero organisation can be connected. */
export function useEraseXeroData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: xeroApi.eraseData,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['xero'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

export function useXeroSyncNow() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: xeroApi.sync, onSuccess: () => qc.invalidateQueries({ queryKey: ['xero', 'status'] }) });
}

export const useFinanceSummary = (enabled = true) =>
  useQuery({ queryKey: ['finance', 'summary'], queryFn: financeApi.summary, enabled });

export const useFinanceContacts = (p: ContactListParams, enabled = true) =>
  useQuery({ queryKey: ['finance', 'contacts', p], queryFn: () => financeApi.contacts(p), enabled, placeholderData: keepPreviousData });

export const useFinanceInvoices = (p: InvoiceListParams, enabled = true) =>
  useQuery({ queryKey: ['finance', 'invoices', p], queryFn: () => financeApi.invoices(p), enabled, placeholderData: keepPreviousData });

export const useFinanceBankTx = (p: BankTxListParams, enabled = true) =>
  useQuery({ queryKey: ['finance', 'bank', p], queryFn: () => financeApi.bankTransactions(p), enabled, placeholderData: keepPreviousData });

export const useFinanceCreditNotes = (p: CreditNoteListParams, enabled = true) =>
  useQuery({ queryKey: ['finance', 'credits', p], queryFn: () => financeApi.creditNotes(p), enabled, placeholderData: keepPreviousData });

export const useFinancePayments = (p: PaymentListParams, enabled = true) =>
  useQuery({ queryKey: ['finance', 'payments', p], queryFn: () => financeApi.payments(p), enabled, placeholderData: keepPreviousData });

export const useFinanceContact = (id: string | null) =>
  useQuery({ queryKey: ['finance', 'contact', id], queryFn: () => financeApi.contact(id!), enabled: !!id });

export const useContactActivity = (id: string | null, enabled = true) =>
  useQuery({ queryKey: ['finance', 'contact-activity', id], queryFn: () => financeApi.contactActivity(id!), enabled: !!id && enabled });

export const useFinanceInvoice = (id: string | null) =>
  useQuery({ queryKey: ['finance', 'invoice', id], queryFn: () => financeApi.invoice(id!), enabled: !!id });

export const useFinanceBankTxDetail = (id: string | null) =>
  useQuery({ queryKey: ['finance', 'bank-tx', id], queryFn: () => financeApi.bankTransaction(id!), enabled: !!id });

export const useFinanceCreditNote = (id: string | null) =>
  useQuery({ queryKey: ['finance', 'credit-note', id], queryFn: () => financeApi.creditNote(id!), enabled: !!id });
