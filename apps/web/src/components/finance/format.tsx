import { Pill } from '../ui/Pill';
import type { InvoiceListItem } from '../../api/finance';

/**
 * Document-currency money. Unlike fmt.money (cents, narrowSymbol), finance rows mix
 * currencies, so the code must stay unambiguous: A$ / £ / $, plus a code suffix
 * for anything that isn't the base currency.
 */
// This file deliberately mixes small formatting helpers/constants with the
// components that use them (Amount, InvoiceStatus, ContactAvatar), so
// react-refresh's "only export components" rule doesn't apply — disabled
// per export below rather than splitting into a components file + a helpers
// file, since every export here is small and tightly coupled to the others.
// eslint-disable-next-line react-refresh/only-export-components
export function money(n: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/** Whole-unit base-currency figure for KPIs and totals. */
// eslint-disable-next-line react-refresh/only-export-components
export function baseMoney(n: number, currency: string | null | undefined) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n);
}

export function Amount({ value, currency, base }: { value: number; currency: string | null; base: string | null }) {
  const cur = currency || base || 'USD';
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {money(value, cur)}
      {base && cur !== base && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', marginLeft: 4, fontFamily: 'var(--font-mono)' }}>{cur}</span>}
    </span>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function day(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Exclusive buckets, mirroring the backend filter (finance-math.invoiceStatusWhere). */
export function InvoiceStatus({ i }: { i: Pick<InvoiceListItem, 'status' | 'overdue' | 'overdueDays' | 'partPaid'> }) {
  if (i.status === 'DRAFT') return <Pill tone="gray">Draft</Pill>;
  if (i.status === 'SUBMITTED') return <Pill tone="blue">Awaiting approval</Pill>;
  if (i.status === 'PAID') return <Pill tone="green">Paid</Pill>;
  if (i.status === 'VOIDED') return <Pill tone="gray">Voided</Pill>;
  if (i.status === 'DELETED') return <Pill tone="gray">Deleted</Pill>;
  if (i.overdue) return <Pill tone="red">{`Overdue · ${i.overdueDays}d`}</Pill>;
  if (i.partPaid) return <Pill tone="amber">Part paid</Pill>;
  return <Pill tone="amber">Awaiting payment</Pill>;
}

const HUES = ['#7B68EE', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#6366f1', '#84cc16'];
export function ContactAvatar({ name, size = 30 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name.replace(/[^A-Za-z& ]/g, '').split(' ').filter((w) => w && w !== '&').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: size * 0.27, background: HUES[h % HUES.length], color: '#fff', fontSize: size * 0.36, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {initials || '?'}
    </span>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const STATUS_OPTIONS = [
  ['', 'All statuses'], ['unpaid', 'Unpaid (incl. overdue)'], ['DRAFT', 'Draft'], ['SUBMITTED', 'Awaiting approval'],
  ['AUTHORISED', 'Awaiting payment (not overdue)'], ['overdue', 'Overdue'], ['PAID', 'Paid'], ['VOIDED', 'Voided'],
] as const;
