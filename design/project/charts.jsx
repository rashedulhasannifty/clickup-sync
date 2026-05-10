// Lightweight SVG charts — bar, donut, line. No deps.

function BarChart({ data, height = 180, color, accent, horizontal = false, formatValue, max: _max }) {
  if (!data || data.length === 0) return <ChartEmpty/>;
  const values = data.map(d => d.value);
  const max = _max ?? Math.max(...values);
  const colorOf = (d, i) => d.color || (accent ? 'var(--accent)' : ['#7B68EE','#FF02F0','#49CCF9','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'][i % 8]);

  if (horizontal) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((d, i) => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ width: 110, color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {d.label}
            </span>
            <div style={{ flex: 1, height: 8, background: 'var(--muted-bg)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: colorOf(d, i), borderRadius: 999, transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)' }}/>
            </div>
            <span style={{ width: 60, textAlign: 'right', color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {formatValue ? formatValue(d.value) : d.value}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Vertical bars
  const padX = 8, padY = 12;
  const w = 100;
  const barW = (w - padX * 2) / data.length;
  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - padY * 2);
          const x = padX + i * barW + barW * 0.15;
          const y = height - padY - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW * 0.7} height={h} rx={1} fill={colorOf(d, i)} opacity={0.9}>
                <title>{d.label}: {d.value}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px 0', fontSize: 10, color: 'var(--text-muted)' }}>
        {data.map((d, i) => (
          <span key={i} style={{ flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function DonutChart({ data, size = 160, thickness = 16, centerLabel, centerValue }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <ChartEmpty/>;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--muted-bg)" strokeWidth={thickness}/>
          {data.map((d, i) => {
            const len = (d.value / total) * c;
            const dash = `${len} ${c - len}`;
            const dashOffset = -offset;
            offset += len;
            return (
              <circle key={i} cx={size/2} cy={size/2} r={r}
                fill="none" stroke={d.color} strokeWidth={thickness}
                strokeDasharray={dash} strokeDashoffset={dashOffset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${size/2} ${size/2})`}
                style={{ transition: 'stroke-dasharray 400ms' }}
              >
                <title>{d.label}: {d.value}</title>
              </circle>
            );
          })}
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 0,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{centerLabel}</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>{centerValue ?? total}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, flex: 1, minWidth: 140 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }}/>
            <span style={{ flex: 1, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
            <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ data, height = 160, color = 'var(--accent)', formatValue, areaColor }) {
  if (!data || data.length < 2) return <ChartEmpty/>;
  const max = Math.max(...data.map(d => d.value));
  const min = Math.min(...data.map(d => d.value));
  const range = max - min || 1;
  const w = 100;
  const padY = 8;
  const step = w / (data.length - 1);
  const points = data.map((d, i) => [i * step, height - padY - ((d.value - min) / range) * (height - padY * 2)]);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const area = `${path} L ${w} ${height} L 0 ${height} Z`;
  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`area-grad-${data.length}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={areaColor || color} stopOpacity="0.18"/>
            <stop offset="100%" stopColor={areaColor || color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#area-grad-${data.length})`}/>
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
        {points.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="1.4" fill={color}>
            <title>{data[i].label}: {data[i].value}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 0', fontSize: 10, color: 'var(--text-muted)' }}>
        {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function ChartEmpty() {
  return (
    <div style={{
      height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-faint)', fontSize: 12,
    }}>No data</div>
  );
}

Object.assign(window, { BarChart, DonutChart, LineChart });
