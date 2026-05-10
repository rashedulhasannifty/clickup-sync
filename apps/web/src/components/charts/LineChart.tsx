import { ChartEmpty } from './ChartEmpty';

interface LineData { label?: string; date?: string; value: number; }

export function LineChart({ data, color = 'var(--accent)', height = 160 }: { data: LineData[]; color?: string; height?: number }) {
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

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`}/>
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
        {points.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="1.4" fill={color}>
            <title>{data[i].label ?? data[i].date}: {data[i].value}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 0', fontSize: 10, color: 'var(--text-muted)' }}>
        {labelItems.map((d, i) => (
          <span key={i}>{d.label ?? (d.date ? new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')}</span>
        ))}
      </div>
    </div>
  );
}
