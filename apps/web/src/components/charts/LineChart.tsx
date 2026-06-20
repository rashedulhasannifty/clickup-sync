import { useId, useRef, useState, type ReactNode } from 'react';
import { ChartEmpty } from './ChartEmpty';

interface LineData {
  label?: string;
  date?: string;
  value: number;
  /** Free-form payload passed back to the click handler. Useful when `date`/`label` aren't enough to identify the point (e.g. carry the bucket key). */
  key?: string;
}

interface LineChartProps {
  data: LineData[];
  color?: string;
  height?: number;
  /** Called when the user clicks a point. Receives the full LineData. */
  onPointClick?: (d: LineData, index: number) => void;
  /** Custom tooltip body. Default shows label/date + value. */
  renderTooltip?: (d: LineData) => ReactNode;
  /** Optional formatter for the max-value scale label rendered at top-right. */
  formatMax?: (v: number) => string;
  /**
   * Optional dashed tail rendered past the last data point. When set, the
   * chart draws a dashed segment from the last actual point extending
   * forward (half a bucket-width) to the projected value. The Y scale
   * auto-expands to include `toValue` so the tail never clips above.
   */
  dashedTail?: { toValue: number } | null;
}

// Horizontal viewBox padding so the line doesn't crash into the card edges.
// In viewBox units (= percent of rendered width because viewBox width = 100).
const PAD_X = 4;

