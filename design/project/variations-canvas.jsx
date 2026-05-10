// Variations canvas — side-by-side options for Overview KPIs and Missing Rates

function VariationsCanvas() {
  // Light theme inside canvas regardless of app theme so canvas reads correctly
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f0eee9', overflow: 'hidden', zIndex: 50 }} data-theme="light">
      <CanvasTopbar/>
      <DesignCanvas>
        <DCSection id="overview" title="Overview · KPI strip" subtitle="Three takes on how the dashboard greets you.">
          <DCArtboard id="ov-cards" label="A · KPI cards (current)" width={760} height={220}>
            <KPIVariantA/>
          </DCArtboard>
          <DCArtboard id="ov-strip" label="B · Compact strip" width={760} height={220}>
            <KPIVariantB/>
          </DCArtboard>
          <DCArtboard id="ov-hero" label="C · Hero metric + sparks" width={760} height={220}>
            <KPIVariantC/>
          </DCArtboard>
        </DCSection>

        <DCSection id="missing" title="Missing Rates · layout" subtitle="Both styles ship — pick the default.">
          <DCArtboard id="mr-cards" label="A · Grouped cards" width={760} height={520}>
            <MissingVariantA/>
          </DCArtboard>
          <DCArtboard id="mr-queue" label="B · Triage queue" width={760} height={520}>
            <MissingVariantB/>
          </DCArtboard>
          <DCArtboard id="mr-split" label="C · Split list + detail" width={760} height={520}>
            <MissingVariantC/>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </div>
  );
}

function CanvasTopbar() {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
      height: 48, padding: '0 16px',
      background: 'rgba(255, 255, 255, 0.92)', backdropFilter: 'blur(8px)',
      borderBottom: '1px solid rgba(0,0,0,0.08)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <button onClick={() => { window.location.hash = '#/overview'; }} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 30, padding: '0 12px', borderRadius: 7,
        background: 'transparent', border: '1px solid rgba(0,0,0,0.12)',
        color: '#29261b', fontSize: 12, fontWeight: 500, cursor: 'pointer',
      }}>
        <Icons.ChevronRight size={12} style={{ transform: 'rotate(180deg)' }}/> Back to app
      </button>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#29261b' }}>Variations canvas</div>
      <div style={{ fontSize: 12, color: 'rgba(60,50,40,0.6)' }}>· drag to reorder · click to focus</div>
    </div>
  );
}

// ============= Variant frame =============
function VFrame({ children, accent = '#7B68EE' }) {
  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'hidden',
      background: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
      color: '#0f172a', fontSize: 13,
      ['--accent']: accent,
    }}>{children}</div>
  );
}

// =============================================================
// Overview KPI variants
// =============================================================

const OV_METRICS = [
  { label: 'Tasks synced', value: '4,182', delta: '+128', tone: 'green' },
  { label: 'Hours (30d)', value: '2,847', delta: '+12%', tone: 'green' },
  { label: 'Labor cost', value: '$167.4k', delta: '+9%', tone: 'green' },
  { label: 'Missing rates', value: '23', delta: '+5', tone: 'amber' },
];

