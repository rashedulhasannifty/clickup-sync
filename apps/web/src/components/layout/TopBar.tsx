import { Select } from '../ui/Select';
import { Kbd } from '../ui/Kbd';
import { useGlobalFilters, type DateRange } from '../../hooks/useGlobalFilters';
import { useSyncHealth } from '../../hooks/useReports';

const SPACES = [
  { value: 'all', label: 'All Spaces' },
  { value: '3577824', label: 'Digital Marketing' },
  { value: '3589129', label: 'R&D Apps' },
  { value: '3525433', label: 'Projects' },
];

const DATE_RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
}

export function TopBar({ onSearchClick }: { onSearchClick?: () => void }) {
  const { dateRange, space, setDateRange, setSpace } = useGlobalFilters();
  const { data: health } = useSyncHealth();

  const allFresh = health?.every((h: { status: string }) => h.status === 'Fresh');
  const anyStale = health?.some((h: { status: string }) => h.status === 'Stale');
  const syncColor = allFresh ? 'var(--green)' : anyStale ? 'var(--amber)' : 'var(--text-faint)';
  const syncLabel = allFresh ? 'All synced' : anyStale ? 'Stale' : 'Unknown';

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border-soft)] flex items-center gap-2 px-4 py-2.5" style={{ background: 'var(--surface)' }}>
      {/* Search trigger */}
      <button
        onClick={onSearchClick}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-muted)] bg-[var(--muted-bg)] border border-[var(--border)] rounded-[var(--radius)] hover:border-[var(--border-strong)] transition-colors min-w-36"
      >
        <span>🔍</span>
        <span className="flex-1 text-left">Search…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="flex items-center gap-2 ml-auto">
        <Select options={DATE_RANGES} value={dateRange} onChange={v => setDateRange(v as DateRange)} />
        <Select options={SPACES} value={space} onChange={setSpace} />

        {/* Sync status */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: 'var(--muted-bg)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: syncColor }} />
          <span style={{ color: syncColor }}>{syncLabel}</span>
        </div>

        {/* Theme toggle */}
        <button onClick={toggleTheme} className="p-1.5 rounded-[var(--radius)] text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] transition-colors" title="Toggle theme">
          ◑
        </button>
      </div>
    </header>
  );
}
