import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import type { Rate } from '../api/rates';
import { useRates } from '../hooks/useRates';
import { useStats } from '../hooks/useReports';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricCard } from '../components/ui/MetricCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Switch } from '../components/ui/Switch';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Pill';
import { DataTable } from '../components/ui/DataTable';
import type { Column } from '../components/ui/DataTable';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { RateModal } from '../components/RateModal';
import { fmt } from '../lib/formatters';

type RateRow = {
  id: string;
  assigneeId: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
  currency: string;
  hourlyRateCents: number;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

function toRateRow(r: Rate): RateRow {
  return r as RateRow;
}

export function AssigneeRatesPage() {
  const navigate = useNavigate();
  const { data: rates, isLoading } = useRates();
  const { data: statsData } = useStats();
  const missingRateEntries = (statsData as Record<string, number> | undefined)?.missingRateEntries ?? 0;
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedRate, setSelectedRate] = useState<Rate | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const allRates = rates ?? [];

  // KPI computations
  const activeRates = allRates.filter((r) => r.validTo === null);
  const activeRatesCount = activeRates.length;
  const coveredAssignees = new Set(allRates.map((r) => r.assigneeId)).size;
  const avgActiveRate =
    activeRates.length > 0
      ? activeRates.reduce((sum, r) => sum + r.hourlyRateCents, 0) / activeRates.length / 100
      : 0;

  // Client-side filtering
  const filtered = allRates.filter((r) => {
    if (activeOnly && r.validTo !== null) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (r.assigneeName ?? '').toLowerCase().includes(q) ||
        (r.assigneeEmail ?? '').toLowerCase().includes(q) ||
        r.assigneeId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group by assigneeId
  const grouped = new Map<string, Rate[]>();
  for (const r of filtered) {
    const existing = grouped.get(r.assigneeId) ?? [];
    existing.push(r);
    grouped.set(r.assigneeId, existing);
  }

  function openCreate() {
    setSelectedRate(null);
    setIsModalOpen(true);
  }

  function openEdit(rate: Rate) {
    setSelectedRate(rate);
    setIsModalOpen(true);
  }

  const rateColumns: Column<RateRow>[] = [
    {
      key: 'validFrom',
      header: 'From',
      render: (row) => <span className="text-xs">{fmt.date(row.validFrom)}</span>,
    },
    {
      key: 'validTo',
      header: 'To',
      render: (row) => (
        <span className="text-xs text-[var(--text-muted)]">
          {row.validTo ? fmt.date(row.validTo) : <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>— ongoing</span>}
        </span>
      ),
    },
    {
      key: 'hourlyRateCents',
      header: 'Rate',
      render: (row) => (
        <span className="text-sm font-mono">
          ${(row.hourlyRateCents / 100).toFixed(2)}/{row.currency.toLowerCase()}h
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.validTo === null ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--pill-green-text)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--pill-green-text)', fontWeight: 600 }}>active</span>
          </span>
        ) : (
          <Pill tone="gray">historical</Pill>
        ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      render: (row) => (
        <span className="text-xs text-[var(--text-muted)]">{fmt.relative(row.updatedAt)}</span>
      ),
    },
    {
      key: 'edit',
      header: '',
      render: (row) => (
        <button
          style={{ width: 28, height: 28, border: '1px solid var(--border)', background: 'transparent', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
          onClick={(e) => {
            e.stopPropagation();
            openEdit(row as Rate);
          }}
        >
          <Pencil size={13} strokeWidth={1.75} />
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Assignee Rates"
        description="Hourly cost rates by assignee. Used to compute labor cost for tracked time."
        actions={
          <>
            <Button variant="default" onClick={() => {}}>Export</Button>
            <Button variant="accent" onClick={openCreate}>New rate</Button>
          </>
        }
      />

      {/* KPI Cards */}
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}
      >
        <MetricCard label="Active rates" value={isLoading ? '—' : activeRatesCount} dense />
        <MetricCard label="Covered assignees" value={isLoading ? '—' : coveredAssignees} dense />
        <MetricCard
          label="Avg active rate"
          value={isLoading ? '—' : `$${avgActiveRate.toFixed(0)}/h`}
          dense
        />
        <MetricCard
          label="Without rate"
          value={isLoading ? '—' : missingRateEntries > 0 ? missingRateEntries : '0'}
          sublabel={missingRateEntries > 0 ? 'see Missing Rates' : undefined}
          dense
          onClick={() => navigate('/missing-rates')}
        />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search assignee…"
          style={{ width: 240 }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Switch checked={activeOnly} onChange={setActiveOnly} />
          <span>Active rates only</span>
        </label>
      </div>

      {/* Grouped by assignee */}
      {isLoading ? (
        <div className="flex flex-col gap-4">
          <Skeleton height={80} />
          <Skeleton height={80} />
        </div>
      ) : grouped.size === 0 ? (
        <EmptyState
          title="No rates found"
          body="Add an assignee rate to get started."
          action={
            <Button variant="accent" onClick={openCreate}>
              Add Rate
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(grouped.entries()).map(([assigneeId, assigneeRates]) => {
            const first = assigneeRates[0];
            const displayName = first.assigneeName ?? assigneeId;
            const activeRate = assigneeRates.find((r) => r.validTo === null);

            return (
              <div
                key={assigneeId}
                className="border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden"
              >
                {/* Assignee header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-[var(--surface-alt)] border-b border-[var(--border-soft)]">
                  <Avatar name={displayName} size="md" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{displayName}</div>
                    {first.assigneeEmail && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{first.assigneeEmail}</div>
                    )}
                  </div>
                  {activeRate && (
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current rate</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>${(activeRate.hourlyRateCents / 100).toFixed(2)}/h</div>
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => {
                      setSelectedRate(null);
                      setIsModalOpen(true);
                    }}
                  >
                    + New rate
                  </Button>
                </div>

                {/* Rates table */}
                <div className="p-0">
                  <DataTable<RateRow>
                    columns={rateColumns}
                    data={assigneeRates.map(toRateRow)}
                    emptyTitle="No rates"
                    pageSize={50}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RateModal
        open={isModalOpen}
        rate={selectedRate}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