function KPIVariantA() {
  return (
    <VFrame>
      <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {OV_METRICS.map(m => (
          <div key={m.label} style={{
            padding: 14, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff',
          }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{m.value}</div>
            <div style={{ fontSize: 11, color: m.tone === 'green' ? '#0a7a44' : '#a16207', marginTop: 2, fontWeight: 500 }}>{m.delta} vs prev</div>
          </div>
        ))}
      </div>
    </VFrame>
  );
}

function KPIVariantB() {
  return (
    <VFrame>
      <div style={{ padding: 18 }}>
        <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
          {OV_METRICS.map((m, i) => (
            <div key={m.label} style={{
              flex: 1, padding: '14px 18px',
              borderRight: i < 3 ? '1px solid #f1f5f9' : 0,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: m.tone === 'green' ? '#10b981' : '#f59e0b' }}/>
                {m.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{m.value}</div>
              <div style={{ fontSize: 11, color: m.tone === 'green' ? '#0a7a44' : '#a16207', fontWeight: 500 }}>{m.delta}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Compact one-row strip — saves ~80px of vertical space.</div>
      </div>
    </VFrame>
  );
}

function KPIVariantC() {
  return (
    <VFrame>
      <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12 }}>
        <div style={{
          padding: 16, borderRadius: 12,
          background: 'linear-gradient(120deg, #FF02F0 0%, #7B68EE 60%, #49CCF9 100%)',
          color: '#fff', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Labor cost · last 30 days</div>
          <div style={{ fontSize: 36, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>$167,420</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>+9% vs prior period · 2,847 hours tracked</div>
          {/* sparkline */}
          <svg viewBox="0 0 200 40" style={{ position: 'absolute', right: 14, bottom: 14, width: 180, height: 40, opacity: 0.85 }}>
            <polyline points="0,30 20,28 40,25 60,22 80,18 100,20 120,15 140,12 160,8 180,10 200,4"
              fill="none" stroke="#fff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
          </svg>
        </div>
        <div style={{ display: 'grid', gridTemplateRows: 'repeat(3, 1fr)', gap: 6 }}>
          {OV_METRICS.slice(0, 3).map(m => (
            <div key={m.label} style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>{m.label}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{m.value}</span>
            </div>
          ))}
        </div>
      </div>
    </VFrame>
  );
}

// =============================================================
// Missing Rates variants
// =============================================================

const MR_PEOPLE = [
  { name: 'Maya Chen', email: 'maya@acme.co', color: '#a78bfa', count: 14, hours: 38.5, sev: 'high' },
  { name: 'Diego Alvarez', email: 'diego@acme.co', color: '#fb7185', count: 9, hours: 22.0, sev: 'medium' },
  { name: 'Priya Raman', email: 'priya@acme.co', color: '#34d399', count: 6, hours: 14.5, sev: 'medium' },
  { name: 'Tomás Vidal', email: 'tomas@acme.co', color: '#60a5fa', count: 3, hours: 7.0, sev: 'low' },
];

const sevColor = (s) => s === 'high' ? '#dc2626' : s === 'medium' ? '#d97706' : '#94a3b8';
const sevBg = (s) => s === 'high' ? '#fef2f2' : s === 'medium' ? '#fef3c7' : '#f1f5f9';
const sevText = (s) => s === 'high' ? '#991b1b' : s === 'medium' ? '#92400e' : '#475569';

function Av({ p, size = 32 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: 999,
      background: p.color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 600, flexShrink: 0,
    }}>{p.name.split(' ').map(s => s[0]).slice(0,2).join('')}</span>
  );
}

function MissingVariantA() {
  return (
    <VFrame>
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Missing rates</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{MR_PEOPLE.length} assignees · {MR_PEOPLE.reduce((s,p)=>s+p.count,0)} entries</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {MR_PEOPLE.map(p => (
            <div key={p.name} style={{
              padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff',
              borderLeft: `3px solid ${sevColor(p.sev)}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Av p={p}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{p.email}</div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
                  background: sevBg(p.sev), color: sevText(p.sev),
                }}>{p.sev}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
                <div style={{ padding: 8, background: '#f8fafc', borderRadius: 6 }}>
                  <div style={{ fontSize: 9, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Entries</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{p.count}</div>
                </div>
                <div style={{ padding: 8, background: '#f8fafc', borderRadius: 6 }}>
                  <div style={{ fontSize: 9, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Hours</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{p.hours.toFixed(1)}h</div>
                </div>
              </div>
              <button style={{
                width: '100%', marginTop: 10, padding: '6px 8px', fontSize: 11, fontWeight: 600,
                background: '#7B68EE', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer',
              }}>+ Add rate</button>
            </div>
          ))}
        </div>
      </div>
    </VFrame>
  );
}

function MissingVariantB() {
  return (
    <VFrame>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>Triage queue</div>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
          {MR_PEOPLE.map((p, i) => (
            <div key={p.name} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px',
              borderTop: i ? '1px solid #f1f5f9' : 0,
            }}>
              <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: sevColor(p.sev) }}/>
              <Av p={p} size={28}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{p.name}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                    background: sevBg(p.sev), color: sevText(p.sev), textTransform: 'uppercase',
                  }}>{p.sev}</span>
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{p.email}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{p.count} entries</div>
                <div style={{ fontSize: 11, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{p.hours.toFixed(1)}h</div>
              </div>
              <button style={{
                padding: '6px 10px', fontSize: 11, fontWeight: 600,
                background: '#7B68EE', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer',
              }}>+ Add rate</button>
            </div>
          ))}
        </div>
      </div>
    </VFrame>
  );
}

function MissingVariantC() {
  return (
    <VFrame>
      <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1fr', height: '100%' }}>
        <div style={{ borderRight: '1px solid #f1f5f9', overflow: 'auto' }}>
          <div style={{ padding: '14px 14px 8px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Missing rates</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{MR_PEOPLE.length} assignees</div>
          </div>
          {MR_PEOPLE.map((p, i) => (
            <div key={p.name} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px',
              borderTop: '1px solid #f1f5f9',
              background: i === 0 ? '#f5f3ff' : '#fff',
              borderLeft: i === 0 ? '3px solid #7B68EE' : '3px solid transparent',
            }}>
              <Av p={p} size={26}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{p.name}</div>
                <div style={{ fontSize: 10, color: '#64748b' }}>{p.count} entries · {p.hours.toFixed(1)}h</div>
              </div>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: sevColor(p.sev) }}/>
            </div>
          ))}
        </div>
        <div style={{ padding: 18, overflow: 'auto', background: '#fafafa' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <Av p={MR_PEOPLE[0]} size={42}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{MR_PEOPLE[0].name}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{MR_PEOPLE[0].email}</div>
            </div>
            <button style={{
              padding: '8px 14px', fontSize: 12, fontWeight: 600,
              background: '#7B68EE', color: '#fff', border: 0, borderRadius: 7, cursor: 'pointer',
            }}>+ Add rate</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
            {[['Entries', '14'], ['Hours', '38.5h'], ['Est. cost', '~$1,617']].map(([l, v]) => (
              <div key={l} style={{ padding: 10, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{l}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Affected tasks</div>
          {['CU-3104 · Q3 reporting refactor', 'CU-3211 · Webhook reliability spike', 'CU-3299 · Auth migration follow-up', 'CU-3340 · Customer migration tools'].map(t => (
            <div key={t} style={{
              padding: '8px 10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
              fontSize: 12, color: '#0f172a', marginBottom: 4,
            }}>{t}</div>
          ))}
        </div>
      </div>
    </VFrame>
  );
}

window.VariationsCanvas = VariationsCanvas;
