import { Sparkline } from './Sparkline';

interface MetricCardProps {
  label: string;
  value: string | number;
  delta?: number;
  trend?: number[];
  accent?: boolean;
  dense?: boolean;
  onClick?: () => void;
  sub?: string;
}

export function MetricCard({ label, value, delta, trend, accent, dense, onClick, sub }: MetricCardProps) {
  const isPositive = delta !== undefined && delta >= 0;
  return (
    <div
      className={`rounded-[var(--radius-lg)] border ${dense ? 'p-3' : 'p-4'} flex flex-col gap-1 ${onClick ? 'cursor-pointer hover:border-[var(--border-strong)] transition-colors' : ''}`}
      style={{ background: accent ? 'var(--accent)' : 'var(--surface)', borderColor: accent ? 'transparent' : 'var(--border)', color: accent ? 'white' : 'var(--text)' }}
      onClick={onClick}
    >
      <p className="text-xs font-medium" style={{ color: accent ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)' }}>{label}</p>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className={`font-bold leading-none ${dense ? 'text-xl' : 'text-2xl'}`}>{value}</p>
          {sub && <p className="text-xs mt-0.5" style={{ color: accent ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>{sub}</p>}
          {delta !== undefined && (
            <p className="text-xs mt-1" style={{ color: accent ? 'rgba(255,255,255,0.8)' : isPositive ? 'var(--green)' : 'var(--red)' }}>
              {isPositive ? '↑' : '↓'} {Math.abs(delta)}%
            </p>
          )}
        </div>
        {trend && <Sparkline data={trend} color={accent ? 'rgba(255,255,255,0.6)' : 'var(--accent)'} />}
      </div>
    </div>
  );
}
