import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Clock, DollarSign, AlertTriangle, CircleCheck, Download, RefreshCw,
  Search, X,
} from 'lucide-react';
import { useTimeEntriesList, useTimeEntriesByUser } from '../hooks/useReports';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { fmt } from '../lib/formatters';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricCard } from '../components/ui/MetricCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Switch } from '../components/ui/Switch';
import type { Column } from '../components/ui/DataTable';
import { DataTable } from '../components/ui/DataTable';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Pill';
import { TimeEntryDrawer } from '../components/TimeEntryDrawer';
import type { TimeEntryItem } from '../components/TimeEntryDrawer';
import { useSyncAllTimeEntries } from '../hooks/useAdmin';

const BILLABLE_OPTIONS = [
  { value: '', label: 'Billable + non' },
  { value: 'true', label: 'Billable only' },
  { value: 'false', label: 'Non-billable only' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'COST_CALCULATED', label: 'Cost calculated' },
  { value: 'NO_RATE_FOUND', label: 'No rate found' },
];

export function TimeEntriesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { space, fromDate, toDate } = useGlobalFilters();
  const { data: byUser } = useTimeEntriesByUser();
  const syncAllTimeEntries = useSyncAllTimeEntries();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [billable, setBillable] = useState('');
  const [status, setStatus] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<TimeEntryItem | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw), 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  useEffect(() => {
    if (missingOnly) setStatus('');
  }, [missingOnly]);

  const assigneeOptions = useMemo(() => {
    const rows = (byUser ?? []) as { userId?: string; userName: string }[];
    const seen = new Set<string>();
    const opts = [{ value: '', label: 'Any assignee' }];
    for (const r of rows) {
      const id = r.userId ?? r.userName;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      opts.push({ value: id, label: r.userName });
    }
    return opts;
  }, [byUser]);

  const params: Record<string, string | number | undefined> = useMemo(() => ({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    search: search || undefined,
    userId: userId || undefined,
    billable: billable === 'true' || billable === 'false' ? billable : undefined,
    status: missingOnly ? undefined : (status || undefined),
    missingOnly: missingOnly ? 'true' : undefined,
    spaceId: space !== 'all' ? space : undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
  }), [pageSize, page, search, userId, billable, status, missingOnly, space, fromDate, toDate]);

  const { data, isLoading } = useTimeEntriesList(params);

  const items: TimeEntryItem[] = (data as { items?: TimeEntryItem[] } | undefined)?.items ?? [];
  const total: number = (data as { total?: number } | undefined)?.total ?? 0;

  const totalHours = items.reduce((s, r) => s + r.durationHours, 0);
  const billableHours = items.filter(r => r.billable).reduce((s, r) => s + r.durationHours, 0);
  const nonBillableHours = totalHours - billableHours;
  const totalCostCents = items.reduce((s, r) => s + r.costAud * 100, 0);
  const ratedEntries = items.filter(r => r.hourlyRateCents > 0 && (r.status === 'COST_CALCULATED' || r.costAud > 0));
  const avgRateCents = ratedEntries.length
    ? Math.round(ratedEntries.reduce((s, r) => s + r.hourlyRateCents, 0) / ratedEntries.length)
    : 0;
  const missingRateCount = items.filter(r => r.status === 'NO_RATE_FOUND').length;
  const calculatedCount = items.filter(r => r.status === 'COST_CALCULATED').length;

  const hasFilters = !!(
    search || userId || billable || status || missingOnly
  );

  const reset = useCallback(() => {
    setSearchRaw('');
    setSearch('');
    setUserId('');
    setBillable('');
    setStatus('');
    setMissingOnly(false);
    setPage(1);
  }, []);

  const columns: Column<TimeEntryItem>[] = useMemo(() => [
    {
      key: 'timeEntryId',
      header: 'ID',
      width: 100,
      render: (row) => (
        <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>
          {row.timeEntryId}
        </span>
      ),
    },
    {
      key: 'taskName',
      header: 'Task',
      width: 280,
      render: (row) => (
        <span style={{
          fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'block', maxWidth: 280,
        }}
        >
          {row.taskName ?? '—'}
        </span>
      ),
    },
    {
      key: 'userName',
      header: 'Assignee',
      width: 180,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Avatar user={{ name: row.userName }} size={22} />
          <span style={{ fontSize: 13 }}>{row.userName}</span>
        </span>
      ),
    },
    {
      key: 'startTime',
      header: 'Start',
      width: 130,
      render: (row) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>
          {fmt.dateTime(row.startTime)}
        </span>
      ),
    },
    {
      key: 'durationHours',
      header: 'Duration',
      width: 80,
      align: 'right',
      render: (row) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.duration(row.durationHours)}</span>
      ),
    },
    {
      key: 'billable',
      header: 'Bill',
      width: 70,
      sortable: false,
      render: (row) => (
        row.billable
          ? <Pill tone="green" size="xs">billable</Pill>
          : <Pill tone="gray" size="xs">non</Pill>
      ),
    },
    {
      key: 'hourlyRateCents',
      header: 'Rate',
      width: 80,
      align: 'right',
      render: (row) => {
        const cur = row.currency ?? 'AUD';
        return row.hourlyRateCents > 0 ? (
          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>
            {fmt.money(row.hourlyRateCents, cur)}/h
          </span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>—</span>
        );
      },
    },
    {
      key: 'costAud',
      header: 'Cost',
      width: 90,
      align: 'right',
      render: (row) => {
        const cur = row.currency ?? 'AUD';
        return row.costAud > 0 ? (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.money(row.costAud * 100, cur)}</span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>—</span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: 130,
      render: (row) => (
        row.status === 'COST_CALCULATED'
          ? <Pill tone="green" size="xs" icon={<CircleCheck size={10} strokeWidth={2} />}>cost calculated</Pill>
          : <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} strokeWidth={2} />}>no rate found</Pill>
      ),
    },
    {
      key: 'syncedAt',
      header: 'Synced',
      width: 90,
      align: 'right',
      render: (row) => (
        row.syncedAt
          ? <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>{fmt.relative(row.syncedAt)}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>
      ),
    },
  ], []);

  const billablePct = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Time Entries"
        description="Audit time tracking and verify calculated labor costs."
        actions={
          <>
            <Button size="md" variant="default" icon={<Download size={13} strokeWidth={1.75} />}>Export CSV</Button>
            <Button
              size="md"
              variant="default"
              icon={<RefreshCw size={13} strokeWidth={1.75} />}
              loading={syncAllTimeEntries.isPending}
              onClick={() => syncAllTimeEntries.mutate(undefined, {
                onSuccess: (res) => {
                  void queryClient.invalidateQueries({ queryKey: ['time-entries-list'] });
                  void queryClient.invalidateQueries({ queryKey: ['time-entries-by-user'] });
                  alert(`Queued ${res.queued} time-entry sync jobs`);
                },
              })}
            >
              Sync time entries
            </Button>
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <MetricCard
          dense
          label="Total hours"
          value={fmt.hours(totalHours)}
          sublabel={`${fmt.number(total)} entries`}
          icon={<Clock size={13} strokeWidth={1.75} />}
        />
        <MetricCard
          dense
          label="Billable"
          value={fmt.hours(billableHours)}
          sublabel={`${billablePct}%`}
          icon={<DollarSign size={13} strokeWidth={1.75} />}
        />
        <MetricCard dense label="Non-billable" value={fmt.hours(nonBillableHours)} icon={<Clock size={13} strokeWidth={1.75} />} />
        <MetricCard
          dense
          label="Total cost"
          value={fmt.money(totalCostCents)}
          sublabel={avgRateCents > 0 ? `avg ${fmt.money(avgRateCents)}/h` : undefined}
          icon={<DollarSign size={13} strokeWidth={1.75} />}
        />
        <MetricCard
          dense
          label="With cost"
          value={fmt.number(calculatedCount)}
          sublabel="calculated"
          icon={<CircleCheck size={13} strokeWidth={1.75} />}
        />
        <MetricCard
          dense
          label="Missing rates"
          value={fmt.number(missingRateCount)}
          sublabel="need review"
          icon={<AlertTriangle size={13} strokeWidth={1.75} />}
          onClick={() => navigate('/missing-rates')}
        />
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}
      >
        <div style={{ flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Input
            icon={<Search size={14} strokeWidth={1.75} />}
            value={searchRaw}
            onChange={(e) => { setSearchRaw(e.target.value); setPage(1); }}
            placeholder="Search task, assignee…"
          />
        </div>
        <Select size="md" options={assigneeOptions} value={userId} onChange={(v) => { setUserId(v); setPage(1); }} />
        <Select size="md" options={BILLABLE_OPTIONS} value={billable} onChange={(v) => { setBillable(v); setPage(1); }} />
        <Select size="md" options={STATUS_OPTIONS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} disabled={missingOnly} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Switch checked={missingOnly} onChange={(v) => { setMissingOnly(v); setPage(1); }} />
          <span>Missing rate only</span>
        </label>
        {hasFilters && (
          <Button size="md" variant="ghost" onClick={reset} icon={<X size={13} strokeWidth={1.75} />}>Reset</Button>
        )}
      </div>

      <DataTable<TimeEntryItem>
        layout="design"
        rowKey="timeEntryId"
        columns={columns}
        data={items}
        loading={isLoading}
        emptyTitle="No time entries found for this filter set"
        emptyBody="Try widening filters or check that ClickUp is sending tracked time updates."
        emptyIcon={<Clock size={20} strokeWidth={1.75} />}
        emptyAction={hasFilters ? <Button variant="default" size="md" onClick={reset}>Clear all filters</Button> : undefined}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        pageSizeOptions={[10, 25, 50, 100]}
        onRowClick={(row) => setSelectedEntry(row)}
      />

      <TimeEntryDrawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </div>
  );
}
