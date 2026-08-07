import type { ReactNode } from 'react';
import { ChartEmpty } from './ChartEmpty';

const PALETTE = ['#7B68EE','#FF02F0','#49CCF9','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

export interface BarData {
  label: string;
  value: number;
  color?: string;
  leading?: ReactNode;
  /** Opaque value handed back to `onBarClick` — e.g. an assignee userId or a
   *  space id — so a click can deep-link even when it differs from `label`. */
  filterKey?: string;
}

interface BarChartProps {
  data: BarData[];
  direction?: 'vertical' | 'horizontal';
  height?: number;
  formatValue?: (v: number) => string;
  /** Horizontal only: cap the row list at this pixel height and scroll the
   *  overflow. Used by breakdown cards that render every row (all assignees,
   *  all clients) so the card stays compact instead of growing unbounded. */
  maxHeight?: number;
  /** Horizontal only: when provided, rows become interactive (a real button —
   *  pointer cursor, hover, keyboard-activatable). Return a string from
   *  `rowLabel` to override the accessible label; returning `false` from
   *  `rowClickable` leaves a row inert. */
  onBarClick?: (data: BarData, index: number) => void;
  /** Per-row gate for `onBarClick`: return false to keep a placeholder row
   *  (empty client, unnamed space) non-interactive. Defaults to "has a
   *  `filterKey`", which is exactly what a deep-link needs to target. */
  rowClickable?: (data: BarData, index: number) => boolean;
  /** Accessible label for a clickable row, e.g. "Filter time entries by X". */
  rowLabel?: (data: BarData, index: number) => string;
}

export function BarChart({ data, direction = 'horizontal', height = 200, formatValue, maxHeight, onBarClick, rowClickable, rowLabel }: BarChartProps) {
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
        {data.map((d, i) => {
          // Default gate: a row is clickable when it carries a `filterKey` to
          // deep-link on. Callers can override with an explicit `rowClickable`.
          const clickable = !!onBarClick && (rowClickable ? rowClickable(d, i) : !!d.filterKey);
          const inner = (
            <>
              {d.leading}
              <span style={{ width: 110, color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>
                {d.label}
              </span>
              <div style={{ flex: 1, height: 8, background: 'var(--muted-bg)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: colorOf(d, i), borderRadius: 999, transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)' }} />
              </div>
              <span style={{ width: 60, textAlign: 'right', color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, flexShrink: 0 }}>
                {fv(d.value)}
              </span>
            </>
          );
          // Inert rows keep the original static layout untouched — no button
          // chrome, no box-metric changes for the non-interactive charts.
          if (!clickable) {
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                {inner}
              </div>
            );
          }
          // Clickable rows: a real <button> reset to look like the static row.
          // Hover is declarative via `.barchart-row` (index.css) so React never
          // has to reconcile a manually-mutated background. Negative margin
          // offsets the padding so the row doesn't shift versus an inert one.
          return (
            <button
              key={i}
              type="button"
              className="barchart-row"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
                width: '100%', textAlign: 'left', border: 'none',
                font: 'inherit', color: 'inherit',
                padding: '2px 4px', margin: '-2px -4px', borderRadius: 8, cursor: 'pointer',
              }}
              onClick={() => onBarClick!(d, i)}
              aria-label={rowLabel ? rowLabel(d, i) : `Filter by ${d.label}`}
            >
              {inner}
            </button>
          );
        })}
      </div>
    );
  }

  // Vertical bars
  const padX = 8, padY = 12;
  const w = 100;
  const barW = (w - padX * 2) / data.length;
  const summary = data.map((d) => `${d.label}: ${fv(d.value)}`).join(', ');
  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }} role="img" aria-label={`Bar chart. ${summary}`}>
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
