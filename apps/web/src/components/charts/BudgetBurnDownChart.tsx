import { useId, useState } from 'react';
import { fmt } from '../../lib/formatters';

/**
 * Cumulative month-to-date spend ("burn-down") for one client, with the budget
 * ceiling, an ideal even-pace line, and a dashed projection to the month-end
 * forecast. All values are DOLLARS (the status endpoint already converts cents).
 *
 * Rendering follows the LineChart.tsx convention: the svg uses
 * preserveAspectRatio="none" (x stretches to fill width), so the svg holds ONLY
 * paths/lines (with non-scaling-stroke). Every label and marker is an HTML
 * overlay — in-svg <text>/<circle> would be distorted by the x-stretch.
 */
interface BudgetBurnDownChartProps {
  dailySeries: { date: string; cost: number }[];
  monthlyAmount: number | null;
  forecast: number;
  /** Target month as YYYY-MM. */
  month: string;
  height?: number;
}

const ACCENT = 'var(--accent)';
const W = 100;
const PAD_X = 6; // viewBox units == % of width (viewBox width is 100)

/** Round up to a clean axis maximum: 1/2/5 × 10ⁿ. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Compact money for axis ticks: $0, $850, $1.7k, $24k. */
function compactMoney(d: number): string {
  const abs = Math.abs(d);
  if (abs >= 1000) return `$${(d / 1000).toFixed(abs >= 9950 ? 0 : 1)}k`;
  return `$${Math.round(d)}`;
}

