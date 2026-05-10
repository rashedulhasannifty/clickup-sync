import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTimeEntriesList } from '../hooks/useReports';
import { fmt } from '../lib/formatters';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricCard } from '../components/ui/MetricCard';
import { Input } from '../components/ui/Input';
import { Switch } from '../components/ui/Switch';
import type { Column } from '../components/ui/DataTable';
import { DataTable } from '../components/ui/DataTable';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Pill';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TimeEntryDrawer } from '../components/TimeEntryDrawer';
import type { TimeEntryItem } from '../components/TimeEntryDrawer';

const PAGE_SIZE = 50;

export function TimeEntriesPage() {
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [billable, setBillable] = useState('');
  const [status, setStatus] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<TimeEntryItem | null>(null);

  // Debounce search 300ms
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw), 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  // Missing-only switch overrides status select
  const effectiveStatus = missingOnly ? 'NO_RATE_FOUND' : status;

  const params: Record<string, string | number | undefined> = {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    search: search || undefined,
    userId: userId || undefined,
    billable: billable || undefined,
    status: effectiveStatus || undefined,
  };

  const { data, isLoading } = useTimeEntriesList(params);

  const items: TimeEntryItem[] = (data as { items?: TimeEntryItem[] } | undefined)?.items ?? [];
  const total: number = (data as { total?: number } | undefined)?.total ?? 0;

  // KPIs computed from current page
  const totalHours = items.reduce((s, r) => s + r.durationHours, 0);
  const billableHours = items.filter(r => r.billable).reduce((s, r) => s + r.durationHours, 0);
  const billablePct = totalHours > 0 ? (billableHours / totalHours) * 100 : 0;
  // costAud is in dollars; fmt.money expects cents
  const totalCostCents = items.reduce((s, r) => s + r.costAud * 100, 0);
  const missingRateCount = items.filter(r => r.status === 'NO_RATE_FOUND').length;

  const handleMissingOnlyToggle = useCallback((v: boolean) => {
    setMissingOnly(v);
    if (v) setStatus('');
    setPage(1);
  }, []);

  const handleStatusChange = useCallback((v: string) => {
    if (v === 'NO_RATE_FOUND') {
      setMissingOnly(true);
      setStatus('');
    } else {
      setMissingOnly(false);
      setStatus(v);
    }
    setPage(1);
  }, []);

  const columns: Column<TimeEntryItem>[] = [
    {
      key: 'timeEntryId',
      header: 'Entry ID',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {row.status === 'NO_RATE_FOUND' && (
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#dc2626',
                flexShrink: 0,
              }}
            />
          )}
          <span style={{ fontFamily: 'monospace', fontSize: '0.8em' }}>
            {row.timeEntryId.slice(0, 8)}
          </span>
        </span>
      ),
    },
    {
      key: 'taskName',
      header: 'Task',
      render: (row) => <>{row.taskName ?? '—'}</>,
    },
    {
      key: 'userName',
      header: 'Assignee',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Avatar name={row.userName} size="sm" />
          {row.userName}
        </span>
      ),
    },
    {
      key: 'startTime',
      header: 'Start',
      render: (row) => <>{fmt.dateTime(row.startTime)}</>,
      sortable: true,
    },
    {
      key: 'durationHours',
      header: 'Duration',
      render: (row) => <strong>{fmt.hours(row.durationHours)}</strong>,
      sortable: true,
    },
    {
      key: 'billable',
      header: 'Billable',
      render: (row) => (
        <Pill tone={row.billable ? 'green' : 'gray'}>
          {row.billable ? 'Billable' : 'Non-billable'}
        </Pill>
      ),
    },
    {
      key: 'hourlyRateCents',
      header: 'Rate',
      render: (row) => (
        <>{row.hourlyRateCents > 0 ? `$${(row.hourlyRateCents / 100).toFixed(0)}/h` : '—'}</>
      ),
    },
    {
      key: 'costAud',
      header: 'Cost',
      render: (row) =>
        row.status === 'NO_RATE_FOUND' ? (
          <Pill tone="amber">No rate</Pill>
        ) : (
          <strong>{fmt.money(row.costAud * 100)}</strong>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'syncedAt',
      header: 'Synced',
      render: (row) => <>{row.syncedAt ? fmt.relative(row.syncedAt) : '—'}</>,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24 }}>
      <PageHeader title="Time Entries" />

      {/* KPI Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
        }}
      >
        <MetricCard dense label="Total Hours" value={fmt.hours(totalHours)} />
        <MetricCard dense label="Total Entries" value={total} />
        <MetricCard dense label="Billable Hours" value={fmt.hours(billableHours)} />
        <MetricCard dense label="Billable %" value={`${billablePct.toFixed(1)}%`} />
        <MetricCard dense label="Total Cost" value={fmt.money(totalCostCents)} />
        <MetricCard
          dense
          label="Missing Rates"
          value={missingRateCount}
          accent={missingRateCount > 0}
          onClick={() => navigate('/missing-rates')}
        />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <Input
          value={searchRaw}
          onChange={(e) => {
            setSearchRaw(e.target.value);
            setPage(1);
          }}
          placeholder="Search entries..."
        />
        <Input
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            setPage(1);
          }}
          placeholder="User ID..."
        />
        <select
          value={billable}
          onChange={(e) => {
            setBillable(e.target.value);
            setPage(1);
          }}
          style={{
            padding: '6px 12px',
            fontSize: '0.875rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        >
          <option value="">All</option>
          <option value="true">Billable only</option>
          <option value="false">Non-billable only</option>
        </select>
        <select
          value={effectiveStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={missingOnly}
          style={{
            padding: '6px 12px',
            fontSize: '0.875rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--surface)',
            color: 'var(--text)',
            opacity: missingOnly ? 0.5 : 1,
          }}
        >
          <option value="">All</option>
          <option value="COST_CALCULATED">Cost calculated</option>
          <option value="NO_RATE_FOUND">No rate found</option>
        </select>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.875rem',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <Switch checked={missingOnly} onChange={handleMissingOnlyToggle} />
          Missing rate only
        </label>
      </div>

      {/* Table */}
      <DataTable<TimeEntryItem>
        columns={columns}
        data={items}
        loading={isLoading}
        onRowClick={(row) => setSelectedEntry(row)}
        emptyTitle="No time entries"
        emptyBody="Try adjusting your filters."
        pageSize={PAGE_SIZE}
        total={total}
        page={page}
        onPageChange={setPage}
      />

      <TimeEntryDrawer
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />
    </div>
  );
}