// Catmull-Rom → cubic Bezier path. Smooth curve passing through every point.
// For 2 points falls back to a straight line; for ≥3 each segment derives
// control points from neighbours for C1 continuity.
function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0][0]},${points[0][1]}`;
  if (points.length === 2) {
    return `M ${points[0][0]},${points[0][1]} L ${points[1][0]},${points[1][1]}`;
  }
  let d = `M ${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function LineChart({
  data,
  color = 'var(--accent)',
  height = 160,
  onPointClick,
  renderTooltip,
  formatMax,
  dashedTail,
}: LineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // A stable per-instance id so multiple LineCharts on the same page
  // don't collide on the gradient `id`.
  const gradId = `lg-${useId()}`;

  if (!data || data.length < 2) return <ChartEmpty height={height} />;

  const dataMax = Math.max(...data.map(d => d.value));
  const dataMin = Math.min(...data.map(d => d.value));
  // If a dashedTail is provided, expand the Y range to include it so the
  // dashed line never clips above the chart area.
  const max = dashedTail ? Math.max(dataMax, dashedTail.toValue) : dataMax;
  const min = dashedTail ? Math.min(dataMin, dashedTail.toValue) : dataMin;
  const range = max - min || 1;
  const w = 100;
  const padY = 8;
  const usableW = w - 2 * PAD_X;
  const step = usableW / (data.length - 1);
  const points = data.map((d, i) => [
    PAD_X + i * step,
    height - padY - ((d.value - min) / range) * (height - padY * 2),
  ] as [number, number]);

  const linePath = smoothPath(points);
  const firstX = points[0][0];
  const lastX = points[points.length - 1][0];
  const area = `${linePath} L ${lastX},${height} L ${firstX},${height} Z`;

  const labelStep = Math.max(1, Math.floor(data.length / 6));
  const labelItems = data.filter((_, i) => i % labelStep === 0);

  const hovered = hoverIdx != null ? data[hoverIdx] : null;
  const hoveredPt = hoverIdx != null ? points[hoverIdx] : null;

  // Screen-reader summary of the series (the SVG is otherwise opaque to AT).
  const fmtV = formatMax ?? String;
  const firstLabel = data[0].label ?? data[0].date ?? 'start';
  const lastLabel = data[data.length - 1].label ?? data[data.length - 1].date ?? 'end';
  const chartLabel = `Line chart, ${data.length} points from ${firstLabel} to ${lastLabel}. Minimum ${fmtV(dataMin)}, maximum ${fmtV(dataMax)}, latest ${fmtV(data[data.length - 1].value)}.`;

  // Single full-chart overlay rect drives hover + click via the nearest-X
  // point. Avoids the mouseleave/mouseenter flicker that per-point hit
  // circles produce on dense charts where targets overlap.
  function nearestIndex(clientX: number): number {
    const wrap = wrapperRef.current;
    if (!wrap) return 0;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0) return 0;
    // Subtract the inset so a click at the visual line position maps to the
    // right bucket (the data spans PAD_X..w-PAD_X in viewBox units).
    const padPx = (PAD_X / w) * rect.width;
    const usablePx = rect.width - 2 * padPx;
    if (usablePx <= 0) return 0;
    const px = Math.max(0, Math.min(usablePx, clientX - rect.left - padPx));
    const i = Math.round((px / usablePx) * (data.length - 1));
    return Math.max(0, Math.min(data.length - 1, i));
  }

  // Tooltip placement: always above the dot. To avoid clipping at the chart
  // edges, the tooltip's horizontal translate scales with its x position —
  // -50% (centered) in the middle, smoothly approaching 0% (left edge of
  // tooltip on dot) near the left and -100% (right edge on dot) near the
  // right. This keeps every dot's tooltip at a distinct position, unlike
  // a hard clamp which makes the last few dots all stack on the same x.
  let tooltipNode: ReactNode = null;
  if (hovered && hoveredPt) {
    const xPct = (hoveredPt[0] / w) * 100;
    tooltipNode = (
      <div
        role="tooltip"
        style={{
          position: 'absolute',
          left: `${xPct}%`,
          top: hoveredPt[1] - 10,
          transform: `translate(-${xPct}%, -100%)`,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 6px 16px rgba(15,23,42,0.08)',
          padding: '6px 10px',
          fontSize: 11,
          color: 'var(--text)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        {renderTooltip ? renderTooltip(hovered) : (
          <>
            <div style={{ fontWeight: 600 }}>{hovered.label ?? hovered.date}</div>
            <div style={{ color: 'var(--text-muted)' }}>{hovered.value}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} style={{ width: '100%', position: 'relative' }}>
      {formatMax && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            fontSize: 10,
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          {formatMax(max)}
        </div>
      )}
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={chartLabel}
        style={{
          width: '100%',
          height,
          display: 'block',
          overflow: 'visible',
          cursor: onPointClick ? 'pointer' : 'default',
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {dashedTail && (() => {
          const lastX = points[points.length - 1][0];
          const lastY = points[points.length - 1][1];
          // Extend half a step past the last actual point so the tail
          // visibly leans into the gutter without overflowing the SVG
          // bounds. `step` is the data-point spacing in viewBox units.
          const tipX = Math.min(w - 1, lastX + step / 2);
          const tipY = height - padY - ((dashedTail.toValue - min) / range) * (height - padY * 2);
          return (
            <path
              d={`M ${lastX},${lastY} L ${tipX},${tipY}`}
              fill="none"
              stroke={color}
              strokeOpacity={0.5}
              strokeWidth="1.5"
              strokeDasharray="3 3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })()}
        <rect
          x={PAD_X}
          y={0}
          width={usableW}
          height={height}
          fill="transparent"
          onMouseMove={(e) => setHoverIdx(nearestIndex(e.clientX))}
          onMouseLeave={() => setHoverIdx(null)}
          onClick={(e) => {
            if (!onPointClick) return;
            const i = nearestIndex(e.clientX);
            onPointClick(data[i], i);
          }}
        />
      </svg>
      {/*
        Markers are HTML overlays, not SVG circles. The SVG uses
        preserveAspectRatio="none", which stretches the X axis ~15× to fill
        the card width — that turned `<circle>` markers into horizontal
        dashes. Positioning the dots as absolutely-placed DOM elements keeps
        them perfectly circular regardless of the SVG aspect ratio.
      */}
      {points.map(([x, y], i) => {
        const isHover = hoverIdx === i;
        const size = isHover ? 8 : 6;
        return (
          <span
            key={i}
            aria-hidden
            style={{
              position: 'absolute',
              left: `${(x / w) * 100}%`,
              top: y,
              width: size,
              height: size,
              borderRadius: '50%',
              background: color,
              boxShadow: isHover ? `0 0 0 3px ${color}33` : 'none',
              transform: 'translate(-50%, -50%)',
              transition: 'width 120ms ease-out, height 120ms ease-out, box-shadow 120ms ease-out',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        );
      })}
      {tooltipNode}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: `4px ${PAD_X}% 0`,
          fontSize: 10,
          color: 'var(--text-muted)',
        }}
      >
        {labelItems.map((d, i) => (
          <span key={i}>{d.label ?? (d.date ? new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')}</span>
        ))}
      </div>
    </div>
  );
}
