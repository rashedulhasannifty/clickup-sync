import { useState, type ReactNode } from 'react';
import { ArrowLeft, ExternalLink, FileText, Paperclip } from 'lucide-react';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { Tabs } from '../ui/Tabs';
import {
  useContactActivity, useFinanceBankTx, useFinanceBankTxDetail, useFinanceContact, useFinanceCreditNote, useFinanceCreditNotes,
  useFinanceInvoice, useFinanceInvoices, useFinancePayments,
} from '../../hooks/useFinance';
import type { AttachmentItem, LineItem, PaymentListItem } from '../../api/finance';
import { Amount, baseMoney, ContactAvatar, day, InvoiceStatus, money } from './format';

export type RecordRef = { kind: 'contact' | 'invoice' | 'bank' | 'creditNote' | 'payment'; id: string; payment?: PaymentListItem };

const label = (t: string) => <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '18px 0 8px' }}>{t}</div>;
const Facts = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px 18px', padding: '14px 0', borderBlock: '1px solid var(--border-soft)', margin: '0 0 12px' }}>
    {rows.map(([k, v]) => (
      <div key={k} style={{ minWidth: 0 }}>
        <dt style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</dt>
        <dd style={{ margin: 0, fontSize: 13, overflowWrap: 'anywhere' }}>{v ?? '—'}</dd>
      </div>
    ))}
  </dl>
);
const Row = ({ onClick, top, right, sub }: { onClick: () => void; top: ReactNode; right: ReactNode; sub: ReactNode }) => (
  <button type="button" onClick={onClick} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '4px 12px', width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--border-soft)', padding: '10px 6px', cursor: 'pointer', color: 'var(--text)', borderRadius: 6 }}>
    <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, minWidth: 0 }}>{top}</span>
    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{right}</span>
    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</span>
  </button>
);

