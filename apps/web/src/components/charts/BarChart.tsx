import { ChartEmpty } from './ChartEmpty';

const PALETTE = ['#7B68EE','#FF02F0','#49CCF9','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

export interface BarData { label: string; value: number; color?: string; }

interface BarChartProps {
  data: BarData[];
  direction?: 'vertical' | 'horizontal';
  height?: number;
  formatValue?: (v: number) => string;
  /** Horizontal only: cap the row list at this pixel height and scroll the
   *  overflow. Used by breakdown cards that render every row (all assignees,
   *  all clients) so the card stays compact instead of growing unbounded. */
  maxHeight?: number;
}

export function BarChart({ data, direction = 'horizontal', height = 200, formatValue, maxHeight }: BarChartProps) {
  if (!data.length || data.every(d => d.value === 0)) return <ChartEmpty height={height} />;
  const fv = formatValue ?? String;
  const max = Math.max(...data.map(d => d.value));
  const colorOf = (d: BarData, i: number) => d.color ?? PALETTE[i % PALETTE.length];

  if (direction === 'horizontal') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          ...(maxHeight ? { maxHeight, overflowY: 'auto', marginRight: -4, paddingRight: 4 } : {}),
        }}
      >
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ width: 110, color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>
              {d.label}
            </span>
            <div style={{ flex: 1, height: 8, background: 'var(--muted-bg)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: colorOf(d, i), borderRadius: 999, transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)' }} />
            </div>
            <span style={{ width: 60, textAlign: 'right', color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, flexShrink: 0 }}>
              {fv(d.value)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Vertical bars
  const padX = 8, padY = 12;
  const w = 100;
  const barW = (w - padX * 2) / data.length;
  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        {data.map((d, i) => {
          const h = max > 0 ? (d.value / max) * (height - padY * 2) : 0;
          const x = padX + i * barW + barW * 0.15;
          const y = height - padY - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW * 0.7} height={h} rx={1} fill={colorOf(d, i)} opacity={0.9}>
                <title>{d.label}: {d.value}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px 0', fontSize: 10, color: 'var(--text-muted)' }}>
        {data.map((d, i) => (
          <span key={i} style={{ flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
