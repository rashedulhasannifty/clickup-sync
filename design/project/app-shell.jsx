// App shell: sidebar nav, top bar, global filters, theme system, router

const ROUTES = [
  { id: 'overview', label: 'Overview', icon: 'Home', path: '/overview' },
  { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', path: '/tasks' },
  { id: 'time-entries', label: 'Time Entries', icon: 'Clock', path: '/time-entries' },
  { id: 'missing-rates', label: 'Missing Rates', icon: 'AlertTriangle', path: '/missing-rates', badgeKey: 'missing_rate_count' },
  { id: 'assignee-rates', label: 'Assignee Rates', icon: 'DollarSign', path: '/assignee-rates' },
  { id: 'spaces', label: 'Spaces', icon: 'Layers', path: '/spaces' },
  { id: 'sync-logs', label: 'Sync Logs', icon: 'Webhook', path: '/sync-logs' },
  { id: 'settings', label: 'Settings', icon: 'Settings', path: '/settings' },
];

// Simple hash-based router
function useRoute() {
  const [hash, setHash] = React.useState(() => window.location.hash || '#/overview');
  React.useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/overview');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const path = hash.replace(/^#/, '') || '/overview';
  const navigate = (to) => { window.location.hash = '#' + to; };
  return { path, navigate };
}

// Tweaks defaults
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "gradient",
  "density": "compact",
  "theme": "light",
  "sidebarStyle": "expanded",
  "showWelcomeBanner": true
}/*EDITMODE-END*/;

const ACCENT_PRESETS = {
  gradient: {
    accent: '#7B68EE',
    accentHover: '#6953dc',
    accentSoft: 'rgb(123 104 238 / 0.10)',
    accentStrong: '#5b48c9',
    grad: 'linear-gradient(120deg, #FF02F0 0%, #7B68EE 50%, #49CCF9 100%)',
  },
  purple: {
    accent: '#7C3AED',
    accentHover: '#6D28D9',
    accentSoft: 'rgb(124 58 237 / 0.10)',
    accentStrong: '#6D28D9',
    grad: 'linear-gradient(120deg, #7C3AED 0%, #5B21B6 100%)',
  },
  slate: {
    accent: '#0F172A',
    accentHover: '#1e293b',
    accentSoft: 'rgb(15 23 42 / 0.07)',
    accentStrong: '#0F172A',
    grad: 'linear-gradient(120deg, #334155 0%, #0F172A 100%)',
  },
  blue: {
    accent: '#2563EB',
    accentHover: '#1D4ED8',
    accentSoft: 'rgb(37 99 235 / 0.10)',
    accentStrong: '#1D4ED8',
    grad: 'linear-gradient(120deg, #3B82F6 0%, #1E40AF 100%)',
  },
};

// Global filters store
function useGlobalFilters() {
  const [dateRange, setDateRange] = React.useState('30d');
  const [space, setSpace] = React.useState('all');
  return { dateRange, setDateRange, space, setSpace };
}

const FilterContext = React.createContext(null);
const useFilters = () => React.useContext(FilterContext);

