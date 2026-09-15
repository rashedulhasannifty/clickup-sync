import { useMemo, useState } from 'react';
import { Download, Landmark, Lock, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Callout } from '../components/ui/Callout';
import { Pill } from '../components/ui/Pill';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { DataTable } from '../components/ui/DataTable';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../hooks/useAuth';
import {
  useFinanceBankTx, useFinanceContacts, useFinanceCreditNotes, useFinanceInvoices, useFinancePayments, useFinanceSummary,
  useXeroStatus, useXeroSyncNow,
} from '../hooks/useFinance';
import {
  financeApi, type BankTxListItem, type ContactListItem, type CreditNoteListItem, type InvoiceListItem, type PaymentListItem,
} from '../api/finance';
import { exportXlsx, type XlsxColumn } from '../lib/xlsx';
import { fmt } from '../lib/formatters';
import { AgedReceivables, FinanceKpis, MoneyFlowChart, type KpiTarget } from '../components/finance/FinanceInsights';
import { bankColumns, contactColumns, creditColumns, invoiceColumns, paymentColumns } from '../components/finance/financeColumns';
import { RecordDrawer, type RecordRef } from '../components/finance/RecordDrawer';
import { baseMoney, STATUS_OPTIONS } from '../components/finance/format';

type Tab = 'contacts' | 'invoices' | 'bills' | 'bank' | 'credits' | 'payments';
type Filters = { q: string; role: '' | 'customer' | 'supplier'; archived: boolean; status: string; from: string; currency: string; bankType: '' | 'SPEND' | 'RECEIVE'; reconciled: '' | 'true' | 'false'; direction: '' | 'in' | 'out' };
const EMPTY: Filters = { q: '', role: '', archived: false, status: '', from: '', currency: '', bankType: '', reconciled: '', direction: '' };
const DEFAULT_SORT: Record<Tab, { key: string; dir: 'asc' | 'desc' }> = {
  contacts: { key: 'owed', dir: 'desc' }, invoices: { key: 'date', dir: 'desc' }, bills: { key: 'date', dir: 'desc' },
  bank: { key: 'date', dir: 'desc' }, credits: { key: 'date', dir: 'desc' }, payments: { key: 'date', dir: 'desc' },
};

/** Axios-style error → response.data.message, without `any` (same pattern as XeroSettingsTab). */
function apiErrorMessage(e: unknown): string | undefined {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
}

/** The first day of the current month in Asia/Dhaka (the backend's "this month" for the KPIs), as YYYY-MM-01. */
function dhakaMonthStart(now: Date): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return `${ymd.slice(0, 7)}-01`;
}

function rangeFrom(v: string): string | undefined {
  if (!v) return undefined;
  const now = new Date();
  if (v === 'month') return dhakaMonthStart(now);
  if (v === 'ytd') return `${now.getFullYear()}-01-01`;
  return new Date(now.getTime() - Number(v) * 86_400_000).toISOString().slice(0, 10);
}

const selectStyle = { height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', padding: '0 8px', fontSize: 13 } as const;

/** Pages through a list endpoint (200 rows/page, capped at 5,000) so an export matches what's on screen. */
async function pageAll<T>(fetchPage: (p: { limit: number; offset: number }) => Promise<{ items: T[] }>): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const res = await fetchPage({ limit: 200, offset });
    all.push(...res.items);
    if (res.items.length < 200) break;
  }
  return all;
}