function LinesTable({ lines, currency }: { lines: LineItem[]; currency: string }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
        <thead><tr style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          <th style={{ textAlign: 'left', padding: 6 }}>Description</th><th style={{ textAlign: 'left', padding: 6 }}>Account</th>
          <th style={{ textAlign: 'left', padding: 6 }}>Tax</th><th style={{ textAlign: 'right', padding: 6 }}>Qty</th>
          <th style={{ textAlign: 'right', padding: 6 }}>Unit</th><th style={{ textAlign: 'right', padding: 6 }}>Amount</th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
              <td style={{ padding: 8 }}>{l.description ?? '—'}</td>
              <td style={{ padding: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{l.accountCode ?? '—'}</td>
              <td style={{ padding: 8, color: 'var(--text-muted)' }}>{l.taxType ?? '—'}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{l.quantity ?? '—'}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{l.unitAmount != null ? money(l.unitAmount, currency) : '—'}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{l.lineAmount != null ? money(l.lineAmount, currency) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Attachments({ items, xeroUrl }: { items: AttachmentItem[]; xeroUrl: string }) {
  if (!items.length) return <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No attachments.</p>;
  return (
    <>
      {items.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border-soft)', borderRadius: 8, fontSize: 13, marginBottom: 6 }}>
          <Paperclip size={14} /><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fileName}</span>
          {a.contentLength != null && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{Math.max(1, Math.round(a.contentLength / 1024))} KB</span>}
          <a href={xeroUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Open in Xero</a>
        </div>
      ))}
    </>
  );
}

function PaymentsList({ items, onPush }: { items: PaymentListItem[]; onPush: (r: RecordRef) => void }) {
  if (!items.length) return <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No payments recorded yet.</p>;
  return <>{items.map((p) => (
    <Row key={p.id} onClick={() => onPush({ kind: 'payment', id: p.id, payment: p })}
      top={`${p.direction === 'out' ? 'Paid' : 'Received'} · ${p.invoiceNumber ?? p.creditNoteNumber ?? ''}`}
      right={money(p.amount, p.currencyCode ?? 'USD')} sub={`${day(p.date)}${p.reference ? ` · ${p.reference}` : ''}`} />
  ))}</>;
}

type SubTab = 'invoices' | 'bills' | 'bank' | 'credits' | 'payments' | 'activity';

function ContactView({ id, onPush, base }: { id: string; onPush: (r: RecordRef) => void; base: string | null }) {
  const c = useFinanceContact(id);
  const [tab, setTab] = useState<SubTab>('invoices');
  const lp = { contactId: id, limit: 50 };
  const inv = useFinanceInvoices({ ...lp, type: 'ACCREC' }, tab === 'invoices');
  const bills = useFinanceInvoices({ ...lp, type: 'ACCPAY' }, tab === 'bills');
  const bank = useFinanceBankTx(lp, tab === 'bank');
  const credits = useFinanceCreditNotes(lp, tab === 'credits');
  const pays = useFinancePayments(lp, tab === 'payments');
  const act = useContactActivity(id, tab === 'activity');
  if (c.isError) return <p style={{ color: 'var(--red)', fontSize: 13 }}>Couldn't load this contact. <button type="button" onClick={() => c.refetch()} style={{ background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0 }}>Retry</button></p>;
  if (!c.data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  const d = c.data;
  const phone = d.phones.find((p) => p.PhoneNumber);
  const addr = d.addresses.find((a) => a.AddressLine1 || a.City);
  const tabs: { value: SubTab; label: string; count?: number }[] = [
    { value: 'invoices', label: 'Invoices', count: d.counts.invoices }, { value: 'bills', label: 'Bills', count: d.counts.bills },
    { value: 'bank', label: 'Bank', count: d.counts.bank }, { value: 'credits', label: 'Credit notes', count: d.counts.creditNotes },
    { value: 'payments', label: 'Payments', count: d.counts.payments }, { value: 'activity', label: 'Activity' },
  ];
  const docRows = (rows?: { id: string; number: string | null; date: string | null; dueDate: string | null; reference: string | null; total: number; currencyCode: string; status: string; overdue: boolean; overdueDays: number; partPaid: boolean }[]) =>
    rows?.length ? rows.map((r) => (
      <Row key={r.id} onClick={() => onPush({ kind: 'invoice', id: r.id })} top={<><span style={{ fontFamily: 'var(--font-mono)' }}>{r.number ?? '—'}</span><InvoiceStatus i={r} /></>}
        right={money(r.total, r.currencyCode)} sub={`${day(r.date)} · due ${day(r.dueDate)}${r.reference ? ` · ${r.reference}` : ''}`} />
    )) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nothing here yet.</p>;
  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
        <ContactAvatar name={d.name} size={44} />
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-0.02em' }}>{d.name}</h2>
          <span style={{ display: 'flex', gap: 4 }}>
            {d.isCustomer && <Pill tone="purple">Customer</Pill>}{d.isSupplier && <Pill tone="blue">Supplier</Pill>}{d.archived && <Pill tone="gray">Archived</Pill>}
          </span>
        </div>
      </div>
      <Facts rows={[
        ['Contact person', d.person], ['Email', d.email ? <a href={`mailto:${d.email}`}>{d.email}</a> : null],
        ['Phone', phone ? [phone.PhoneCountryCode, phone.PhoneAreaCode, phone.PhoneNumber].filter(Boolean).join(' ') : null],
        ['Address', addr ? [addr.AddressLine1, addr.City, addr.Region, addr.Country].filter(Boolean).join(', ') : null],
        ['Tax number', d.taxNumber], ['Default currency', d.defaultCurrency],
      ]} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 16 }}>
        {([['Lifetime billed', d.kpis.billed], ['Owed to you', d.kpis.owed], ['Overdue', d.kpis.overdue], ['Lifetime spend', d.kpis.spend]] as const).map(([k, v]) => (
          <div key={k} style={{ background: 'var(--surface-alt)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '9px 10px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
            <b style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums', color: k === 'Overdue' && v > 0 ? 'var(--red)' : undefined }}>{baseMoney(v, base)}</b>
          </div>
        ))}
      </div>
      <Tabs variant="segmented" items={tabs} value={tab} onChange={(v) => setTab(v as SubTab)} ariaLabel="Contact records" />
      <div style={{ marginTop: 10 }}>
        {tab === 'invoices' && docRows(inv.data?.items)}
        {tab === 'bills' && docRows(bills.data?.items)}
        {tab === 'bank' && (bank.data?.items.length ? bank.data.items.map((t) => (
          <Row key={t.id} onClick={() => onPush({ kind: 'bank', id: t.id })} top={t.description ?? t.reference ?? 'Bank transaction'}
            right={`${t.direction === 'out' ? '−' : '+'}${money(t.total, t.currencyCode)}`} sub={day(t.date)} />
        )) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nothing here yet.</p>)}
        {tab === 'credits' && (credits.data?.items.length ? credits.data.items.map((n) => (
          <Row key={n.id} onClick={() => onPush({ kind: 'creditNote', id: n.id })} top={<span style={{ fontFamily: 'var(--font-mono)' }}>{n.number}</span>}
            right={money(n.total, n.currencyCode)} sub={day(n.date)} />
        )) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nothing here yet.</p>)}
        {tab === 'payments' && <PaymentsList items={pays.data?.items ?? []} onPush={onPush} />}
        {tab === 'activity' && (
          <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 0 14px', borderLeft: '2px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(act.data?.items ?? []).map((a) => (
              <li key={`${a.kind}-${a.id}`} style={{ fontSize: 13 }}>{a.title}
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{day(a.date)} · {money(a.amount, a.currencyCode ?? 'USD')} · {a.status.toLowerCase()}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function InvoiceView({ id, onPush }: { id: string; onPush: (r: RecordRef) => void }) {
  const q = useFinanceInvoice(id);
  if (q.isError) return <p style={{ color: 'var(--red)', fontSize: 13 }}>Couldn't load this invoice. <button type="button" onClick={() => q.refetch()} style={{ background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0 }}>Retry</button></p>;
  if (!q.data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  const d = q.data;
  const cur = d.currencyCode;
  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
        <FileText size={28} color="var(--text-muted)" />
        <div><h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 17, margin: '0 0 6px' }}>{d.number ?? '—'}</h2>
          <span style={{ display: 'flex', gap: 4 }}><InvoiceStatus i={d} /><Pill tone="gray">{d.type === 'ACCREC' ? 'Sales invoice' : 'Purchase bill'}</Pill></span></div>
      </div>
      <Facts rows={[
        [d.type === 'ACCREC' ? 'To' : 'From', d.contactId ? <a href="#" onClick={(e) => { e.preventDefault(); onPush({ kind: 'contact', id: d.contactId! }); }}>{d.contactName}</a> : d.contactName],
        ['Reference', d.reference], ['Date', day(d.date)],
        ['Due date', <span style={d.overdue ? { color: 'var(--red)' } : undefined}>{day(d.dueDate)}{d.overdue ? ` · ${d.overdueDays} days late` : ''}</span>],
        ['Currency', `${cur}${d.currencyRate !== 1 ? ` · rate ${d.currencyRate}` : ''}`],
        ['Last changed in Xero', d.updatedDateUtc ? new Date(d.updatedDateUtc).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null],
      ]} />
      {label('Line items')}
      <LinesTable lines={d.lineItems} currency={cur} />
      <div style={{ marginLeft: 'auto', width: 'min(280px, 100%)', display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 16px', fontSize: 13, margin: '12px 0 0 auto' }}>
        <span style={{ color: 'var(--text-muted)' }}>Subtotal</span><span>{money(d.subTotal, cur)}</span>
        <span style={{ color: 'var(--text-muted)' }}>Tax</span><span>{money(d.totalTax, cur)}</span>
        <b style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>Total {cur}</b><b style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>{money(d.total, cur)}</b>
        {d.amountPaid > 0 && <><span style={{ color: 'var(--text-muted)' }}>Less payments</span><span>−{money(d.amountPaid, cur)}</span></>}
        {d.amountCredited > 0 && <><span style={{ color: 'var(--text-muted)' }}>Less credits</span><span>−{money(d.amountCredited, cur)}</span></>}
        <b>Amount due</b><b>{money(d.amountDue, cur)}</b>
      </div>
      {label('Payments')}<PaymentsList items={d.payments} onPush={onPush} />
      {label('Attachments')}<Attachments items={d.attachments} xeroUrl={d.xeroUrl} />
    </>
  );
}

function BankView({ id, onPush }: { id: string; onPush: (r: RecordRef) => void }) {
  const q = useFinanceBankTxDetail(id);
  if (q.isError) return <p style={{ color: 'var(--red)', fontSize: 13 }}>Couldn't load this bank transaction. <button type="button" onClick={() => q.refetch()} style={{ background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0 }}>Retry</button></p>;
  if (!q.data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  const t = q.data;
  return (
    <>
      <h2 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 6px' }}>{t.description ?? t.reference ?? 'Bank transaction'}</h2>
      <span style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <Pill tone={t.direction === 'in' ? 'green' : t.direction === 'out' ? 'purple' : 'gray'}>{t.direction === 'in' ? 'Receive money' : t.direction === 'out' ? 'Spend money' : 'Transfer'}</Pill>
        {t.isReconciled ? <Pill tone="gray">Reconciled</Pill> : <Pill tone="amber">Unreconciled</Pill>}
      </span>
      <Facts rows={[
        [t.direction === 'in' ? 'Received from' : 'Paid to', t.contactId ? <a href="#" onClick={(e) => { e.preventDefault(); onPush({ kind: 'contact', id: t.contactId! }); }}>{t.contactName}</a> : t.contactName],
        ['Date', day(t.date)], ['Bank account', t.bankAccountName], ['Reference', t.reference],
      ]} />
      {label('Line items')}<LinesTable lines={t.lineItems} currency={t.currencyCode} />
      {label('Attachments')}<Attachments items={t.attachments} xeroUrl={t.xeroUrl} />
    </>
  );
}

function CreditNoteView({ id, onPush }: { id: string; onPush: (r: RecordRef) => void }) {
  const q = useFinanceCreditNote(id);
  if (q.isError) return <p style={{ color: 'var(--red)', fontSize: 13 }}>Couldn't load this credit note. <button type="button" onClick={() => q.refetch()} style={{ background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0 }}>Retry</button></p>;
  if (!q.data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  const n = q.data;
  return (
    <>
      <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 17, margin: '0 0 6px' }}>{n.number ?? '—'}</h2>
      <span style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <Pill tone={n.type === 'ACCRECCREDIT' ? 'purple' : 'blue'}>{n.type === 'ACCRECCREDIT' ? 'Customer credit' : 'Supplier credit'}</Pill>
        {n.remainingCredit ? <Pill tone="amber">{`Unallocated ${money(n.remainingCredit, n.currencyCode)}`}</Pill> : <Pill tone="green">Fully applied</Pill>}
      </span>
      <Facts rows={[['Contact', n.contactName], ['Date', day(n.date)], ['Reference', n.reference], ['Total', money(n.total, n.currencyCode)]]} />
      {label('Line items')}<LinesTable lines={n.lineItems} currency={n.currencyCode} />
      {label('Payments')}<PaymentsList items={n.payments} onPush={onPush} />
      {label('Attachments')}<Attachments items={n.attachments} xeroUrl={n.xeroUrl} />
    </>
  );
}

function PaymentView({ p, onPush }: { p: PaymentListItem; onPush: (r: RecordRef) => void }) {
  return (
    <>
      <h2 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 12px' }}>{money(p.amount, p.currencyCode ?? 'USD')} {p.direction === 'out' ? 'paid' : 'received'}</h2>
      <Facts rows={[
        ['Applied to', p.invoiceId ? <a href="#" onClick={(e) => { e.preventDefault(); onPush({ kind: 'invoice', id: p.invoiceId! }); }}>{p.invoiceNumber}</a>
          : p.creditNoteId ? <a href="#" onClick={(e) => { e.preventDefault(); onPush({ kind: 'creditNote', id: p.creditNoteId! }); }}>{p.creditNoteNumber}</a> : null],
        ['Contact', p.contactName], ['Date', day(p.date)], ['Bank account', p.bankAccountName], ['Reference', p.reference],
      ]} />
    </>
  );
}

const TITLE: Record<RecordRef['kind'], string> = { contact: 'Contact', invoice: 'Invoice', bank: 'Bank transaction', creditNote: 'Credit note', payment: 'Payment' };

export function RecordDrawer({ stack, onPush, onBack, onClose, xeroUrlFor, base }: {
  stack: RecordRef[]; onPush: (r: RecordRef) => void; onBack: () => void; onClose: () => void; base: string | null;
  xeroUrlFor?: (r: RecordRef) => string | undefined;
}) {
  const top = stack[stack.length - 1];
  const contact = useFinanceContact(top?.kind === 'contact' ? top.id : null);
  const invoice = useFinanceInvoice(top?.kind === 'invoice' ? top.id : null);
  const bank = useFinanceBankTxDetail(top?.kind === 'bank' ? top.id : null);
  const credit = useFinanceCreditNote(top?.kind === 'creditNote' ? top.id : null);
  const xeroUrl = contact.data?.xeroUrl ?? invoice.data?.xeroUrl ?? bank.data?.xeroUrl ?? credit.data?.xeroUrl ?? (top && xeroUrlFor?.(top));
  return (
    <Drawer open={!!top} onClose={onClose} width={600} title={top ? TITLE[top.kind] : ''}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%' }}>
          {stack.length > 1 ? <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack}>Back</Button> : <span />}
          {xeroUrl && <a href={xeroUrl} target="_blank" rel="noreferrer"><Button icon={<ExternalLink size={14} />}>Open in Xero</Button></a>}
        </div>
      }>
      {/* Drawer's body wrapper is `overflow: hidden` (it owns the header/footer
          layout), so the scrollable region has to be created here. */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {top?.kind === 'contact' && <ContactView key={top.id} id={top.id} onPush={onPush} base={base} />}
        {top?.kind === 'invoice' && <InvoiceView key={top.id} id={top.id} onPush={onPush} />}
        {top?.kind === 'bank' && <BankView key={top.id} id={top.id} onPush={onPush} />}
        {top?.kind === 'creditNote' && <CreditNoteView key={top.id} id={top.id} onPush={onPush} />}
        {top?.kind === 'payment' && top.payment && <PaymentView p={top.payment} onPush={onPush} />}
      </div>
    </Drawer>
  );
}

// Re-exported for the page's export columns.
export { Amount };
