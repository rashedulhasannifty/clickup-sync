import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpaces } from '../hooks/useReports';
import { useBackfill } from '../hooks/useAdmin';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Tabs } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { DataTable } from '../components/ui/DataTable';
import type { Column } from '../components/ui/DataTable';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { fmt } from '../lib/formatters';

const PALETTE = ['#7B68EE', '#FF02F0', '#49CCF9', '#10b981', '#f59e0b', '#ef4444'];

// costAud from backend is already in dollars (divided by 100 server-side).
// fmt.money() also divides by 100, so pass dollars * 100 as cents.
function moneyAud(dollars: number): string {
  return fmt.money(Math.round(dollars * 100));
}

type SpaceRow = {
  spaceId: string;
  spaceName: string;
  taskCount: number;
  openCount: number;
  hoursLogged: number;
  costAud: number;
};

type TabKey = 'grid' | 'workload';

const TAB_ITEMS = [
  { key: 'grid' as TabKey, label: 'Grid' },
  { key: 'workload' as TabKey, label: 'Workload' },
];

function SpaceCard({ space, index }: { space: SpaceRow; index: number }) {
  const navigate = useNavigate();
  const backfill = useBackfill();
  const color = PALETTE[index % PALETTE.length];
  const openRatio = space.taskCount > 0 ? space.openCount / space.taskCount : 0;
  const initial = space.spaceName.charAt(0).toUpperCase();

  return (
    <div
      className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden flex flex-col"
      style={{ borderTop: `3px solid ${color}` }}
    >
      {/* Header */}
      <div className="p-4 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
          style={{ background: color }}
        >
          {initial}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-[var(--text)] truncate">{space.spaceName}</p>
          <p className="font-mono text-[10px] text-[var(--text-faint)] mt-0.5">{space.spaceId}</p>
        </div>
      </div>

      {/* Stats 2×2 */}
      <div className="border-t border-[var(--border-soft)] mx-4" />
      <div className="grid grid-cols-2 gap-3 px-4 py-3">
        <div>
          <p className="text-xs text-[var(--text-muted)]">Tasks</p>
          <p className="font-semibold text-[var(--text)]">{fmt.number(space.taskCount)}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Open</p>
          <p className="font-semibold text-[var(--text)]">{fmt.number(space.openCount)}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Hours</p>
          <p className="font-semibold text-[var(--text)]">{fmt.hours(space.hoursLogged)}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Cost</p>
          <p className="font-semibold text-[var(--text)]">{moneyAud(space.costAud)}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-3">
        <div className="h-1.5 bg-[var(--muted-bg)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${openRatio * 100}%`, background: color }}
          />
        </div>
        <p className="text-[10px] text-[var(--text-faint)] mt-1">
          {Math.round(openRatio * 100)}% open
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border-soft)] mt-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/tasks?spaceId=${space.spaceId}`)}
        >
          View Tasks
        </Button>
        <Button
          variant="ghost"
          size="sm"
          loading={backfill.isPending}
          onClick={() => backfill.mutate({ spaceId: space.spaceId })}
        >
          Backfill
        </Button>
      </div>
    </div>
  );
}

const workloadTableColumns: Column<SpaceRow & { color: string }>[] = [
  {
    key: 'spaceName',
    header: 'Space',
    render: (row) => (
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
          style={{ background: row.color }}
        />
        <span className="text-[var(--text)]">{row.spaceName}</span>
      </div>
    ),
  },
  {
    key: 'taskCount',
    header: 'Tasks',
    render: (row) => fmt.number(row.taskCount),
    sortable: true,
  },
  {
    key: 'openCount',
    header: 'Open',
    render: (row) => fmt.number(row.openCount),
    sortable: true,
  },
  {
    key: 'hoursLogged',
    header: 'Hours',
    render: (row) => fmt.hours(row.hoursLogged),
    sortable: true,
  },
  {
    key: 'costAud',
    header: 'Cost',
    render: (row) => moneyAud(row.costAud),
    sortable: true,
  },
];

function WorkloadView({ spaces }: { spaces: SpaceRow[] }) {
  const totalHours = spaces.reduce((s, r) => s + r.hoursLogged, 0);
  const tableData = spaces.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }));

  return (
    <Card>
      {/* Total hours header */}
      <div className="mb-4">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-1">
          Total Hours Across All Spaces
        </p>
        <p className="text-2xl font-bold text-[var(--text)]">{fmt.hours(totalHours)}</p>
      </div>

      {/* Stacked bar */}
      {totalHours > 0 && (
        <div className="mb-4">
          <div className="flex h-6 rounded-[var(--radius)] overflow-hidden gap-px">
            {spaces.map((s, i) => {
              const pct = totalHours > 0 ? (s.hoursLogged / totalHours) * 100 : 0;
              return (
                <div
                  key={s.spaceId}
                  title={`${s.spaceName}: ${fmt.hours(s.hoursLogged)}`}
                  style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }}
                />
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
            {spaces.map((s, i) => {
              const pct = totalHours > 0 ? (s.hoursLogged / totalHours) * 100 : 0;
              return (
                <div key={s.spaceId} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: PALETTE[i % PALETTE.length] }}
                  />
                  <span className="text-[var(--text-muted)]">{s.spaceName}</span>
                  <span className="text-[var(--text)] font-medium">{fmt.hours(s.hoursLogged)}</span>
                  <span className="text-[var(--text-faint)]">({pct.toFixed(0)}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <DataTable<SpaceRow & { color: string }>
        columns={workloadTableColumns}
        data={tableData}
        emptyTitle="No spaces found"
      />
    </Card>
  );
}

export function SpacesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('grid');
  const spaces = useSpaces();

  const spaceRows: SpaceRow[] = spaces.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Spaces"
        actions={
          <Tabs
            items={TAB_ITEMS}
            active={activeTab}
            onChange={(k) => setActiveTab(k as TabKey)}
            variant="segmented"
          />
        }
      />

      {spaces.isLoading ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 16,
          }}
        >
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} height={280} />
          ))}
        </div>
      ) : spaceRows.length === 0 ? (
        <EmptyState title="No spaces found" body="Spaces will appear here once data is synced." />
      ) : activeTab === 'grid' ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 16,
          }}
        >
          {spaceRows.map((space, i) => (
            <SpaceCard key={space.spaceId} space={space} index={i} />
          ))}
        </div>
      ) : (
        <WorkloadView spaces={spaceRows} />
      )}
    </div>
  );
}
