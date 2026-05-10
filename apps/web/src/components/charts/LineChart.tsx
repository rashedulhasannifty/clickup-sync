import { ChartEmpty } from './ChartEmpty';

interface LineData { date: string; value: number; }

export function LineChart({ data, color = 'var(--accent)', height = 120 }: { data: LineData[]; color?: string; height?: number }) {
  if (data.length < 2) return <ChartEmpty height={height} />;

  const w = 300;
  const pad = { top: 8, bottom: 20, left: 4, right: 4 };
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values) || 1;

  function px(i: number) { return pad.left + (i / (data.length - 1)) * innerW; }
  function py(v: number) { return pad.top + innerH - ((v - min) / (max - min)) * innerH; }

  const pts = data.map((d, i) => `${px(i)},${py(d.value)}`).join(' ');
  const areaPath = `M${px(0)},${py(data[0].value)} ` + data.slice(1).map((d, i) => `L${px(i + 1)},${py(d.value)}`).join(' ') + ` L${px(data.length - 1)},${pad.top + innerH} L${px(0)},${pad.top + innerH} Z`;

  const gradId = `lg-${Math.random().toString(36).slice(2)}`;

  const labelStep = Math.ceil(data.length / 5);
  const labels = data.filter((_d, i) => i % labelStep === 0 || i === data.length - 1);

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {labels.map((d, i) => {
        const idx = data.indexOf(d);
        return (
          <text key={i} x={px(idx)} y={height - 4} textAnchor="middle" fontSize={9} fill="var(--text-faint)">
            {new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </text>
        );
      })}
    </svg>
  );
}
