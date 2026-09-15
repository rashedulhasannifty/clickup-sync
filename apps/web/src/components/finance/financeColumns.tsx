import type { Column } from '../ui/DataTable';
import { Pill } from '../ui/Pill';
import type { BankTxListItem, ContactListItem, CreditNoteListItem, InvoiceListItem, PaymentListItem } from '../../api/finance';
import { Amount, baseMoney, ContactAvatar, day, InvoiceStatus } from './format';

const faint = <span style={{ color: 'var(--text-faint)' }}>—</span>;
const mono = (s: string | null) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{s ?? '—'}</span>;
const who = (name: string | null) =>
  name ? <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}><ContactAvatar name={name} size={22} />{name}</span> : faint;

export function contactColumns(base: string | null): Column<ContactListItem>[] {
  return [
    { key: 'name', header: 'Contact', sortable: true, render: (c) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
        <ContactAvatar name={c.name} />
        <span><b style={{ fontWeight: 600 }}>{c.name}</b><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.person ?? c.email ?? ''}</div></span>
      </span>
    ) },
    { key: 'type', header: 'Type', render: (c) => (
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {c.isCustomer && <Pill tone="purple" size="xs">Customer</Pill>}
        {c.isSupplier && <Pill tone="blue" size="xs">Supplier</Pill>}
        {c.archived && <Pill tone="gray" size="xs">Archived</Pill>}
      </span>
    ) },
    { key: 'email', header: 'Email', render: (c) => (c.email ? <span style={{ color: 'var(--text-muted)' }}>{c.email}</span> : faint) },
    { key: 'owed', header: 'Owed to you', align: 'right', sortable: true, render: (c) => (c.owed ? baseMoney(c.owed, base) : faint) },
    { key: 'overdue', header: 'Overdue', align: 'right', sortable: true, render: (c) => (c.overdue ? <b style={{ color: 'var(--red)' }}>{baseMoney(c.overdue, base)}</b> : faint) },
    { key: 'owing', header: 'You owe', align: 'right', sortable: true, render: (c) => (c.owing ? baseMoney(c.owing, base) : faint) },
    { key: 'lastActivity', header: 'Last activity', sortable: true, render: (c) => <span style={{ color: 'var(--text-muted)' }}>{day(c.lastActivity)}</span> },
  ];
}

export function invoiceColumns(base: string | null, noun: 'Invoice' | 'Bill'): Column<InvoiceListItem>[] {
  return [
    { key: 'number', header: noun, sortable: true, render: (i) => (
      <span><span style={i.status === 'VOIDED' ? { textDecoration: 'line-through', color: 'var(--text-faint)' } : undefined}>{mono(i.number)}</span>
        {i.reference && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{i.reference}</div>}</span>
    ) },
    { key: 'contactName', header: 'Contact', sortable: true, render: (i) => who(i.contactName) },
    { key: 'date', header: 'Date', sortable: true, render: (i) => day(i.date) },
    { key: 'dueDate', header: 'Due', sortable: true, render: (i) => <span style={i.overdue ? { color: 'var(--red)' } : undefined}>{day(i.dueDate)}</span> },
    { key: 'status', header: 'Status', render: (i) => <InvoiceStatus i={i} /> },
    { key: 'total', header: 'Total', align: 'right', sortable: true, render: (i) => <Amount value={i.total} currency={i.currencyCode} base={base} /> },
    { key: 'amountDue', header: 'Amount due', align: 'right', sortable: true, render: (i) => (i.amountDue ? <Amount value={i.amountDue} currency={i.currencyCode} base={base} /> : faint) },
  ];
}

export function bankColumns(base: string | null): Column<BankTxListItem>[] {
  return [
    { key: 'date', header: 'Date', sortable: true, render: (t) => day(t.date) },
    { key: 'contactName', header: 'Payee', sortable: true, render: (t) => who(t.contactName) },
    { key: 'description', header: 'Description', render: (t) => (
      <span>{t.description ?? t.reference ?? '—'}{t.accountCode && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{t.accountCode}</div>}</span>
    ) },
    { key: 'type', header: 'Type', render: (t) =>
      t.direction === 'transfer' ? <Pill tone="gray" size="xs">Transfer</Pill>
        : t.direction === 'out' ? <Pill tone="purple" size="xs">Spend money</Pill> : <Pill tone="green" size="xs">Receive money</Pill> },
    { key: 'rec', header: 'Bank rec', render: (t) => (t.isReconciled ? <Pill tone="gray" size="xs">Reconciled</Pill> : <Pill tone="amber" size="xs">Unreconciled</Pill>) },
    { key: 'total', header: 'Amount', align: 'right', sortable: true, render: (t) => (
      <span style={{ color: t.direction === 'in' ? 'var(--green)' : undefined, fontWeight: 500 }}>
        {t.direction === 'out' ? '−' : t.direction === 'in' ? '+' : ''}<Amount value={t.total} currency={t.currencyCode} base={base} />
      </span>
    ) },
  ];
}

export function creditColumns(base: string | null): Column<CreditNoteListItem>[] {
  return [
    { key: 'number', header: 'Credit note', sortable: true, render: (n) => mono(n.number) },
    { key: 'contact', header: 'Contact', render: (n) => who(n.contactName) },
    { key: 'date', header: 'Date', sortable: true, render: (n) => day(n.date) },
    { key: 'type', header: 'Type', render: (n) => (n.type === 'ACCRECCREDIT' ? <Pill tone="purple" size="xs">Customer credit</Pill> : <Pill tone="blue" size="xs">Supplier credit</Pill>) },
    { key: 'total', header: 'Total', align: 'right', sortable: true, render: (n) => <Amount value={n.total} currency={n.currencyCode} base={base} /> },
    { key: 'remaining', header: 'Unallocated', align: 'right', render: (n) => (n.remainingCredit ? <Amount value={n.remainingCredit} currency={n.currencyCode} base={base} /> : <Pill tone="green" size="xs">Fully applied</Pill>) },
  ];
}

export function paymentColumns(base: string | null): Column<PaymentListItem>[] {
  return [
    { key: 'date', header: 'Date', sortable: true, render: (p) => day(p.date) },
    { key: 'contact', header: 'Contact', render: (p) => who(p.contactName) },
    { key: 'doc', header: 'Applied to', render: (p) => mono(p.invoiceNumber ?? p.creditNoteNumber) },
    { key: 'direction', header: 'Direction', render: (p) =>
      p.direction === 'in' ? <Pill tone="green" size="xs">Received</Pill> : p.direction === 'out' ? <Pill tone="purple" size="xs">Paid out</Pill> : <Pill tone="gray" size="xs">Allocation</Pill> },
    { key: 'account', header: 'Bank account', render: (p) => <span style={{ color: 'var(--text-muted)' }}>{p.bankAccountName ?? '—'}</span> },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (p) => <Amount value={p.amount} currency={p.currencyCode} base={base} /> },
  ];
}