// Sidebar
function Sidebar({ collapsed, onToggle, currentPath, navigate }) {
  const counts = window.MOCK.OVERVIEW_METRICS;
  return (
    <aside style={{
      width: collapsed ? 60 : 232, flexShrink: 0,
      borderRight: '1px solid var(--border)',
      background: 'var(--sidebar-bg)',
      display: 'flex', flexDirection: 'column',
      transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      position: 'sticky', top: 0, height: '100vh',
    }}>
      {/* Logo */}
      <div style={{
        height: 56, padding: collapsed ? '0 12px' : '0 16px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: 'var(--accent-grad)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: '-0.02em',
          boxShadow: '0 2px 6px rgba(123, 104, 238, 0.32)',
        }}>C</div>
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>ClickUp Sync</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.2, fontWeight: 500 }}>operations console</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {!collapsed && (
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 10px 4px' }}>
            Workspace
          </div>
        )}
        {ROUTES.map(r => {
          const Ic = window.Icons[r.icon];
          const active = currentPath === r.path || currentPath.startsWith(r.path + '/');
          const badge = r.badgeKey === 'missing_rate_count' && counts.missing_rate_count > 0 ? counts.missing_rate_count : null;
          return (
            <button
              key={r.id}
              onClick={() => navigate(r.path)}
              title={collapsed ? r.label : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: collapsed ? '8px 10px' : '7px 10px',
                fontSize: 13, fontWeight: 500,
                color: active ? 'var(--text)' : 'var(--text-muted)',
                background: active ? 'var(--sidebar-active-bg)' : 'transparent',
                border: 0, borderRadius: 7,
                cursor: 'pointer', position: 'relative',
                justifyContent: collapsed ? 'center' : 'flex-start',
                transition: 'all 100ms',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--hover)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              {active && !collapsed && (
                <span style={{ position: 'absolute', left: -8, top: 6, bottom: 6, width: 2, borderRadius: 999, background: 'var(--accent)' }}/>
              )}
              <Ic size={16}/>
              {!collapsed && <span style={{ flex: 1, textAlign: 'left' }}>{r.label}</span>}
              {!collapsed && badge && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
                  background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
                  fontVariantNumeric: 'tabular-nums',
                }}>{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
        {!collapsed ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: 8, borderRadius: 8,
            background: 'var(--muted-bg)',
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'linear-gradient(135deg, #1f2937, #4b5563)',
              color: '#fff', fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>NS</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Noor Sayed</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>admin@nifty.co</div>
            </div>
            <button onClick={onToggle} style={{
              border: 0, background: 'transparent', color: 'var(--text-muted)',
              cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 4,
            }}>
              <Icons.PanelLeft size={14}/>
            </button>
          </div>
        ) : (
          <button onClick={onToggle} style={{
            width: '100%', padding: '8px',
            border: 0, background: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icons.PanelLeft size={16}/>
          </button>
        )}
      </div>
    </aside>
  );
}

// Top Bar
function TopBar({ onToggleTheme, theme, onOpenCommand, navigate }) {
  const filters = useFilters();
  const lastSync = window.MOCK.OVERVIEW_METRICS.last_sync_at;
  return (
    <header style={{
      height: 56, padding: '0 18px', flexShrink: 0,
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
      display: 'flex', alignItems: 'center', gap: 10,
      position: 'sticky', top: 0, zIndex: 30, backdropFilter: 'blur(8px)',
    }}>
      {/* Search trigger */}
      <button onClick={onOpenCommand} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        height: 32, padding: '0 10px', minWidth: 280,
        background: 'var(--muted-bg)', color: 'var(--text-muted)',
        border: '1px solid var(--border)', borderRadius: 7,
        cursor: 'pointer', fontSize: 13,
      }}>
        <Icons.Search size={14}/>
        <span style={{ flex: 1, textAlign: 'left' }}>Search tasks, assignees, events…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div style={{ flex: 1 }}/>

      {/* Date range */}
      <Select
        size="sm"
        icon={<Icons.Calendar size={13}/>}
        value={filters.dateRange}
        onChange={filters.setDateRange}
        options={[
          { value: '24h', label: 'Last 24 hours' },
          { value: '7d', label: 'Last 7 days' },
          { value: '30d', label: 'Last 30 days' },
          { value: '90d', label: 'Last 90 days' },
          { value: 'custom', label: 'Custom range…' },
        ]}
      />

      {/* Space filter */}
      <Select
        size="sm"
        icon={<Icons.Layers size={13}/>}
        value={filters.space}
        onChange={filters.setSpace}
        options={[
          { value: 'all', label: 'All spaces' },
          ...window.MOCK.SPACES.map(s => ({ value: s.id, label: s.name })),
        ]}
      />

      <div style={{ height: 20, width: 1, background: 'var(--border)' }}/>

      {/* Sync status */}
      <button onClick={() => navigate('/sync-logs')} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 10px', borderRadius: 7,
        background: 'var(--pill-green-bg)', color: 'var(--pill-green-text)',
        border: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: 999, background: '#10b981',
          boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.18)',
          animation: 'pulse 2s infinite',
        }}/>
        Synced {fmt.relative(lastSync)}
      </button>

      <Tooltip label={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
        <button onClick={onToggleTheme} style={{
          width: 32, height: 32, border: '1px solid var(--border)',
          background: 'var(--surface)', color: 'var(--text)',
          borderRadius: 7, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {theme === 'dark' ? <Icons.Sun size={14}/> : <Icons.Moon size={14}/>}
        </button>
      </Tooltip>

      <button style={{
        width: 32, height: 32, border: '1px solid var(--border)',
        background: 'var(--surface)', color: 'var(--text-muted)',
        borderRadius: 7, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <Icons.Bell size={14}/>
        <span style={{ position: 'absolute', top: 4, right: 5, width: 6, height: 6, borderRadius: 999, background: 'var(--amber)' }}/>
      </button>
    </header>
  );
}

// Command palette (cmd+k)
function CommandPalette({ open, onClose, navigate }) {
  const [q, setQ] = React.useState('');
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);
  const items = React.useMemo(() => {
    const navItems = ROUTES.map(r => ({ kind: 'nav', label: `Go to ${r.label}`, sub: r.path, action: () => navigate(r.path), icon: window.Icons[r.icon] }));
    const taskItems = window.MOCK.TASKS.slice(0, 30).map(t => ({ kind: 'task', label: t.task_name, sub: `${t.task_id} · ${t.space_name}`, action: () => { navigate(`/tasks/${t.task_id}`); }, icon: window.Icons.CheckSquare }));
    const assigneeItems = window.MOCK.ASSIGNEES.map(a => ({ kind: 'assignee', label: a.name, sub: a.email, action: () => navigate('/assignee-rates'), icon: window.Icons.Users }));
    return [...navItems, ...taskItems, ...assigneeItems];
  }, [navigate]);
  const filtered = q
    ? items.filter(i => (i.label + ' ' + i.sub).toLowerCase().includes(q.toLowerCase())).slice(0, 12)
    : items.slice(0, 8);
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '120px 24px 24px' }}>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)',
        animation: 'fadeIn 120ms ease-out',
      }}/>
      <div style={{
        position: 'relative', width: 580, maxWidth: '100%',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(15, 23, 42, 0.18)',
        animation: 'modalIn 180ms ease-out',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Icons.Search size={16}/>
          <input
            ref={inputRef}
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search tasks, assignees, navigate…"
            style={{ flex: 1, border: 0, outline: 0, fontSize: 14, background: 'transparent', color: 'var(--text)' }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              No matches for "{q}"
            </div>
          ) : filtered.map((item, i) => {
            const Ic = item.icon;
            return (
              <button key={i} onClick={() => { item.action(); onClose(); }} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '8px 10px', fontSize: 13, color: 'var(--text)',
                background: 'transparent', border: 0, borderRadius: 6, cursor: 'pointer', textAlign: 'left',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{Ic && <Ic size={14}/>}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{item.sub}</span>
              </button>
            );
          })}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
          <span><Kbd>↑↓</Kbd> navigate</span>
          <span><Kbd>↵</Kbd> select</span>
          <span><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ROUTES, useRoute, ACCENT_PRESETS, TWEAK_DEFAULTS, useGlobalFilters, FilterContext, useFilters, Sidebar, TopBar, CommandPalette });
