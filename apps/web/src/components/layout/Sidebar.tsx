import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Avatar } from '../ui/Avatar';
import { useStats } from '../../hooks/useReports';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: number;
}

function NavIcon({ icon }: { icon: string }) {
  return <span className="text-base leading-none flex-shrink-0 w-5 text-center">{icon}</span>;
}

export function Sidebar({ onCommandPalette: _onCommandPalette }: { onCommandPalette?: () => void }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');
  const { data: stats } = useStats();

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(collapsed));
  }, [collapsed]);

  const navItems: NavItem[] = [
    { to: '/overview', label: 'Overview', icon: '⊞' },
    { to: '/tasks', label: 'Tasks', icon: '☑' },
    { to: '/time-entries', label: 'Time Entries', icon: '◷' },
    { to: '/missing-rates', label: 'Missing Rates', icon: '⚠', badge: stats?.missingRateEntries },
    { to: '/assignee-rates', label: 'Assignee Rates', icon: '$' },
    { to: '/spaces', label: 'Spaces', icon: '⬡' },
    { to: '/sync-logs', label: 'Sync Logs', icon: '⟲' },
    { to: '/settings', label: 'Settings', icon: '⚙' },
  ];

  return (
    <aside
      className="flex flex-col flex-shrink-0 border-r border-[var(--border)] h-screen sticky top-0 transition-all duration-200"
      style={{ width: collapsed ? 60 : 232, background: 'var(--sidebar-bg)' }}
    >
      {/* Logo */}
      <div className="px-3 py-4 border-b border-[var(--border-soft)] flex items-center gap-2 overflow-hidden">
        <div className="w-7 h-7 rounded-lg flex-shrink-0" style={{ background: 'var(--accent-grad)' }} />
        {!collapsed && <span className="font-semibold text-[var(--text)] text-sm truncate">ClickUp Sync</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 mx-1.5 my-0.5 px-2.5 py-2 rounded-[var(--radius)] text-sm transition-colors relative ${isActive ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]'}`
            }
            style={({ isActive }) => isActive ? { background: 'var(--sidebar-active-bg)' } : {}}
          >
            <NavIcon icon={item.icon} />
            {!collapsed && <span className="truncate">{item.label}</span>}
            {item.badge !== undefined && item.badge > 0 && (
              <span className="ml-auto flex-shrink-0 px-1.5 py-0.5 text-xs font-medium rounded-full" style={{ background: 'var(--amber)', color: 'white', minWidth: 20, textAlign: 'center' }}>
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--border-soft)] p-2">
        <div className="flex items-center gap-2 px-1 py-1.5 overflow-hidden">
          <Avatar name="Admin" size="sm" />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--text)] truncate">Admin</p>
              <p className="text-xs text-[var(--text-faint)] truncate">API key auth</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(v => !v)}
            className="ml-auto flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded transition-colors"
          >
            {collapsed ? '→' : '←'}
          </button>
        </div>
      </div>
    </aside>
  );
}
