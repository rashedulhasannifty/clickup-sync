import { Pill } from '../ui/Pill';
import type { KpiResult } from '../../api/people';
import { bandColor, formatHours, formatPct, kpiEmptyHint, kpiEmptyText } from '../../lib/people';

export type KpiUnit = 'hours' | 'tasks' | 'days';

function amount(n: number, unit: KpiUnit): string {
  return unit === 'hours' ? formatHours(n) : String(n);
}

/**
 * One KPI: value against target, the numerator/denominator behind it, and where
 * the data comes from. A null value never renders as a number, because 0% and
 * "we cannot tell" lead to different decisions about a person.
 */
export function KpiTile({
  label,
  source,
  kpi,
  unit,
  detail,
}: {
  label: string;
  /** Where the number comes from: "ClickUp" or "Office". */
  source: string;
  kpi: KpiResult;
  unit: KpiUnit;
  /** Builds the line under the value, e.g. "132.5h logged of 145.6h available". */
  detail: (numerator: string, denominator: string) => string;
}) {
  const hasValue = kpi.value != null;
  const color = bandColor(kpi.status);
  const fill = hasValue ? Math.max(0, Math.min(100, kpi.value as number)) : 0;
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
        gap: 6,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
        <Pill tone={source === 'ClickUp' ? 'blue' : 'gray'} size="xs">
          {source}
        </Pill>
      </div>

      {hasValue ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {formatPct(kpi.value as number)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>target {formatPct(kpi.target)}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {detail(amount(kpi.numerator, unit), amount(kpi.denominator, unit))}
          </div>
          <div
            role="img"
            aria-label={`${formatPct(kpi.value as number)} against a target of ${formatPct(kpi.target)}`}
            style={{ position: 'relative', height: 6, borderRadius: 999, background: 'var(--muted-bg)', marginTop: 2 }}
          >
            <div style={{ width: `${fill}%`, height: '100%', borderRadius: 999, background: color }} />
            <div
              aria-hidden
              title={`Target ${formatPct(kpi.target)}`}
              style={{
                position: 'absolute',
                left: `${Math.min(100, kpi.target)}%`,
                top: -3,
                bottom: -3,
                width: 2,
                borderRadius: 1,
                background: 'var(--text-muted)',
              }}
            />
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-muted)', minHeight: 32, display: 'flex', alignItems: 'center' }}>
            {kpiEmptyText(kpi)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{kpiEmptyHint(kpi)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>target {formatPct(kpi.target)}</div>
        </>
      )}
    </div>
  );
}
