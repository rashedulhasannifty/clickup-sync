import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Rate } from '../api/rates';
import { useRates } from '../hooks/useRates';
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
        <span className="text-xs">{row.validTo ? fmt.date(row.validTo) : '—'}</span>
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
          <Pill tone="green">Active</Pill>
        ) : (
          <Pill tone="gray">Historical</Pill>
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
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            openEdit(row as Rate);
          }}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Assignee Rates"
        actions={
          <Button variant="accent" onClick={openCreate}>
            Add Rate
          </Button>
        }
      />

      {/* KPI Cards */}
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}
      >
        <MetricCard label="Active Rates" value={isLoading ? '—' : activeRatesCount} dense />
        <MetricCard label="Covered Assignees" value={isLoading ? '—' : coveredAssignees} dense />
        <MetricCard
          label="Avg Active Rate"
          value={isLoading ? '—' : `$${avgActiveRate.toFixed(0)}/h`}
          dense
        />
        <MetricCard
          label="Without Rate"
          value="—"
          dense
          onClick={() => navigate('/missing-rates')}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div style={{ flex: 1, maxWidth: 320 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or ID…"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">Active only</span>
          <Switch checked={activeOnly} onChange={setActiveOnly} />
        </div>
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
                  <Avatar name={displayName} size="sm" />
                  <span className="font-medium text-sm text-[var(--text)]">{displayName}</span>
                  {first.assigneeEmail && (
                    <span className="text-xs text-[var(--text-muted)]">{first.assigneeEmail}</span>
                  )}
                  <span className="text-xs text-[var(--text-faint)]">{assigneeId}</span>
                  <div className="flex-1" />
                  {activeRate && (
                    <Pill tone="green">
                      ${(activeRate.hourlyRateCents / 100).toFixed(0)}/h
                    </Pill>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelectedRate(null);
                      setIsModalOpen(true);
                    }}
                  >
                    New rate
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
