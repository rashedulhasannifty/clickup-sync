import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Home, BarChart3, CheckSquare, Clock, AlertTriangle, DollarSign,
  Layers, Webhook, ShieldCheck, Settings, PanelLeft, type LucideIcon,
} from 'lucide-react';
import { useStats } from '../../hooks/useReports';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export function Sidebar({ onCommandPalette: _onCommandPalette }: { onCommandPalette?: () => void }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');
  const { data: stats } = useStats();

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(collapsed));
  }, [collapsed]);

  const navItems: NavItem[] = [
    { to: '/overview',       label: 'Overview',       icon: Home },
    { to: '/analytics',      label: 'Analytics',      icon: BarChart3 },
    { to: '/tasks',          label: 'Tasks',          icon: CheckSquare },
    { to: '/time-entries',   label: 'Time Entries',   icon: Clock },
    { to: '/missing-rates',  label: 'Missing Rates',  icon: AlertTriangle, badge: stats?.missingRateEntries },
    { to: '/assignee-rates', label: 'Assignee Rates', icon: DollarSign },
    { to: '/spaces',         label: 'Spaces',         icon: Layers },
    { to: '/sync-logs',      label: 'Sync Logs',      icon: Webhook },
    { to: '/audit-log',      label: 'Audit Log',      icon: ShieldCheck },
    { to: '/settings',       label: 'Settings',       icon: Settings },
  ];

  return (
    <aside style={{
      width: collapsed ? 60 : 232,
      flexShrink: 0,
      borderRight: '1px solid var(--border)',
      background: 'var(--sidebar-bg)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      position: 'sticky',
      top: 0,
      height: '100vh',
    }}>
      {/* Logo */}
      <div style={{
        height: 56,
        padding: collapsed ? '0 12px' : '0 16px',
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
      <nav style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', overflowX: 'hidden' }}>
        {!collapsed && (
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 10px 4px' }}>
            Workspace
          </div>
        )}
        {navItems.map(item => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: collapsed ? '8px 10px' : '7px 10px',
                fontSize: 13, fontWeight: 500,
                color: isActive ? 'var(--text)' : 'var(--text-muted)',
                background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
                borderRadius: 7,
                textDecoration: 'none',
                position: 'relative',
                justifyContent: collapsed ? 'center' : 'flex-start',
                transition: 'all 100ms',
              })}
            >
              {({ isActive }) => (
                <>
                  {isActive && !collapsed && (
                    <span style={{ position: 'absolute', left: -8, top: 6, bottom: 6, width: 2, borderRadius: 999, background: 'var(--accent)' }} />
                  )}
                  <Icon size={16} strokeWidth={1.75} style={{ flexShrink: 0 }} />
                  {!collapsed && <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>}
                  {!collapsed && item.badge && item.badge > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
                      background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>{item.badge > 99 ? '99+' : item.badge}</span>
                  )}
                </>
              )}
            </NavLink>
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
              flexShrink: 0,
            }}>A</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Admin</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>API key auth</div>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 4 }}
            >
              <PanelLeft size={14} strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCollapsed(false)}
            style={{
              width: '100%', padding: '8px',
              border: 0, background: 'transparent', color: 'var(--text-muted)',
              cursor: 'pointer', borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <PanelLeft size={16} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </aside>
  );
}
