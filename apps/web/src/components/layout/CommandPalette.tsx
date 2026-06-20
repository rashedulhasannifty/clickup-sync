import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home, BarChart3, Activity, CheckSquare, Clock, AlertTriangle, DollarSign,
  Layers, Webhook, Settings, Search, Wallet, Users, ScrollText,
} from 'lucide-react';
import { Kbd } from '../ui/Kbd';
import { useSearch } from '../../hooks/useSearch';
import { useAuth } from '../../hooks/useAuth';

const NAV_ITEMS: { label: string; to: string; sub: string; icon: typeof Home; adminOnly?: boolean }[] = [
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
  { label: 'Team', to: '/team', sub: '/team', icon: Users, adminOnly: true },
  { label: 'Audit Log', to: '/audit-log', sub: '/audit-log', icon: ScrollText, adminOnly: true },
  { label: 'Settings', to: '/settings', sub: '/settings', icon: Settings, adminOnly: true },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

type Action = { key: string; label: string; sub: string; icon: typeof Home; run: () => void };

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results } = useSearch(debounced);

  const select = useCallback((to: string) => {
    navigate(to);
    onClose();
    setQuery('');
  }, [navigate, onClose]);

  const filtered = useMemo<Action[]>(() => {
    const q = query.trim().toLowerCase();
    const nav: Action[] = NAV_ITEMS
      .filter((r) => !r.adminOnly || hasRole('ADMIN'))
      .filter((r) => !q || (r.label + ' ' + r.sub).toLowerCase().includes(q))
      .map((r) => ({ key: 'nav:' + r.to, label: `Go to ${r.label}`, sub: r.sub, icon: r.icon, run: () => select(r.to) }));

    if (q.length < 2) return nav.slice(0, 8);

    const taskActions: Action[] = (results?.tasks ?? []).map((t) => ({
      key: 'task:' + t.taskId,
      label: t.taskName,
      sub: t.client ? `Task · ${t.client}` : 'Task',
      icon: CheckSquare,
      run: () => select(`/tasks?taskIds=${encodeURIComponent(t.taskId)}`),
    }));
    const assigneeActions: Action[] = (results?.assignees ?? []).map((a) => ({
      key: 'assignee:' + a.userId,
      label: a.name ?? a.userId,
      sub: a.email ?? 'Assignee',
      icon: DollarSign,
      run: () => select(`/assignee-rates?userId=${encodeURIComponent(a.userId)}`),
    }));

    return [...taskActions, ...assigneeActions, ...nav].slice(0, 20);
  }, [query, results, select, hasRole]);

  // Keep the active item visible when keyboard nav moves it past the fold.
  useEffect(() => {
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [active]);

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
        filtered[active].run();
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, active, onClose]);

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
        <div ref={listRef} role="listbox" aria-label="Results" style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
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
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={item.run}
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
