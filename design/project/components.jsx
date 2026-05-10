// Shared UI components: cards, badges, tables, drawers, formatters

const cn = (...args) => args.filter(Boolean).join(' ');

// === Formatters ===
const fmt = {
  money: (cents, currency = 'USD') => {
    if (cents == null) return '—';
    const n = cents / 100;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
  },
  number: (n) => n == null ? '—' : new Intl.NumberFormat('en-US').format(n),
  hours: (h) => h == null ? '—' : `${h.toFixed(1)}h`,
  shortHours: (h) => h == null ? '—' : h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`,
  relative: (iso) => {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  },
  date: (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
  shortDate: (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—',
  dateTime: (iso) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—',
  time: (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—',
};

// === Status Badge ===
function StatusBadge({ status, color, type, size = 'sm' }) {
  const map = {
    'open': { bg: 'rgb(148 163 184 / 0.15)', text: 'rgb(71 85 105)', dark: { bg: 'rgb(148 163 184 / 0.2)', text: 'rgb(203 213 225)' } },
    'in progress': { bg: 'rgb(59 130 246 / 0.12)', text: 'rgb(29 78 216)', dark: { bg: 'rgb(59 130 246 / 0.2)', text: 'rgb(147 197 253)' } },
    'in review': { bg: 'rgb(168 85 247 / 0.12)', text: 'rgb(126 34 206)', dark: { bg: 'rgb(168 85 247 / 0.2)', text: 'rgb(216 180 254)' } },
    'blocked': { bg: 'rgb(239 68 68 / 0.12)', text: 'rgb(185 28 28)', dark: { bg: 'rgb(239 68 68 / 0.2)', text: 'rgb(252 165 165)' } },
    'closed': { bg: 'rgb(16 185 129 / 0.12)', text: 'rgb(4 120 87)', dark: { bg: 'rgb(16 185 129 / 0.2)', text: 'rgb(110 231 183)' } },
    'archived': { bg: 'rgb(100 116 139 / 0.15)', text: 'rgb(71 85 105)', dark: { bg: 'rgb(100 116 139 / 0.2)', text: 'rgb(148 163 184)' } },
  };
  const s = map[status] || map['open'];
  const px = size === 'xs' ? '5px 8px' : '5px 10px';
  return (
    <span className="status-badge" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: px, borderRadius: 999,
      background: `var(--badge-bg, ${s.bg})`,
      color: `var(--badge-text, ${s.text})`,
      fontSize: size === 'xs' ? 10 : 11, fontWeight: 600, lineHeight: 1,
      letterSpacing: '0.02em', textTransform: 'capitalize',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color || s.text }}/>
      {status}
    </span>
  );
}

// === Pill (general purpose) ===
function Pill({ children, tone = 'gray', size = 'sm', icon }) {
  const tones = {
    gray:    { bg: 'var(--pill-gray-bg)', text: 'var(--pill-gray-text)' },
    green:   { bg: 'var(--pill-green-bg)', text: 'var(--pill-green-text)' },
    amber:   { bg: 'var(--pill-amber-bg)', text: 'var(--pill-amber-text)' },
    red:     { bg: 'var(--pill-red-bg)', text: 'var(--pill-red-text)' },
    blue:    { bg: 'var(--pill-blue-bg)', text: 'var(--pill-blue-text)' },
    purple:  { bg: 'var(--pill-purple-bg)', text: 'var(--pill-purple-text)' },
    accent:  { bg: 'var(--accent-soft)', text: 'var(--accent-strong)' },
  };
  const t = tones[tone] || tones.gray;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: size === 'xs' ? '2px 6px' : '3px 8px',
      borderRadius: 6,
      background: t.bg, color: t.text,
      fontSize: size === 'xs' ? 10 : 11,
      fontWeight: 600, lineHeight: 1.4, letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
    }}>
      {icon}{children}
    </span>
  );
}

// === Avatar ===
function Avatar({ user, size = 24, ring = false }) {
  if (!user) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: 999,
      background: user.color || '#94a3b8',
      color: '#fff', fontSize: size <= 20 ? 9 : size <= 28 ? 10 : 12, fontWeight: 700,
      letterSpacing: '0.02em',
      flexShrink: 0,
      boxShadow: ring ? '0 0 0 2px var(--surface)' : 'none',
    }}>
      {user.initials || (user.name || '?').slice(0, 2).toUpperCase()}
    </span>
  );
}

function AvatarStack({ users, size = 22, max = 3 }) {
  const shown = users.slice(0, max);
  const overflow = users.length - max;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((u, i) => (
        <span key={u.id || i} style={{ marginLeft: i === 0 ? 0 : -6 }}>
          <Avatar user={u} size={size} ring/>
        </span>
      ))}
      {overflow > 0 && (
        <span style={{
          marginLeft: -6, width: size, height: size, borderRadius: 999,
          background: 'var(--muted-bg)', color: 'var(--muted-text)',
          fontSize: size <= 22 ? 9 : 10, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 0 2px var(--surface)',
        }}>
          +{overflow}
        </span>
      )}
    </span>
  );
}

// === MetricCard ===
function MetricCard({ label, value, sublabel, delta, deltaTone, icon, accent = false, sparkline, onClick, dense = false }) {
  return (
    <button
      onClick={onClick}
      className="metric-card"
      style={{
        textAlign: 'left', cursor: onClick ? 'pointer' : 'default',
        background: accent ? 'var(--accent-card-bg)' : 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10, padding: dense ? '12px 14px' : '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 6,
        position: 'relative', overflow: 'hidden',
        transition: 'all 120ms',
      }}
    >
      {accent && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'var(--accent-grad)',
          opacity: 0.06, pointerEvents: 'none',
        }}/>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, position: 'relative' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
        {icon && <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{icon}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, position: 'relative' }}>
        <span style={{ fontSize: dense ? 22 : 26, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
        {sublabel && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sublabel}</span>}
      </div>
      {(delta || sparkline) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, position: 'relative' }}>
          {delta && (
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: deltaTone === 'down' ? 'var(--red)' : deltaTone === 'up' ? 'var(--green)' : 'var(--text-muted)',
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>
              {deltaTone === 'down' ? <Icons.TrendingDown size={12}/> : deltaTone === 'up' ? <Icons.TrendingUp size={12}/> : null}
              {delta}
            </span>
          )}
          {sparkline}
        </div>
      )}
    </button>
  );
}

// === Card container ===
function Card({ children, padding = 16, className, style, title, subtitle, action }) {
  return (
    <div className={cn('card', className)} style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      ...style,
    }}>
      {(title || action) && (
        <div style={{
          padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)', gap: 8,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            {title && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</div>}
            {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

// === Button ===
function Button({ children, variant = 'default', size = 'md', icon, iconRight, onClick, disabled, type = 'button', style, className, ...rest }) {
  const sizes = {
    sm: { padding: '5px 9px', fontSize: 12, gap: 5, height: 28 },
    md: { padding: '7px 12px', fontSize: 13, gap: 6, height: 32 },
    lg: { padding: '9px 16px', fontSize: 13, gap: 6, height: 36 },
    icon: { padding: 0, width: 32, height: 32, justifyContent: 'center' },
    iconSm: { padding: 0, width: 28, height: 28, justifyContent: 'center' },
  };
  const variants = {
    default: { bg: 'var(--surface)', text: 'var(--text)', border: 'var(--border)', hoverBg: 'var(--hover)' },
    primary: { bg: 'var(--text)', text: 'var(--surface)', border: 'transparent', hoverBg: 'var(--text)' },
    accent: { bg: 'var(--accent)', text: '#fff', border: 'transparent', hoverBg: 'var(--accent-hover)' },
    ghost: { bg: 'transparent', text: 'var(--text)', border: 'transparent', hoverBg: 'var(--hover)' },
    danger: { bg: 'transparent', text: 'var(--red)', border: 'var(--border)', hoverBg: 'rgb(239 68 68 / 0.08)' },
    subtle: { bg: 'var(--muted-bg)', text: 'var(--text)', border: 'transparent', hoverBg: 'var(--hover)' },
  };
  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.default;
  return (
    <button
      type={type} disabled={disabled} onClick={onClick} className={cn('btn', className)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: s.gap, ...s,
        background: v.bg, color: v.text,
        border: `1px solid ${v.border}`,
        borderRadius: 7, fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 100ms', whiteSpace: 'nowrap',
        '--btn-hover': v.hoverBg,
        ...style,
      }}
      {...rest}
    >
      {icon}{children}{iconRight}
    </button>
  );
}

// === Drawer ===
function Drawer({ open, onClose, children, width = 560, title }) {
  React.useEffect(() => {
    if (!open) return;
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'auto' }}>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0,
        background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(2px)',
        animation: 'fadeIn 150ms ease-out',
      }}/>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width,
        background: 'var(--surface)', borderLeft: '1px solid var(--border)',
        boxShadow: '-12px 0 32px rgba(15, 23, 42, 0.08)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 200ms ease-out',
      }}>
        {children}
      </div>
    </div>
  );
}

// === Modal ===
function Modal({ open = true, onClose, children, width = 480, title, subtitle }) {
  React.useEffect(() => {
    if (!open) return;
    const onEsc = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0,
        background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)',
        animation: 'fadeIn 150ms ease-out',
      }}/>
      <div style={{
        position: 'relative', width, maxWidth: '100%', maxHeight: '90vh',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: '0 24px 64px rgba(15, 23, 42, 0.18)',
        display: 'flex', flexDirection: 'column',
        animation: 'modalIn 180ms ease-out',
      }}>
        {(title || onClose) && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px 12px', borderBottom: title ? '1px solid var(--border-soft)' : 0 }}>
            <div style={{ flex: 1 }}>
              {title && <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{title}</div>}
              {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
            </div>
            {onClose && (
              <button onClick={onClose} style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 6 }}>
                <Icons.X size={16}/>
              </button>
            )}
          </div>
        )}
        <div style={{ padding: '14px 18px 18px', overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// === Empty state ===
function EmptyState({ icon, title, body, action }) {
  return (
    <div style={{
      padding: '48px 24px', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    }}>
      {icon && (
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: 'var(--muted-bg)', color: 'var(--text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
      )}
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {body && <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 360, lineHeight: 1.5 }}>{body}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

// === Skeleton ===
function Skeleton({ width = '100%', height = 14, radius = 4 }) {
  return <div style={{ width, height, borderRadius: radius, background: 'var(--skeleton)', backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }}/>;
}

// === Sparkline ===
function Sparkline({ data, color = 'var(--accent)', width = 80, height = 24 }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ');
  const last = data[data.length - 1];
  const lastY = height - ((last - min) / range) * (height - 4) - 2;
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={(data.length - 1) * step} cy={lastY} r="2" fill={color}/>
    </svg>
  );
}

// === KBD shortcut display ===
function Kbd({ children }) {
  return <kbd style={{
    fontFamily: 'inherit', fontSize: 10, fontWeight: 600,
    padding: '1px 5px', borderRadius: 4,
    background: 'var(--muted-bg)', color: 'var(--text-muted)',
    border: '1px solid var(--border)',
  }}>{children}</kbd>;
}

// === Section header ===
function SectionHeader({ title, action, description }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{title}</h2>
        {description && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{description}</p>}
      </div>
      {action}
    </div>
  );
}

// === Page header ===
function PageHeader({ title, description, breadcrumbs, actions, badge }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {breadcrumbs && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Icons.ChevronRight size={12}/>}
              {b.onClick ? (
                <button onClick={b.onClick} style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', fontSize: 'inherit' }}>{b.label}</button>
              ) : <span>{b.label}</span>}
            </React.Fragment>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>{title}</h1>
            {badge}
          </div>
          {description && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, maxWidth: 720 }}>{description}</p>}
        </div>
        {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{actions}</div>}
      </div>
    </div>
  );
}

// === Tooltip (very basic) ===
function Tooltip({ children, label }) {
  const [show, setShow] = React.useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          padding: '4px 8px', borderRadius: 6,
          background: 'var(--text)', color: 'var(--surface)',
          fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
          pointerEvents: 'none', zIndex: 100,
        }}>{label}</span>
      )}
    </span>
  );
}

// === Tabs ===
function Tabs({ value, onChange, items, variant = 'underline' }) {
  if (variant === 'segmented') {
    return (
      <div style={{
        display: 'inline-flex', gap: 2, padding: 3,
        background: 'var(--muted-bg)', borderRadius: 8,
      }}>
        {items.map(item => (
          <button key={item.value} onClick={() => onChange(item.value)} style={{
            padding: '5px 11px', fontSize: 12, fontWeight: 500,
            background: value === item.value ? 'var(--surface)' : 'transparent',
            color: value === item.value ? 'var(--text)' : 'var(--text-muted)',
            border: 0, borderRadius: 6, cursor: 'pointer',
            boxShadow: value === item.value ? '0 1px 2px rgba(15, 23, 42, 0.06)' : 'none',
            transition: 'all 100ms',
          }}>
            {item.label}
            {item.count != null && (
              <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{item.count}</span>
            )}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div style={{
      display: 'flex', gap: 4, borderBottom: '1px solid var(--border)',
    }}>
      {items.map(item => (
        <button key={item.value} onClick={() => onChange(item.value)} style={{
          padding: '8px 12px', fontSize: 13, fontWeight: 500,
          background: 'transparent',
          color: value === item.value ? 'var(--text)' : 'var(--text-muted)',
          border: 0, borderBottom: '2px solid',
          borderColor: value === item.value ? 'var(--accent)' : 'transparent',
          marginBottom: -1, cursor: 'pointer',
          transition: 'all 100ms',
        }}>
          {item.label}
          {item.count != null && (
            <span style={{
              marginLeft: 6, fontSize: 11, fontWeight: 600,
              padding: '1px 6px', borderRadius: 999,
              background: value === item.value ? 'var(--accent-soft)' : 'var(--muted-bg)',
              color: value === item.value ? 'var(--accent-strong)' : 'var(--text-muted)',
            }}>{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// === Switch ===
function Switch({ checked, onChange, label }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <span onClick={() => onChange(!checked)} style={{
        width: 30, height: 18, borderRadius: 999,
        background: checked ? 'var(--accent)' : 'var(--muted-bg)',
        border: '1px solid var(--border)',
        position: 'relative', transition: 'background 150ms',
        flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 1, left: checked ? 13 : 1,
          width: 14, height: 14, borderRadius: 999,
          background: '#fff',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.2)',
          transition: 'left 150ms',
        }}/>
      </span>
      {label && <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>}
    </label>
  );
}

// === Input ===
function Input({ icon, value, onChange, placeholder, type = 'text', size = 'md', style, ...rest }) {
  const sizes = {
    sm: { height: 28, fontSize: 12, padding: icon ? '0 8px 0 28px' : '0 8px' },
    md: { height: 32, fontSize: 13, padding: icon ? '0 10px 0 32px' : '0 10px' },
  };
  const s = sizes[size] || sizes.md;
  return (
    <div style={{ position: 'relative', display: 'inline-flex', flex: 1 }}>
      {icon && (
        <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
          {icon}
        </span>
      )}
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder}
        style={{
          width: '100%', ...s,
          background: 'var(--surface)', color: 'var(--text)',
          border: '1px solid var(--border)', borderRadius: 7,
          outline: 'none',
          ...style,
        }}
        {...rest}
      />
    </div>
  );
}

// === Select (custom dropdown) ===
function Select({ value, onChange, options, placeholder, size = 'md', icon, style }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  const selected = options.find(o => o.value === value);
  const sizes = {
    sm: { height: 28, fontSize: 12, padding: '0 28px 0 10px' },
    md: { height: 32, fontSize: 13, padding: '0 28px 0 10px' },
  };
  const s = sizes[size] || sizes.md;
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', ...style }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, ...s,
        background: 'var(--surface)', color: 'var(--text)',
        border: '1px solid var(--border)', borderRadius: 7,
        cursor: 'pointer', minWidth: 80, position: 'relative',
        whiteSpace: 'nowrap',
      }}>
        {icon && <span style={{ display: 'flex', color: 'var(--text-muted)' }}>{icon}</span>}
        <span style={{ flex: 1, textAlign: 'left', color: selected ? 'var(--text)' : 'var(--text-muted)' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ position: 'absolute', right: 8, color: 'var(--text-muted)', display: 'flex' }}>
          <Icons.ChevronDown size={14}/>
        </span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, minWidth: '100%',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 4,
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
          maxHeight: 280, overflowY: 'auto',
        }}>
          {options.map(opt => (
            <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              width: '100%', padding: '6px 8px', fontSize: 13, fontWeight: 500,
              background: opt.value === value ? 'var(--hover)' : 'transparent',
              color: 'var(--text)', border: 0, borderRadius: 5,
              cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
            }}>
              {opt.label}
              {opt.value === value && <Icons.CircleCheck size={14}/>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// === Field (label + control wrapper) ===
function Field({ label, hint, children, error }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</span>}
      {children}
      {error
        ? <span style={{ fontSize: 11, color: 'var(--red)' }}>{error}</span>
        : hint && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</span>}
    </label>
  );
}

// === Callout ===
function Callout({ tone = 'gray', icon, children }) {
  const tones = {
    gray:  { bg: 'var(--muted-bg)',          text: 'var(--text)',       accent: 'var(--text-muted)' },
    blue:  { bg: 'rgb(59 130 246 / 0.08)',   text: 'var(--text)',       accent: 'rgb(37 99 235)' },
    amber: { bg: 'rgb(245 158 11 / 0.10)',   text: 'var(--text)',       accent: 'rgb(202 138 4)' },
    red:   { bg: 'rgb(239 68 68 / 0.08)',    text: 'var(--text)',       accent: 'var(--red)' },
    green: { bg: 'rgb(34 197 94 / 0.08)',    text: 'var(--text)',       accent: 'rgb(22 163 74)' },
  }[tone] || { bg: 'var(--muted-bg)', text: 'var(--text)', accent: 'var(--text-muted)' };
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '10px 12px', borderRadius: 8,
      background: tones.bg, color: tones.text,
      fontSize: 12, lineHeight: 1.55,
    }}>
      {icon && <span style={{ color: tones.accent, display: 'flex', flexShrink: 0, marginTop: 1 }}>{icon}</span>}
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  );
}

Object.assign(window, {
  cn, fmt, StatusBadge, Pill, Avatar, AvatarStack, MetricCard, Card, Button,
  Drawer, Modal, EmptyState, Skeleton, Sparkline, Kbd, SectionHeader, PageHeader,
  Tooltip, Tabs, Switch, Input, Select, Field, Callout,
});