export function FinancePage() {
  const { hasRole } = useAuth();
  const toast = useToast();
  const status = useXeroStatus();
  const syncNow = useXeroSyncNow();
  const connected = status.data?.status === 'CONNECTED' || status.data?.status === 'NEEDS_RECONNECT';
  const hasData = connected || (status.data?.entities.some((e) => e.lastSuccessAt) ?? false);
  const summary = useFinanceSummary(hasData);
  const base = summary.data?.baseCurrency ?? status.data?.baseCurrency ?? 'USD';

  const [tab, setTab] = useState<Tab>('contacts');
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState(DEFAULT_SORT.contacts);
  const [stack, setStack] = useState<RecordRef[]>([]);
  const set = (patch: Partial<Filters>) => { setF((x) => ({ ...x, ...patch })); setPage(1); };
  const switchTab = (t: Tab, patch: Partial<Filters> = {}) => { setTab(t); setF({ ...EMPTY, ...patch }); setPage(1); setSort(DEFAULT_SORT[t]); };

  const paging = { limit: pageSize, offset: (page - 1) * pageSize, q: f.q || undefined, sort: sort.key, dir: sort.dir };
  const range = { ...paging, from: rangeFrom(f.from) };
  const contactsP = { ...paging, role: f.role || undefined, archived: f.archived || undefined };
  const invP = { ...range, type: 'ACCREC' as const, status: f.status || undefined, currency: f.currency || undefined };
  const billP = { ...range, type: 'ACCPAY' as const, status: f.status || undefined };
  const bankP = { ...range, type: f.bankType || undefined, reconciled: f.reconciled === '' ? undefined : f.reconciled === 'true' };
  const payP = { ...range, direction: f.direction || undefined };

  const contacts = useFinanceContacts(contactsP, hasData && tab === 'contacts');
  const invoices = useFinanceInvoices(invP, hasData && tab === 'invoices');
  const bills = useFinanceInvoices(billP, hasData && tab === 'bills');
  const bank = useFinanceBankTx(bankP, hasData && tab === 'bank');
  const credits = useFinanceCreditNotes(range, hasData && tab === 'credits');
  const payments = useFinancePayments(payP, hasData && tab === 'payments');
  const active = { contacts, invoices, bills, bank, credits, payments }[tab];

  // Each tile opens a tab whose filter matches the tile's own figure: owed/owe are
  // everything unpaid (overdue included); money in/out are this Dhaka month's payments.
  const openKpi = (t: KpiTarget) => {
    if (t === 'recv') switchTab('invoices', { status: 'unpaid' });
    if (t === 'overdue') switchTab('invoices', { status: 'overdue' });
    if (t === 'pay') switchTab('bills', { status: 'unpaid' });
    if (t === 'in') switchTab('payments', { direction: 'in', from: 'month' });
    if (t === 'out') switchTab('payments', { direction: 'out', from: 'month' });
    document.getElementById('finance-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const table = useMemo(() => {
    const open = (r: RecordRef) => setStack([r]);
    switch (tab) {
      case 'contacts': return <DataTable layout="design" columns={contactColumns(base)} data={contacts.data?.items ?? []} total={contacts.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={contacts.isFetching && !contacts.data} onRowClick={(r) => open({ kind: 'contact', id: r.id })} emptyTitle="No contacts match" />;
      case 'invoices': return <DataTable layout="design" columns={invoiceColumns(base, 'Invoice')} data={invoices.data?.items ?? []} total={invoices.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={invoices.isFetching && !invoices.data} onRowClick={(r) => open({ kind: 'invoice', id: r.id })} emptyTitle="No invoices match" />;
      case 'bills': return <DataTable layout="design" columns={invoiceColumns(base, 'Bill')} data={bills.data?.items ?? []} total={bills.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={bills.isFetching && !bills.data} onRowClick={(r) => open({ kind: 'invoice', id: r.id })} emptyTitle="No bills match" />;
      case 'bank': return <DataTable layout="design" columns={bankColumns(base)} data={bank.data?.items ?? []} total={bank.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={bank.isFetching && !bank.data} onRowClick={(r) => open({ kind: 'bank', id: r.id })} emptyTitle="No bank transactions match" />;
      case 'credits': return <DataTable layout="design" columns={creditColumns(base)} data={credits.data?.items ?? []} total={credits.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={credits.isFetching && !credits.data} onRowClick={(r) => open({ kind: 'creditNote', id: r.id })} emptyTitle="No credit notes match" />;
      case 'payments': return <DataTable layout="design" columns={paymentColumns(base)} data={payments.data?.items ?? []} total={payments.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={payments.isFetching && !payments.data} onRowClick={(r) => open({ kind: 'payment', id: r.id, payment: r })} emptyTitle="No payments match" />;
    }
  }, [tab, base, page, pageSize, sort, contacts, invoices, bills, bank, credits, payments]);

  const totalsLine = (() => {
    if (tab === 'invoices' && invoices.data?.totals) return `Total ${baseMoney(invoices.data.totals.totalBase, base)} · due ${baseMoney(invoices.data.totals.amountDueBase, base)}`;
    if (tab === 'bills' && bills.data?.totals) return `Total ${baseMoney(bills.data.totals.totalBase, base)} · due ${baseMoney(bills.data.totals.amountDueBase, base)}`;
    if (tab === 'bank' && bank.data?.totals) return `Spent ${baseMoney(bank.data.totals.spentBase, base)} · received ${baseMoney(bank.data.totals.receivedBase, base)}`;
    if (tab === 'payments' && payments.data?.totals) return `In ${baseMoney(payments.data.totals.inBase, base)} · out ${baseMoney(payments.data.totals.outBase, base)}`;
    if (tab === 'credits' && credits.data?.totals) return `Total ${baseMoney(credits.data.totals.totalBase, base)}`;
    return null;
  })();

  // Exports page through the API with the same filters as the on-screen tab, so the
  // file matches what's visible. Each branch is separately typed (no `any`) because
  // each tab's row shape and export columns differ.
  async function exportTab() {
    try {
      let count = 0;
      switch (tab) {
        case 'contacts': {
          const rows = await pageAll<ContactListItem>((p) => financeApi.contacts({ ...contactsP, ...p }));
          const cols: XlsxColumn<ContactListItem>[] = [
            { header: 'Contact', value: 'name' }, { header: 'Email', value: 'email' },
            { header: 'Customer', value: (r) => (r.isCustomer ? 'Yes' : '') }, { header: 'Supplier', value: (r) => (r.isSupplier ? 'Yes' : '') },
            { header: `Owed to you (${base})`, value: 'owed', type: 'number' }, { header: `Overdue (${base})`, value: 'overdue', type: 'number' },
            { header: `You owe (${base})`, value: 'owing', type: 'number' }, { header: 'Last activity', value: 'lastActivity' },
          ];
          await exportXlsx({ filename: 'finance-contacts', sheetName: 'contacts', rows, columns: cols });
          count = rows.length;
          break;
        }
        case 'invoices':
        case 'bills': {
          const rows = await pageAll<InvoiceListItem>((p) => financeApi.invoices({ ...(tab === 'invoices' ? invP : billP), ...p }));
          const cols: XlsxColumn<InvoiceListItem>[] = [
            { header: tab === 'invoices' ? 'Invoice' : 'Bill', value: 'number' }, { header: 'Reference', value: 'reference' },
            { header: tab === 'invoices' ? 'Contact' : 'Supplier', value: 'contactName' }, { header: 'Date', value: 'date' }, { header: 'Due', value: 'dueDate' },
            { header: 'Status', value: (r) => (r.overdue ? 'OVERDUE' : r.status) }, { header: 'Currency', value: 'currencyCode' },
            { header: 'Total', value: 'total', type: 'number' }, { header: 'Amount due', value: 'amountDue', type: 'number' },
            { header: `Total (${base})`, value: 'totalBase', type: 'number' },
          ];
          await exportXlsx({ filename: `finance-${tab}`, sheetName: tab, rows, columns: cols });
          count = rows.length;
          break;
        }
        case 'bank': {
          const rows = await pageAll<BankTxListItem>((p) => financeApi.bankTransactions({ ...bankP, ...p }));
          const cols: XlsxColumn<BankTxListItem>[] = [
            { header: 'Date', value: 'date' }, { header: 'Type', value: 'type' }, { header: 'Payee', value: 'contactName' },
            { header: 'Description', value: 'description' }, { header: 'Account', value: 'accountCode' },
            { header: 'Reconciled', value: (r) => (r.isReconciled ? 'Yes' : 'No') }, { header: 'Currency', value: 'currencyCode' },
            { header: 'Amount', value: 'total', type: 'number' }, { header: `Amount (${base})`, value: 'totalBase', type: 'number' },
          ];
          await exportXlsx({ filename: 'finance-bank', sheetName: 'bank', rows, columns: cols });
          count = rows.length;
          break;
        }
        case 'credits': {
          const rows = await pageAll<CreditNoteListItem>((p) => financeApi.creditNotes({ ...range, ...p }));
          const cols: XlsxColumn<CreditNoteListItem>[] = [
            { header: 'Credit note', value: 'number' }, { header: 'Contact', value: 'contactName' }, { header: 'Date', value: 'date' },
            { header: 'Type', value: 'type' }, { header: 'Currency', value: 'currencyCode' }, { header: 'Total', value: 'total', type: 'number' },
            { header: 'Unallocated', value: 'remainingCredit', type: 'number' },
          ];
          await exportXlsx({ filename: 'finance-credits', sheetName: 'credits', rows, columns: cols });
          count = rows.length;
          break;
        }
        case 'payments': {
          const rows = await pageAll<PaymentListItem>((p) => financeApi.payments({ ...payP, ...p }));
          const cols: XlsxColumn<PaymentListItem>[] = [
            { header: 'Date', value: 'date' }, { header: 'Contact', value: 'contactName' },
            { header: 'Applied to', value: (r) => r.invoiceNumber ?? r.creditNoteNumber }, { header: 'Direction', value: 'direction' },
            { header: 'Bank account', value: 'bankAccountName' }, { header: 'Currency', value: 'currencyCode' },
            { header: 'Amount', value: 'amount', type: 'number' }, { header: `Amount (${base})`, value: 'amountBase', type: 'number' },
          ];
          await exportXlsx({ filename: 'finance-payments', sheetName: 'payments', rows, columns: cols });
          count = rows.length;
          break;
        }
      }
      toast.show(`Exported ${count} rows.`, 'green');
    } catch {
      toast.show("Export failed. Try again, or narrow the filters.", 'red');
    }
  }

  const s = status.data;
  const lastSync = s?.entities.map((e) => e.lastSuccessAt).filter(Boolean).sort().at(-1);
  const header = (
    <PageHeader
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>Finance <Pill tone="purple" size="xs">Beta</Pill></span>}
      badge={s?.tenantName ? <Pill tone="gray">{s.tenantName}</Pill> : undefined}
      description="Contacts, invoices, bills and bank transactions from Xero. Read-only: edit anything in Xero and it shows up here on the next sync."
      actions={connected ? (
        <>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {s?.syncing ? 'Syncing…' : s?.status === 'NEEDS_RECONNECT' ? 'Sync paused' : lastSync ? `Synced ${fmt.relative(lastSync)}` : 'Not synced yet'}
          </span>
          <Button icon={<RefreshCw size={14} />} loading={syncNow.isPending} disabled={s?.syncing || s?.status !== 'CONNECTED'}
            onClick={() => syncNow.mutate(undefined, { onSuccess: () => toast.show('Sync queued.', 'green'), onError: (e: unknown) => toast.show(apiErrorMessage(e) ?? "Couldn't start a sync.", 'red') })}>
            Sync now
          </Button>
          <Button icon={<Download size={14} />} onClick={exportTab}>Export</Button>
        </>
      ) : undefined}
    />
  );

  if (status.isLoading) return <div>{header}<TableSkeleton rows={8} /></div>;
  // A failed status fetch must not fall through to "Connect Xero" — that would
  // tell a connected org it's disconnected. Surface the real error instead.
  if (status.isError) return <div>{header}<QueryError query={status} what="Xero status" /></div>;
  if (!s?.configured || (!connected && !hasData)) {
    return (
      <div>{header}
        <Card>
          <EmptyState icon={<Landmark size={22} />} title="Connect Xero to see your finances here"
            body="Once connected, every Xero contact appears here with its invoices, bills, spend money, credit notes and payments."
            action={hasRole('OWNER')
              ? <Link to="/settings?tab=xero"><Button variant="accent">Go to Xero settings</Button></Link>
              : <Pill tone="gray" icon={<Lock size={12} />}>Only an Owner can connect Xero. Ask an Owner in your organisation.</Pill>} />
        </Card>
      </div>
    );
  }
  const firstSync = s.syncing && !s.entities.some((e) => e.lastSuccessAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {header}
      {s.status === 'NEEDS_RECONNECT' && (
        <Callout tone="red">
          <b>Xero is disconnected.</b> Figures below may be out of date. {hasRole('OWNER') ? <Link to="/settings?tab=xero">Reconnect in Settings</Link> : 'Ask an Owner to reconnect Xero.'}
        </Callout>
      )}
      {!s.syncing && !s.entities.some((e) => e.lastSuccessAt) && s.entities.some((e) => e.status === 'FAILED' || e.status === 'RATE_LIMITED') && (
        // A first sync that failed or hit the daily limit would otherwise show a page of unexplained zeros.
        <Callout tone="amber">
          <b>The first sync hasn't finished.</b> {s.entities.find((e) => e.lastError)?.lastError ?? 'It retries automatically.'}{' '}
          {hasRole('OWNER') && <Link to="/settings?tab=xero">See sync status</Link>}
        </Callout>
      )}
      {firstSync ? (
        <>
          <Callout tone="blue"><b>First sync in progress.</b> We're copying your Xero data. You can leave this page; it keeps running in the background.</Callout>
          <TableSkeleton rows={8} />
        </>
      ) : (
        <>
          <QueryError query={summary} what="finance summary" />
          <FinanceKpis s={summary.data} loading={summary.isLoading} onOpen={openKpi} />
          {summary.data && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
              <AgedReceivables s={summary.data} onOpenContact={(id) => setStack([{ kind: 'contact', id }])} onViewOverdue={() => openKpi('overdue')} />
              <MoneyFlowChart s={summary.data} />
            </div>
          )}
          <div id="finance-tabs">
            <Tabs variant="underline" ariaLabel="Finance records" value={tab} onChange={(v) => switchTab(v as Tab)}
              items={[
                { value: 'contacts', label: 'Contacts' }, { value: 'invoices', label: 'Invoices' }, { value: 'bills', label: 'Bills' },
                { value: 'bank', label: 'Bank transactions' }, { value: 'credits', label: 'Credit notes' }, { value: 'payments', label: 'Payments' },
              ]} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <label style={{ position: 'relative', flex: '1 1 240px', maxWidth: 340 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-faint)' }} />
              <input id="finance-search" className="input-3d" type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search…" aria-label="Search"
                style={{ ...selectStyle, width: '100%', paddingLeft: 30 }} />
            </label>
            {tab === 'contacts' && (
              <>
                <Tabs variant="segmented" value={f.role || 'all'} onChange={(v) => set({ role: v === 'all' ? '' : (v as Filters['role']) })}
                  items={[{ value: 'all', label: 'All' }, { value: 'customer', label: 'Customers' }, { value: 'supplier', label: 'Suppliers' }]} />
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input id="finance-archived" type="checkbox" checked={f.archived} onChange={(e) => set({ archived: e.target.checked })} /> Show archived
                </label>
              </>
            )}
            {(tab === 'invoices' || tab === 'bills') && (
              <select id="finance-status" aria-label="Status" style={selectStyle} value={f.status} onChange={(e) => set({ status: e.target.value })}>
                {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
            {tab === 'invoices' && (
              <select id="finance-currency" aria-label="Currency" style={selectStyle} value={f.currency} onChange={(e) => set({ currency: e.target.value })}>
                <option value="">All currencies</option>{['USD', 'AUD', 'GBP', 'EUR', 'NZD', 'BDT'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {tab === 'bank' && (
              <>
                <Tabs variant="segmented" value={f.bankType || 'all'} onChange={(v) => set({ bankType: v === 'all' ? '' : (v as Filters['bankType']) })}
                  items={[{ value: 'all', label: 'All' }, { value: 'SPEND', label: 'Spend money' }, { value: 'RECEIVE', label: 'Receive money' }]} />
                <select id="finance-reconciled" aria-label="Reconciliation" style={selectStyle} value={f.reconciled} onChange={(e) => set({ reconciled: e.target.value as Filters['reconciled'] })}>
                  <option value="">Any reconciliation</option><option value="true">Reconciled</option><option value="false">Unreconciled</option>
                </select>
              </>
            )}
            {tab === 'payments' && (
              <select id="finance-direction" aria-label="Direction" style={selectStyle} value={f.direction} onChange={(e) => set({ direction: e.target.value as Filters['direction'] })}>
                <option value="">In and out</option><option value="in">Received</option><option value="out">Paid out</option>
              </select>
            )}
            {tab !== 'contacts' && (
              <select id="finance-range" aria-label="Date range" style={selectStyle} value={f.from} onChange={(e) => set({ from: e.target.value })}>
                <option value="">Any date</option><option value="month">This month</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="ytd">This year</option>
              </select>
            )}
            <span style={{ flex: 1 }} />
            {totalsLine && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{totalsLine}</span>}
          </div>
          <QueryError query={active} what="finance records" />
          {table}
        </>
      )}
      <RecordDrawer base={base} stack={stack} onPush={(r) => setStack((x) => [...x, r])} onBack={() => setStack((x) => x.slice(0, -1))} onClose={() => setStack([])} />
    </div>
  );
}
