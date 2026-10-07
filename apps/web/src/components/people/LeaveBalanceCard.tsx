import type { LeaveBalance } from '../../api/people';
import { formatDays } from '../../lib/people';

function Row({ label, used, entitlement }: { label: string; used: number; entitlement?: number }) {
  const pct = entitlement ? Math.min(100, (used / entitlement) * 100) : 0;
  const over = entitlement != null && used > entitlement;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--text)' }}>{label}</span>
        <span style={{ color: over ? 'var(--red)' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {entitlement != null ? `${used} of ${entitlement} days` : formatDays(used)}
        </span>
      </div>
      {entitlement != null && (
        <div
          role="img"
          aria-label={`${label}: ${used} of ${entitlement} days used`}
          style={{ height: 5, borderRadius: 999, background: 'var(--muted-bg)' }}
        >
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: over ? 'var(--red)' : 'var(--accent)' }} />
        </div>
      )}
    </div>
  );
}

/** Approved leave used this calendar year against the casual and sick entitlements. */
export function LeaveBalanceCard({ balance }: { balance: LeaveBalance }) {
  const total = balance.casual.used + balance.sick.used + balance.other.used;
  return (
    <div
      className="card-3d"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Leave used · {balance.year}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
        {total}
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>days approved</span>
      </div>
      <Row label="Casual" used={balance.casual.used} entitlement={balance.casual.entitlement} />
      <Row label="Sick" used={balance.sick.used} entitlement={balance.sick.entitlement} />
      {balance.other.used > 0 && <Row label="Annual, unpaid & other" used={balance.other.used} />}
    </div>
  );
}
