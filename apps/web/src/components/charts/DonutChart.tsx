import { ChartEmpty } from './ChartEmpty';

const PALETTE = ['#7B68EE','#FF02F0','#49CCF9','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

interface DonutData { label: string; value: number; color?: string; }

export function DonutChart({ data, size = 160, thickness = 14, centerLabel, centerValue }: {
  data: DonutData[]; size?: number; thickness?: number; centerLabel?: string; centerValue?: string | number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <ChartEmpty height={size} />;

  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        {/* Decorative — the adjacent legend conveys the same data as readable
            text, so hide the raw SVG circles from screen readers. */}
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--muted-bg)" strokeWidth={thickness}/>
          {data.map((d, i) => {
            const len = (d.value / total) * c;
            const dash = `${len} ${c - len}`;
            const dashOffset = -offset;
            offset += len;
            return (
              <circle key={i} cx={size/2} cy={size/2} r={r}
                fill="none"
                stroke={d.color ?? PALETTE[i % PALETTE.length]}
                strokeWidth={thickness}
                strokeDasharray={dash}
                strokeDashoffset={dashOffset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${size/2} ${size/2})`}
                style={{ transition: 'stroke-dasharray 400ms' }}
              >
                <title>{d.label}: {d.value}</title>
              </circle>
            );
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {centerLabel && <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{centerLabel}</div>}
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>{centerValue ?? total}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, flex: 1, minWidth: 140 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color ?? PALETTE[i % PALETTE.length], flexShrink: 0 }}/>
            <span style={{ flex: 1, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
            <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
