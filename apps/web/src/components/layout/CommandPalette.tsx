import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const NAV_ITEMS = [
  { label: 'Overview', to: '/overview' },
  { label: 'Tasks', to: '/tasks' },
  { label: 'Time Entries', to: '/time-entries' },
  { label: 'Missing Rates', to: '/missing-rates' },
  { label: 'Assignee Rates', to: '/assignee-rates' },
  { label: 'Spaces', to: '/spaces' },
  { label: 'Sync Logs', to: '/sync-logs' },
  { label: 'Settings', to: '/settings' },
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

  const filtered = NAV_ITEMS.filter(item =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );

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
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(v => Math.min(v + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(v => Math.max(v - 1, 0)); }
      if (e.key === 'Enter' && filtered[active]) { select(filtered[active].to); }
      if (e.key === 'Escape') { onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, active, select, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" style={{ animation: 'fadeIn 0.1s ease' }}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden" style={{ animation: 'modalIn 0.15s ease' }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-soft)]">
          <span className="text-[var(--text-faint)]">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            placeholder="Search pages…"
            className="flex-1 bg-transparent outline-none text-[var(--text)] placeholder:text-[var(--text-faint)] text-sm"
          />
          <span className="text-[var(--text-faint)] text-xs">Esc</span>
        </div>
        <div className="py-1 max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[var(--text-faint)]">No results</div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.to}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors ${i === active ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text)] hover:bg-[var(--hover)]'}`}
                onClick={() => select(item.to)}
                onMouseEnter={() => setActive(i)}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
