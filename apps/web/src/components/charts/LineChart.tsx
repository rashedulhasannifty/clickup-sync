import { useState } from 'react';
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
  renderTooltip?: (d: LineData) => React.ReactNode;
}

export function LineChart({
  data,
  color = 'var(--accent)',
  height = 160,
  onPointClick,
  renderTooltip,
}: LineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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
  const gradId = `lg-${data.length}-${Math.round(height)}`;
  const labelStep = Math.max(1, Math.floor(data.length / 6));
  const labelItems = data.filter((_, i) => i % labelStep === 0);

  // Tooltip position: the hovered point in viewBox coords (0..100, 0..height).
  // We render an absolutely-positioned div on top of the SVG using percent x
  // and pixel y, so it scales with the SVG width.
  const hovered = hoverIdx != null ? data[hoverIdx] : null;
  const hoveredPt = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
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
            <g key={i}>
              {/* Larger invisible hit target so taps/clicks land reliably */}
              <circle
                cx={p[0]}
                cy={p[1]}
                r="4"
                fill="transparent"
                style={{ cursor: onPointClick ? 'pointer' : 'default' }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={() => onPointClick?.(data[i], i)}
              />
              <circle
                cx={p[0]}
                cy={p[1]}
                r={isHover ? '2.4' : '1.4'}
                fill={color}
                style={{ transition: 'r 120ms ease-out', pointerEvents: 'none' }}
              />
            </g>
          );
        })}
      </svg>
      {hovered && hoveredPt && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: `${(hoveredPt[0] / w) * 100}%`,
            top: hoveredPt[1] - 6,
            transform: 'translate(-50%, -100%)',
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
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 0', fontSize: 10, color: 'var(--text-muted)' }}>
        {labelItems.map((d, i) => (
          <span key={i}>{d.label ?? (d.date ? new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')}</span>
        ))}
      </div>
    </div>
  );
}