export function BudgetBurnDownChart({
  dailySeries,
  monthlyAmount,
  forecast,
  month,
  height = 180,
}: BudgetBurnDownChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const gradId = `bd-${useId()}`;

  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();

  // Cumulative actual spend, in date order.
  const sorted = [...dailySeries].sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const points = sorted.map((pt) => {
    running += pt.cost;
    return { day: parseInt(pt.date.split('-')[2], 10), value: running, date: pt.date };
  });
  const lastActual = points[points.length - 1] ?? null;

  if (points.length === 0 && monthlyAmount == null) {
    return (
      <div style={{ padding: '16px', fontSize: 12, color: 'var(--text-muted)' }}>
        No spend logged for this month yet.
      </div>
    );
  }

  const maxY = niceCeil(Math.max(monthlyAmount ?? 0, lastActual?.value ?? 0, forecast, 0) * 1.02);

  const padTop = 12;
  const padBottom = 6;
  const plotH = height - padTop - padBottom;
  const usableW = W - 2 * PAD_X;
  const xOf = (day: number) => PAD_X + ((day - 1) / (daysInMonth - 1 || 1)) * usableW;
  const yOf = (val: number) => padTop + (1 - val / maxY) * plotH;

  const actualPts = points.map((p) => [xOf(p.day), yOf(p.value)] as [number, number]);
  const actualPath =
    actualPts.length > 0 ? actualPts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x},${y}`).join(' ') : null;
  const areaPath =
    actualPts.length > 1
      ? `${actualPath} L ${actualPts[actualPts.length - 1][0]},${yOf(0)} L ${actualPts[0][0]},${yOf(0)} Z`
      : null;

  const ceilingY = monthlyAmount != null ? yOf(monthlyAmount) : null;
  const idealPath =
    monthlyAmount != null ? `M ${xOf(1)},${yOf(0)} L ${xOf(daysInMonth)},${yOf(monthlyAmount)}` : null;

  let projection: { path: string; x: number; y: number } | null = null;
  if (lastActual && lastActual.day < daysInMonth) {
    const fromX = xOf(lastActual.day);
    const fromY = yOf(lastActual.value);
    const toX = xOf(daysInMonth);
    const toY = yOf(forecast);
    projection = { path: `M ${fromX},${fromY} L ${toX},${toY}`, x: toX, y: toY };
  }

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);
  const xTickDays = [1, Math.round(daysInMonth / 2), daysInMonth];

  const overBudget = monthlyAmount != null && (lastActual?.value ?? 0) > monthlyAmount;
  const actualColor = overBudget ? 'var(--pill-red-text)' : ACCENT;

  const legend: { label: string; color: string; dashed?: boolean; show: boolean }[] = [
    { label: 'Actual', color: actualColor, show: !!actualPath },
    { label: 'Projection', color: ACCENT, dashed: true, show: !!projection },
    { label: 'Ideal pace', color: 'var(--text-faint)', dashed: true, show: !!idealPath },
    { label: 'Budget', color: 'var(--pill-red-text)', dashed: true, show: ceilingY != null },
  ];

  return (
    <div style={{ padding: '14px 18px 6px' }}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8, fontSize: 11, color: 'var(--text-muted)' }}>
        {legend.filter((l) => l.show).map((l) => (
          <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 16,
                height: 0,
                borderTop: `2px ${l.dashed ? 'dashed' : 'solid'} ${l.color}`,
                opacity: l.dashed ? 0.7 : 1,
              }}
            />
            {l.label}
          </span>
        ))}
      </div>

      {/* Plot area: relative box holds the svg plus HTML overlays (labels, markers). */}
      <div style={{ position: 'relative', width: '100%', height }}>
        {/* Y-axis tick labels (HTML overlay, left edge) */}
        {gridVals.map((v) => (
          <span
            key={`yl-${v}`}
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              top: yOf(v),
              transform: 'translateY(-50%)',
              fontSize: 10,
              color: 'var(--text-faint)',
              fontVariantNumeric: 'tabular-nums',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            {compactMoney(v)}
          </span>
        ))}

        <svg
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={actualColor} stopOpacity="0.16" />
              <stop offset="100%" stopColor={actualColor} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Horizontal gridlines */}
          {gridVals.map((v) => (
            <line
              key={`g-${v}`}
              x1={PAD_X}
              y1={yOf(v)}
              x2={W - PAD_X}
              y2={yOf(v)}
              stroke="var(--border-soft)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Ideal-pace line */}
          {idealPath && (
            <path d={idealPath} fill="none" stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          )}

          {/* Budget ceiling */}
          {ceilingY != null && (
            <line
              x1={PAD_X}
              y1={ceilingY}
              x2={W - PAD_X}
              y2={ceilingY}
              stroke="var(--pill-red-text)"
              strokeOpacity={0.6}
              strokeWidth={1.25}
              strokeDasharray="5 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Actual area + line */}
          {areaPath && <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />}
          {actualPath && (
            <path
              d={actualPath}
              fill="none"
              stroke={actualColor}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Projection */}
          {projection && (
            <path
              d={projection.path}
              fill="none"
              stroke={ACCENT}
              strokeOpacity={0.55}
              strokeWidth={2}
              strokeDasharray="4 3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Budget ceiling label */}
        {ceilingY != null && monthlyAmount != null && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              right: 0,
              top: ceilingY,
              transform: 'translateY(-50%)',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--pill-red-text)',
              background: 'var(--muted-bg)',
              padding: '0 4px',
              borderRadius: 4,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            {compactMoney(monthlyAmount)}
          </span>
        )}

        {/* Actual point markers (HTML, stay circular) + hover tooltip */}
        {points.map((p, i) => {
          const isHover = hover === i;
          return (
            <span
              key={`m-${p.date}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              style={{
                position: 'absolute',
                left: `${(xOf(p.day) / W) * 100}%`,
                top: yOf(p.value),
                width: isHover ? 10 : 7,
                height: isHover ? 10 : 7,
                borderRadius: '50%',
                background: actualColor,
                boxShadow: isHover ? `0 0 0 3px color-mix(in srgb, ${actualColor} 25%, transparent)` : 'none',
                border: '1.5px solid var(--surface)',
                transform: 'translate(-50%, -50%)',
                transition: 'width 120ms ease, height 120ms ease',
                cursor: 'pointer',
                zIndex: 3,
              }}
            />
          );
        })}

        {/* Forecast endpoint marker (hollow ring) */}
        {projection && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: `${(projection.x / W) * 100}%`,
              top: projection.y,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--surface)',
              border: `2px solid ${ACCENT}`,
              opacity: 0.7,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />
        )}

        {/* Hover tooltip */}
        {hover != null && points[hover] && (
          <div
            role="tooltip"
            style={{
              position: 'absolute',
              left: `${(xOf(points[hover].day) / W) * 100}%`,
              top: yOf(points[hover].value) - 12,
              transform: 'translate(-50%, -100%)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 6px 16px rgba(15,23,42,0.10)',
              padding: '5px 9px',
              fontSize: 11,
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <span style={{ fontWeight: 600 }}>{fmt.shortDate(points[hover].date)}</span>
            <span style={{ color: 'var(--text-muted)' }}> · {fmt.money(Math.round(points[hover].value * 100))}</span>
          </div>
        )}
      </div>

      {/* X-axis tick labels (HTML row below the svg) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: `6px ${PAD_X}% 0`,
          fontSize: 10,
          color: 'var(--text-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {xTickDays.map((day) => (
          <span key={day}>
            {new Date(Date.UTC(year, mon - 1, day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        ))}
      </div>
    </div>
  );
}
