import { useState } from 'react';
import { ChartEmpty } from './ChartEmpty';

export interface StackedSeries {
  key: string;
  color: string;
}

interface StackedBarChartProps {
  /** X-axis labels, already short-formatted; aligned 1:1 with `values`. */
  labels: string[];
  /** Stack order (bottom→top) and legend; also drives segment colors. */
  series: StackedSeries[];
  /** Per-bucket value maps, aligned 1:1 with `labels`. */
  values: Record<string, number>[];
  height?: number;
  formatValue?: (v: number) => string;
  /**
   * When true, each column stacks its own segments largest→smallest (biggest at
   * the bottom) instead of using the fixed `series` order. Colors stay keyed to
   * each series, so a key keeps its color across columns; only the order moves.
   * The legend keeps the global `series` order.
   */
  sortSegmentsByValue?: boolean;
}

/**
 * Vertical stacked bars over time buckets. Each column is one period; segments
 * are the per-series contributions. Segment heights are scaled by the largest
 * column *total* across all buckets (not the per-column total) so the bars read
 * as a trend rather than all filling to full height.
 */
export function StackedBarChart({ labels, series, values, height = 220, formatValue, sortSegmentsByValue = false }: StackedBarChartProps) {
  // Track the hovered bucket plus the cursor position so the tooltip can be
  // rendered viewport-fixed — that keeps it from being clipped by the card's
  // overflow when it would otherwise spill above the plot.
  const [hovered, setHovered] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const fv = formatValue ?? String;

  // Segment order for a given column: either the fixed global order, or that
  // column's own values largest→smallest (used for both the stack and tooltip).
  const orderFor = (i: number) =>
    sortSegmentsByValue
      ? [...series].sort((a, b) => (values[i]?.[b.key] ?? 0) - (values[i]?.[a.key] ?? 0))
      : series;

  const totals = values.map(v => series.reduce((s, ser) => s + (v[ser.key] ?? 0), 0));
  const maxTotal = Math.max(0, ...totals);
  if (!labels.length || maxTotal <= 0) return <ChartEmpty height={height} />;

  // Thin x labels so they don't collide when there are many buckets.
  const labelStep = Math.ceil(labels.length / 12);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11 }}>
        {series.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {s.key}
            </span>
          </div>
        ))}
      </div>

      {/* Plot */}
      <div style={{ position: 'relative' }}>
        {/* Max-value gridline label */}
        <div style={{ position: 'absolute', top: -6, left: 0, fontSize: 10, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
          {fv(maxTotal)}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: labels.length > 40 ? 1 : 3,
            height,
            borderBottom: '1px solid var(--border)',
          }}
        >
          {labels.map((_label, i) => {
            const isHovered = hovered === i;
            return (
              <div
                key={i}
                onMouseEnter={(e) => { setHovered(i); setCursor({ x: e.clientX, y: e.clientY }); }}
                onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHovered(h => (h === i ? null : h))}
                style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', minWidth: 0, cursor: 'default' }}
              >
                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column-reverse', // first entry at the bottom
                    borderRadius: '3px 3px 0 0',
                    overflow: 'hidden',
                    opacity: hovered === null || isHovered ? 1 : 0.45,
                    transition: 'opacity 120ms',
                  }}
                >
                  {orderFor(i).map(s => {
                    const v = values[i]?.[s.key] ?? 0;
                    const h = (v / maxTotal) * height;
                    if (h <= 0) return null;
                    return <div key={s.key} style={{ height: h, background: s.color }} />;
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* X labels (thinned) */}
        <div style={{ display: 'flex', gap: labels.length > 40 ? 1 : 3, marginTop: 4 }}>
          {labels.map((label, i) => (
            <div key={i} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {i % labelStep === 0 ? label : ''}
            </div>
          ))}
        </div>

        {/* Hover tooltip — full per-bucket breakdown. Rendered viewport-fixed
            and following the cursor so the card's overflow never clips it; it
            flips to the left/above the cursor near the screen edges. */}
        {hovered !== null && (
          <div
            style={{
              position: 'fixed',
              left: cursor.x + (cursor.x > window.innerWidth - 240 ? -14 : 14),
              top: cursor.y + (cursor.y > window.innerHeight - 220 ? -14 : 14),
              transform: `translate(${cursor.x > window.innerWidth - 240 ? '-100%' : '0'}, ${cursor.y > window.innerHeight - 220 ? '-100%' : '0'})`,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
              padding: '8px 10px',
              fontSize: 11,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 50,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{labels[hovered]}</div>
            {orderFor(hovered)
              .filter(s => (values[hovered]?.[s.key] ?? 0) > 0)
              .map(s => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-muted)', flex: 1 }}>{s.key}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fv(values[hovered]?.[s.key] ?? 0)}</span>
                </div>
              ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)', fontWeight: 600 }}>
              <span>Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fv(totals[hovered])}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
