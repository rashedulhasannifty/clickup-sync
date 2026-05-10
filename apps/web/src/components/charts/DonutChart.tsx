import { ChartEmpty } from './ChartEmpty';

const PALETTE = ['#7B68EE','#FF02F0','#49CCF9','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

interface DonutData { label: string; value: number; color?: string; }

export function DonutChart({ data, size = 160, thickness = 28, centerLabel, centerValue }: {
  data: DonutData[]; size?: number; thickness?: number; centerLabel?: string; centerValue?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <ChartEmpty height={size} />;

  const r = (size - thickness) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = -circumference / 4;

  return (
    <div className="flex items-center gap-4">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {data.map((d, i) => {
            const frac = d.value / total;
            const dash = frac * circumference;
            const el = (
              <circle
                key={i}
                cx={cx} cy={cx} r={r}
                fill="none"
                stroke={d.color ?? PALETTE[i % PALETTE.length]}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                style={{ transition: 'stroke-dasharray 0.4s ease' }}
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        {(centerLabel || centerValue) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerValue && <span className="text-lg font-bold text-[var(--text)]">{centerValue}</span>}
            {centerLabel && <span className="text-xs text-[var(--text-muted)]">{centerLabel}</span>}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: d.color ?? PALETTE[i % PALETTE.length] }} />
            <span className="text-[var(--text-muted)] truncate">{d.label}</span>
            <span className="text-[var(--text)] font-medium ml-auto">{((d.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
