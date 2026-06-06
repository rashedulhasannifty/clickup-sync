import { useMemo, useState } from 'react';
import { Search, Moon, Sun, Bell, Calendar, Layers } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Kbd } from '../ui/Kbd';
import { UserMenu } from './UserMenu';
import { useGlobalFilters, type DateRange } from '../../hooks/useGlobalFilters';
import { useSpaces, useSyncHealth } from '../../hooks/useReports';
import { fmt } from '../../lib/formatters';

// Spaces in the project's CLICKUP_SPACES config. Used as a fallback label so
// the three primary spaces always render with their friendly names even if the
// /reports/spaces aggregate hasn't loaded yet, and so they appear in the
// dropdown even when they have no synced data.
const CONFIGURED_SPACES: { id: string; name: string }[] = [
  { id: '3577824', name: 'Digital Marketing' },
  { id: '3589129', name: 'R&D Apps' },
  { id: '3525433', name: 'Projects' },
];

const DATE_RANGES = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range…' },
];

function IconSelect({ icon: Icon, options, value, onChange }: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <Icon size={13} strokeWidth={1.75} style={{ position: 'absolute', left: 8, pointerEvents: 'none', color: 'var(--text-muted)', zIndex: 1 }} />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          appearance: 'none',
          paddingLeft: 26,
          paddingRight: 28,
          height: 28,
          fontSize: 12,
          fontWeight: 500,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 7,
          color: 'var(--text)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <svg style={{ position: 'absolute', right: 8, pointerEvents: 'none', color: 'var(--text-muted)', display: 'flex' }} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6"/></svg>
    </div>
  );
}

function DateInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        height: 28,
        fontSize: 12,
        fontWeight: 500,
        padding: '0 8px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 7,
        color: 'var(--text)',
        fontFamily: 'inherit',
        cursor: 'pointer',
        width: 140,
      }}
    />
  );
}

export function TopBar({ onSearchClick }: { onSearchClick?: () => void }) {
  const navigate = useNavigate();
  const { dateRange, space, setDateRange, setSpace, customFrom, customTo, setCustomFrom, setCustomTo } = useGlobalFilters();
  const { data: health } = useSyncHealth();
  const { data: spacesData } = useSpaces();
  const [isDark, setIsDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');

  // Build the space dropdown from actual aggregated data merged with configured
  // spaces. This surfaces any unconfigured space (e.g. a ClickUp space whose
  // tasks landed in our DB via webhook but isn't in CLICKUP_SPACES) so the user
  // can actually filter to it. If ClickUp returned no space.name for a task,
  // we render "Space {id}" instead of a bare ID so it doesn't look like a typo.
  const spaceOptions = useMemo(() => {
    type Row = { spaceId: string | null; spaceName: string | null };
    const rows: Row[] = Array.isArray(spacesData) ? (spacesData as Row[]) : [];
    const opts: { value: string; label: string }[] = [{ value: 'all', label: 'All spaces' }];
    const seen = new Set<string>(['all']);
    for (const cfg of CONFIGURED_SPACES) {
      const hit = rows.find((r) => r.spaceId === cfg.id);
      const label = hit?.spaceName?.trim() || cfg.name;
      opts.push({ value: cfg.id, label });
      seen.add(cfg.id);
    }
    for (const r of rows) {
      const id = r.spaceId?.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const label = (r.spaceName ?? '').trim() || `Space ${id}`;
      opts.push({ value: id, label });
    }
    return opts;
  }, [spacesData]);

  function toggleTheme() {
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setIsDark(!isDark);
  }

  // Defensively coerce: if the API returned an error envelope / HTML / unexpected
  // shape, `health` may be a non-array truthy value (e.g. a string) and `.every`
  // would crash this whole component.
  const healthItems: { status: string; lastSuccessfulSyncAt?: string | null }[] =
    Array.isArray(health) ? health : [];
  const lastSyncAt = healthItems[0]?.lastSuccessfulSyncAt ?? null;
  const allFresh = healthItems.length > 0 && healthItems.every((h) => h.status === 'Fresh');

  return (
    <header style={{
      height: 56,
      padding: '0 18px',
      flexShrink: 0,
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
      display: 'flex', alignItems: 'center', gap: 10,
      position: 'sticky', top: 0, zIndex: 30,
      backdropFilter: 'blur(8px)',
      flexWrap: dateRange === 'custom' ? 'wrap' : 'nowrap',
      rowGap: 8,
    }}>
      {/* Search trigger */}
      <button
        type="button"
        onClick={onSearchClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: 32, padding: '0 10px', minWidth: 280,
          background: 'var(--muted-bg)', color: 'var(--text-muted)',
          border: '1px solid var(--border)', borderRadius: 7,
          cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
        }}
      >
        <Search size={14} strokeWidth={1.75} />
        <span style={{ flex: 1, textAlign: 'left' }}>Search tasks, assignees, events…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div style={{ flex: 1 }} />

      <IconSelect icon={Calendar} options={DATE_RANGES} value={dateRange} onChange={v => setDateRange(v as DateRange)} />

      {/* Custom date range inputs */}
      {dateRange === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DateInput value={customFrom} onChange={setCustomFrom} placeholder="From" />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→</span>
          <DateInput value={customTo} onChange={setCustomTo} placeholder="To" />
        </div>
      )}

      <IconSelect icon={Layers} options={spaceOptions} value={space} onChange={setSpace} />

      {/* Divider */}
      <div style={{ height: 20, width: 1, background: 'var(--border)', flexShrink: 0 }} />

      {/* Sync status */}
      <button
        type="button"
        onClick={() => navigate('/sync-logs')}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 7,
          background: 'var(--pill-green-bg)', color: 'var(--pill-green-text)',
          border: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600,
          fontFamily: 'inherit',
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: 999, background: '#10b981',
          boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.18)',
          animation: 'pulse 2s infinite',
          flexShrink: 0,
        }} />
        {lastSyncAt ? `Synced ${fmt.relative(lastSyncAt)}` : allFresh ? 'All synced' : 'Syncing…'}
      </button>

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        style={{
          width: 32, height: 32, border: '1px solid var(--border)',
          background: 'var(--surface)', color: 'var(--text)',
          borderRadius: 7, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
        title={isDark ? 'Light mode' : 'Dark mode'}
      >
        {isDark ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
      </button>

      {/* Bell */}
      <button
        style={{
          width: 32, height: 32, border: '1px solid var(--border)',
          background: 'var(--surface)', color: 'var(--text-muted)',
          borderRadius: 7, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          position: 'relative',
        }}
        title="Notifications"
        type="button"
      >
        <Bell size={14} strokeWidth={1.75} />
        <span style={{ position: 'absolute', top: 4, right: 5, width: 6, height: 6, borderRadius: 999, background: 'var(--amber)' }} />
      </button>

      {/* Divider */}
      <div style={{ height: 20, width: 1, background: 'var(--border)', flexShrink: 0 }} />

      {/* Account menu (avatar → dropdown with identity + sign out) */}
      <UserMenu />
    </header>
  );
}
