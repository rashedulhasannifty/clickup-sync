import { ChartEmpty } from './ChartEmpty';
import { fmt } from '../../lib/formatters';

const PALETTE = ['#7B68EE','#FF02F0','#49CCF9','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

interface BarData { label: string; value: number; color?: string; }

interface BarChartProps {
  data: BarData[];
  direction?: 'vertical' | 'horizontal';
  height?: number;
  formatValue?: (v: number) => string;
}

export function BarChart({ data, direction = 'horizontal', height = 200, formatValue }: BarChartProps) {
  if (!data.length || data.every(d => d.value === 0)) return <ChartEmpty height={height} />;

  const fv = formatValue ?? ((v: number) => fmt.number(v));
  const max = Math.max(...data.map(d => d.value));

  if (direction === 'horizontal') {
    return (
      <div className="flex flex-col gap-2" style={{ minHeight: height }}>
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)] w-28 flex-shrink-0 truncate text-right">{d.label}</span>
            <div className="flex-1 bg-[var(--muted-bg)] rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? PALETTE[i % PALETTE.length] }}
              />
            </div>
            <span className="text-xs text-[var(--text-muted)] w-16 flex-shrink-0">{fv(d.value)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${data.length * 40} ${height}`} className="w-full" style={{ height }}>
      {data.map((d, i) => {
        const barH = max > 0 ? (d.value / max) * (height - 30) : 0;
        const x = i * 40 + 5;
        const y = height - 20 - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={30} height={barH} rx={2} fill={d.color ?? PALETTE[i % PALETTE.length]} />
            <text x={x + 15} y={height - 5} textAnchor="middle" fontSize={10} fill="var(--text-faint)">{d.label.slice(0, 6)}</text>
          </g>
        );
      })}
    </svg>
  );
}
