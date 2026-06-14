import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home, BarChart3, Activity, CheckSquare, Clock, AlertTriangle, DollarSign,
  Layers, Webhook, Settings, Search, Wallet,
} from 'lucide-react';
import { Kbd } from '../ui/Kbd';

const NAV_ITEMS: { label: string; to: string; sub: string; icon: typeof Home }[] = [
  { label: 'Overview', to: '/overview', sub: '/overview', icon: Home },
  { label: 'Analytics', to: '/analytics', sub: '/analytics', icon: BarChart3 },
  { label: 'Time Spikes', to: '/time-spikes', sub: '/time-spikes', icon: Activity },
  { label: 'Tasks', to: '/tasks', sub: '/tasks', icon: CheckSquare },
  { label: 'Time Entries', to: '/time-entries', sub: '/time-entries', icon: Clock },
  { label: 'Missing Rates', to: '/missing-rates', sub: '/missing-rates', icon: AlertTriangle },
  { label: 'Assignee Rates', to: '/assignee-rates', sub: '/assignee-rates', icon: DollarSign },
  { label: 'Budgets', to: '/budgets', sub: '/budgets', icon: Wallet },
  { label: 'Spaces', to: '/spaces', sub: '/spaces', icon: Layers },
  { label: 'Sync Logs', to: '/sync-logs', sub: '/sync-logs', icon: Webhook },
  { label: 'Settings', to: '/settings', sub: '/settings', icon: Settings },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() =>
    NAV_ITEMS.map(r => ({
      label: `Go to ${r.label}`,
      sub: r.sub,
      to: r.to,
      icon: r.icon,
    })),
  []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? items.filter(i => (i.label + ' ' + i.sub).toLowerCase().includes(q)).slice(0, 12)
      : items.slice(0, 8);
    return list;
  }, [items, query]);

  const select = useCallback((to: string) => {
    navigate(to);
    onClose();
    setQuery('');
  }, [navigate, onClose]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(v => Math.min(v + 1, Math.max(filtered.length - 1, 0)));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(v => Math.max(v - 1, 0));
      }
      if (e.key === 'Enter' && filtered[active]) {
        select(filtered[active].to);
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, active, select, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '120px 24px 24px',
      }}
    >
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)',
          animation: 'fadeIn 120ms ease-out',
        }}
      />
      <div
        style={{
          position: 'relative', width: 580, maxWidth: '100%',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(15, 23, 42, 0.18)',
          animation: 'modalIn 180ms ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Search size={16} strokeWidth={1.75} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            placeholder="Search tasks, assignees, navigate…"
            style={{ flex: 1, border: 0, outline: 0, fontSize: 14, background: 'transparent', color: 'var(--text)', fontFamily: 'inherit' }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              No matches for &quot;{query}&quot;
            </div>
          ) : (
            filtered.map((item, i) => {
              const Ic = item.icon;
              const isActive = i === active;
              return (
                <button
                  key={item.to + item.label}
                  type="button"
                  onClick={() => select(item.to)}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '8px 10px', fontSize: 13, color: 'var(--text)',
                    background: isActive ? 'var(--hover)' : 'transparent',
                    border: 0, borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', display: 'flex' }}>
                    <Ic size={14} strokeWidth={1.75} />
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                    {item.sub}
                  </span>
                </button>
              );
            })
          )}
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
