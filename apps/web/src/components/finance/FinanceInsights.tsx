import { MetricCard } from '../ui/MetricCard';
import { Card } from '../ui/Card';
import type { FinanceSummary } from '../../api/finance';
import { baseMoney, ContactAvatar, day } from './format';

export type KpiTarget = 'recv' | 'overdue' | 'pay' | 'in' | 'out';

export function FinanceKpis({ s, loading, onOpen }: { s?: FinanceSummary; loading: boolean; onOpen: (t: KpiTarget) => void }) {
  const cur = s?.baseCurrency ?? 'USD';
  const month = new Date().toLocaleString('en-GB', { month: 'short' });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
      <MetricCard dense loading={loading} label="Owed to you" value={baseMoney(s?.owedToYou.amount ?? 0, cur)} caption={`${s?.owedToYou.count ?? 0} unpaid invoices`} onClick={() => onOpen('recv')} />
      <MetricCard dense loading={loading} label="Overdue" value={baseMoney(s?.overdue.amount ?? 0, cur)}
        caption={`${s?.overdue.count ?? 0} invoices${s?.overdue.oldestDays ? ` · oldest ${s.overdue.oldestDays}d` : ''}`} onClick={() => onOpen('overdue')} />
      <MetricCard dense loading={loading} label="You owe" value={baseMoney(s?.youOwe.amount ?? 0, cur)}
        caption={`${s?.youOwe.count ?? 0} bills${s?.youOwe.nextDueDate ? ` · next due ${day(s.youOwe.nextDueDate)}` : ''}`} onClick={() => onOpen('pay')} />
      {/* These open the Payments tab; the receive/spend money part lives in Bank transactions, so the caption says so. */}
      <MetricCard dense loading={loading} label={`Money in · ${month}`} value={baseMoney(s?.moneyInMonth ?? 0, cur)} caption="Payments + receive money (see Bank transactions)" onClick={() => onOpen('in')} />
      <MetricCard dense loading={loading} label={`Money out · ${month}`} value={baseMoney(s?.moneyOutMonth ?? 0, cur)} caption="Payments + spend money (see Bank transactions)" onClick={() => onOpen('out')} />
    </div>
  );
}

const AGING_COLORS: Record<string, string> = { current: '#10b981', '1-30': '#f59e0b', '31-60': '#f97316', '61-90': '#ef4444', '90+': '#b91c1c' };
const AGING_LABELS: Record<string, string> = { current: 'Current', '1-30': '1–30 days', '31-60': '31–60 days', '61-90': '61–90 days', '90+': '90+ days' };

export function AgedReceivables({ s, onOpenContact, onViewOverdue }: { s: FinanceSummary; onOpenContact: (id: string) => void; onViewOverdue: () => void }) {
  const cur = s.baseCurrency ?? 'USD';
  const total = s.aging.reduce((a, b) => a + b.amount, 0) || 1;
  return (
    <Card title="Aged receivables" subtitle={`Unpaid customer invoices by days past due, in ${cur}`} action={<button type="button" onClick={onViewOverdue} style={{ background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>View overdue →</button>}>
      <div role="img" aria-label="Aged receivables distribution" style={{ display: 'flex', height: 14, borderRadius: 5, overflow: 'hidden', gap: 2, margin: '6px 0 12px' }}>
        {s.aging.filter((b) => b.amount > 0).map((b) => (
          <span key={b.bucket} title={`${AGING_LABELS[b.bucket]}: ${baseMoney(b.amount, cur)}`} style={{ width: `${(b.amount / total) * 100}%`, background: AGING_COLORS[b.bucket] }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 10 }}>
        {s.aging.map((b) => (
          <div key={b.bucket} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: AGING_COLORS[b.bucket], marginRight: 5 }} />
            {AGING_LABELS[b.bucket]}
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{baseMoney(b.amount, cur)}</div>
          </div>
        ))}
      </div>
      {s.topOverdue.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '16px 0 6px' }}>Most overdue</div>
          {s.topOverdue.map((c) => (
            <button key={c.contactId} type="button" onClick={() => onOpenContact(c.contactId)}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 2, width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--border-soft)', padding: '8px 4px', cursor: 'pointer', color: 'var(--text)' }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><ContactAvatar name={c.contactName} size={20} />{c.contactName}</span>
              <span style={{ color: 'var(--red)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{baseMoney(c.amount, cur)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.invoices} overdue {c.invoices === 1 ? 'invoice' : 'invoices'} · oldest {c.oldestDays} days late</span>
            </button>
          ))}
        </>
      )}
    </Card>
  );
}

export function MoneyFlowChart({ s }: { s: FinanceSummary }) {
  const W = 340, H = 160, L = 34, B = 20;
  const max = Math.max(1, ...s.series.flatMap((p) => [p.in, p.out]));
  const step = max > 50000 ? 20000 : max > 20000 ? 10000 : max > 5000 ? 2500 : 1000;
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => H - B - (v / top) * (H - B - 8);
  const cw = (W - L) / s.series.length;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const cur = s.baseCurrency ?? 'USD';
  return (
    <Card title="Money in vs out" subtitle={`Last 6 months, ${cur}`}
      action={<span style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
        <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--green)', marginRight: 4 }} />In</span>
        <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--accent)', marginRight: 4 }} />Out</span>
      </span>}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Money in versus money out by month" style={{ width: '100%', height: 'auto', display: 'block' }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--border-soft)" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)">{v === 0 ? '0' : `${v / 1000}k`}</text>
          </g>
        ))}
        {s.series.map((p, i) => {
          const cx = L + cw * i + cw / 2;
          return (
            <g key={p.month}>
              <rect x={cx - 13} y={y(p.in)} width={12} height={H - B - y(p.in)} rx={2} fill="var(--green)"><title>{`${label(p.month)} in: ${baseMoney(p.in, cur)}`}</title></rect>
              <rect x={cx + 1} y={y(p.out)} width={12} height={H - B - y(p.out)} rx={2} fill="var(--accent)"><title>{`${label(p.month)} out: ${baseMoney(p.out, cur)}`}</title></rect>
              <text x={cx} y={H - 5} textAnchor="middle" fontSize={10} fill="var(--text-muted)">{label(p.month)}</text>
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
