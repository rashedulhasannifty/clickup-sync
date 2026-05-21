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
}

export function LineChart({
  data,
  color = 'var(--accent)',
  height = 160,
  onPointClick,
  renderTooltip,
}: LineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // A stable per-instance id so multiple LineCharts on the same page
  // don't collide on the gradient `id` (which previously keyed only on
  // data length + height, so two adjacent charts of the same shape
  // shared a gradient).
  const gradId = `lg-${useId()}`;

  if (!data || data.length < 2) return <ChartEmpty height={height} />;

  const max = Math.max(...data.map(d => d.value));
  const min = Math.min(...data.map(d => d.value));
  const range = max - min || 1;
  const w = 100;
  const padY = 8;
  const step = w / (data.length - 1);
  const points = data.map((d, i) => [i * step, height - padY - ((d.value - min) / range) * (height - padY * 2)] as [number, number]);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const area = `${path} L ${w} ${height} L 0 ${height} Z`;
  const labelStep = Math.max(1, Math.floor(data.length / 6));
  const labelItems = data.filter((_, i) => i % labelStep === 0);

  const hovered = hoverIdx != null ? data[hoverIdx] : null;
  const hoveredPt = hoverIdx != null ? points[hoverIdx] : null;

  // Single full-chart overlay <rect> drives hover + click via the nearest-X
  // point. This avoids the mouseleave/mouseenter flicker that per-point hit
  // circles produce on dense (30+) charts when the mouse crosses the seam
  // between two adjacent targets.
  function nearestIndex(clientX: number): number {
    const wrap = wrapperRef.current;
    if (!wrap) return 0;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0) return 0;
    const px = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const i = Math.round((px / rect.width) * (data.length - 1));
    return Math.max(0, Math.min(data.length - 1, i));
  }

  // Tooltip placement: clamp horizontally so first/last points don't clip,
  // and flip below the dot when the point sits in the top quarter of the
  // chart so the tooltip doesn't get pulled above the container.
  let tooltipNode: ReactNode = null;
  if (hovered && hoveredPt) {
    const xPct = (hoveredPt[0] / w) * 100;
    // Approximate tooltip half-width as a percent of container width. With a
    // small tooltip and a typical chart >200px wide, ~12% is conservative.
    const clampedX = Math.max(12, Math.min(88, xPct));
    const flipBelow = hoveredPt[1] < height * 0.25;
    tooltipNode = (
      <div
        role="tooltip"
        style={{
          position: 'absolute',
          left: `${clampedX}%`,
          top: flipBelow ? hoveredPt[1] + 8 : hoveredPt[1] - 6,
          transform: flipBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 6px 16px rgba(15,23,42,0.08)',
          padding: '6px 10px',
          fontSize: 11,
          color: 'var(--text)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 1,
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
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
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
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          const isHover = hoverIdx === i;
          return (
            <circle
              key={i}
              cx={p[0]}
              cy={p[1]}
              r={isHover ? '2.4' : '1.4'}
              fill={color}
              style={{ transition: 'r 120ms ease-out', pointerEvents: 'none' }}
            />
          );
        })}
        {/*
          One transparent rect on top of the chart captures hover and click.
          Nearest-X lookup is done by reading the wrapper div's bounding rect.
          This is the standard pattern for dense SVG line charts — avoids the
          flicker that per-point hit circles produce when targets overlap.
        */}
        <rect
          x={0}
          y={0}
          width={w}
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
      {tooltipNode}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 0', fontSize: 10, color: 'var(--text-muted)' }}>
        {labelItems.map((d, i) => (
          <span key={i}>{d.label ?? (d.date ? new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')}</span>
        ))}
      </div>
    </div>
  );
}
