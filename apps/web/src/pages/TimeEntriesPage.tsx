import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Clock, DollarSign, AlertTriangle, CircleCheck, Download, RefreshCw,
  Search, X,
} from 'lucide-react';
import { useTimeEntriesList, useTimeEntriesByUser, useTimeEntriesAggregates, useClients, useLists } from '../hooks/useReports';
import { useMutation } from '@tanstack/react-query';
import { reportsApi } from '../api/reports';
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from '../lib/csv';
import { Callout } from '../components/ui/Callout';
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
import { QueryError } from '../components/ui/QueryError';
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
  const { space, fromDate, toDate, setDateRange, setCustomFrom, setCustomTo } = useGlobalFilters();
  const { data: byUser } = useTimeEntriesByUser();
  const { data: clientsData } = useClients();
  const { data: listsData } = useLists(space !== 'all' ? space : undefined);
  const syncAllTimeEntries = useSyncAllTimeEntries();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');

  const [userId, setUserId] = useState('');
  const [billable, setBillable] = useState('');
  const [status, setStatus] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [clientFilter, setClientFilter] = useState('');
  const [listFilter, setListFilter] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<TimeEntryItem | null>(null);
  // True when the user arrived via a Missing-Rates "Entries" deep link
  // (userId + missingOnly together). In that mode we bypass the topbar
  // space/date globals so the page renders the full unfiltered set the user
  // expected from the source card. The chip shows the bypass; clicking Clear
  // drops out of the mode.
  const [deepLinkActive, setDeepLinkActive] = useState(false);

  // Apply URL params from external navigations (e.g. CostBucketDrawer row click
  // passes ?from=...&to=...&search=...; MissingRatesPage card passes
  // ?userId=...&status=NO_RATE_FOUND). We snapshot the params once and clear
  // them so back-navigation doesn't re-apply, and so the in-page filter state
  // is the only source of truth once the page is interactive.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const urlSearch = searchParams.get('search');
    const urlFrom = searchParams.get('from');
    const urlTo = searchParams.get('to');
    const urlUserId = searchParams.get('userId');
    const urlStatus = searchParams.get('status');
    const urlMissingOnly = searchParams.get('missingOnly');
    if (!urlSearch && !urlFrom && !urlTo && !urlUserId && !urlStatus && !urlMissingOnly) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (urlSearch) { setSearchRaw(urlSearch); setSearch(urlSearch); }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (urlFrom && urlTo) {
      setDateRange('custom');
      setCustomFrom(urlFrom);
      setCustomTo(urlTo);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (urlUserId) setUserId(urlUserId);
    // `missingOnly=true` and `status=NO_RATE_FOUND` are two ways to express the
    // same intent. The page's `missingOnly` toggle is the canonical UI control,
    // so prefer it when present; the `status` param is consumed only as a
    // fallback. The page's own effect (line 113) clears `status` whenever
    // `missingOnly` flips on, so they can't both be active.
    const wantsMissingOnly = urlMissingOnly === 'true' || urlStatus === 'NO_RATE_FOUND';
    if (wantsMissingOnly) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMissingOnly(true);
    } else if (urlStatus) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus(urlStatus);
    }
    // Deep-link mode: arrived from MissingRates with userId + missingOnly. The
    // user expects the full set for that assignee, not whatever the topbar
    // happens to be filtered to. Bypass topbar globals (space, from, to).
    // Skipped when the caller explicitly passes from/to (e.g. CostBucketDrawer
    // pre-narrows the window and we want to honor it).
    if (urlUserId && wantsMissingOnly && !urlFrom && !urlTo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeepLinkActive(true);
    }
    // Strip the params now that we've consumed them.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchParams({}, { replace: true });
    // We intentionally run this effect only once on mount. The deps are stable
    // setters from context plus searchParams (we re-read but don't depend on
    // its identity for re-runs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inline banner replaces the previous `alert()` for sync results — a native
  // alert blocked the page until dismissed and looked off-brand. Banner
  // auto-dismisses after 5s, same pattern as AssigneeRatesPage's recalcMsg.
  const [banner, setBanner] = useState<string | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    },
    [],
  );

  function showBanner(msg: string) {
    setBanner(msg);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setBanner(null), 5000);
  }

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw), 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  useEffect(() => {
    if (missingOnly) setStatus('');
  }, [missingOnly]);

  // A ClickUp list belongs to a single space — clear the selection when the
  // topbar space changes so a stale list ID doesn't filter to zero rows.
  useEffect(() => {
    setListFilter('');
    setPage(1);
  }, [space]);

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

  const clientOptions = useMemo(() => {
    const rows = (Array.isArray(clientsData) ? clientsData : []) as { client: string; taskCount?: number }[];
    const opts = [{ value: '', label: 'Any client' }];
    for (const r of rows) {
      if (!r.client) continue;
      opts.push({ value: r.client, label: r.client });
    }
    return opts;
  }, [clientsData]);

  const listOptions = useMemo(() => {
    const rows = (Array.isArray(listsData) ? listsData : []) as { listId: string; listName: string; spaceName?: string | null; taskCount?: number }[];
    const showSpace = space === 'all';
    const opts = [{ value: '', label: 'Any list' }];
    for (const r of rows) {
      if (!r.listId) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      const label = showSpace && r.spaceName ? `${r.spaceName} · ${r.listName}${count}` : `${r.listName}${count}`;
      opts.push({ value: r.listId, label });
    }
    return opts;
  }, [listsData, space]);

  const params: Record<string, string | number | undefined> = useMemo(() => ({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    search: search || undefined,
    userId: userId || undefined,
    client: clientFilter || undefined,
    listId: listFilter || undefined,
    billable: billable === 'true' || billable === 'false' ? billable : undefined,
    status: missingOnly ? undefined : (status || undefined),
    missingOnly: missingOnly ? 'true' : undefined,
    // Topbar space/date globals are bypassed in deep-link mode (arrived from
    // Missing Rates). See deepLinkActive declaration for rationale.
    spaceId: deepLinkActive ? undefined : (space !== 'all' ? space : undefined),
    from: deepLinkActive ? undefined : (fromDate || undefined),
    to: deepLinkActive ? undefined : (toDate || undefined),
  }), [pageSize, page, search, userId, clientFilter, listFilter, billable, status, missingOnly, deepLinkActive, space, fromDate, toDate]);

  const timeEntriesQuery = useTimeEntriesList(params);
  const { data, isLoading } = timeEntriesQuery;

  const exportCsv = useMutation({
    mutationFn: async () => {
      const { items } = await reportsApi.timeEntriesList({ ...params, limit: 5000, offset: 0 });
      const cols: CsvColumn<TimeEntryItem>[] = [
        { header: 'Time entry ID', value: 'timeEntryId' },
        { header: 'Task ID',       value: 'taskId' },
        { header: 'Task name',     value: 'taskName' },
        { header: 'User ID',       value: 'userId' },
        { header: 'User name',     value: 'userName' },
        { header: 'User email',    value: 'userEmail' },
        { header: 'Client',        value: 'client' },
        { header: 'List',          value: 'listName' },
        { header: 'Start',         value: 'startTime' },
        { header: 'End',           value: 'endTime' },
        { header: 'Duration (h)', value: 'durationHours' },
        { header: 'Billable',      value: 'billable' },
        { header: 'Hourly rate (cents)', value: 'hourlyRateCents' },
        { header: 'Cost',          value: 'costAud' },
        { header: 'Currency',      value: 'currency' },
        { header: 'Status',        value: 'status' },
        { header: 'Description',   value: 'description' },
        { header: 'Synced',        value: 'syncedAt' },
      ];
      downloadCsv(csvFilename('time-entries'), toCsv(items as TimeEntryItem[], cols));
      return { rows: items.length };
    },
  });

  // Aggregates intentionally use the filter-set only — `limit`/`offset` are
  // dropped so paginating through results doesn't churn the query cache or
  // refetch the totals (they're the same across pages).
  const aggParams = useMemo(() => {
    const { limit: _l, offset: _o, ...rest } = params;
    return rest;
  }, [params]);
  const { data: agg } = useTimeEntriesAggregates(aggParams);

  const items: TimeEntryItem[] = (data as { items?: TimeEntryItem[] } | undefined)?.items ?? [];
  const total: number = (data as { total?: number } | undefined)?.total ?? 0;

  // All metric cards derive from server-side aggregates so they reflect the
  // entire filtered set, not the 50-row page. Without this the cards looked
  // frozen across date-range changes.
  const totalHours = agg?.totalHours ?? 0;
  const billableHours = agg?.billableHours ?? 0;
  const nonBillableHours = agg?.nonBillableHours ?? 0;
  const totalCostCents = agg?.totalCostCents ?? 0;
  const avgRateCents = agg?.avgRateCents ?? 0;
  const missingRateCount = agg?.noRateFoundCount ?? 0;
  const calculatedCount = agg?.costCalculatedCount ?? 0;

  const hasFilters = !!(
    search || userId || clientFilter || listFilter || billable || status || missingOnly
  );

  const reset = useCallback(() => {
    setSearchRaw('');
    setSearch('');
    setUserId('');
    setClientFilter('');
    setListFilter('');
    setBillable('');
    setStatus('');
    setMissingOnly(false);
    setDeepLinkActive(false);
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
      key: 'client',
      header: 'Client',
      width: 140,
      render: (row) => (
        row.client
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.client}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>
      ),
    },
    {
      key: 'listName',
      header: 'List',
      width: 140,
      render: (row) => (
        row.listName
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.listName}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>
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
            <Button
              size="md"
              variant="default"
              icon={<Download size={13} strokeWidth={1.75} />}
              loading={exportCsv.isPending}
              disabled={exportCsv.isPending || isLoading}
              onClick={() => exportCsv.mutate()}
            >
              Export CSV
            </Button>
            <Button
              size="md"
              variant="default"
              icon={<RefreshCw size={13} strokeWidth={1.75} />}
              loading={syncAllTimeEntries.isPending}
              onClick={() => syncAllTimeEntries.mutate(undefined, {
                onSuccess: (res) => {
                  void queryClient.invalidateQueries({ queryKey: ['time-entries-list'] });
                  void queryClient.invalidateQueries({ queryKey: ['time-entries-by-user'] });
                  showBanner(`Queued ${res.queued} time-entry sync jobs — counts will refresh as workers complete.`);
                },
              })}
            >
              Sync time entries
            </Button>
          </>
        }
      />

      {banner && <Callout tone="blue">{banner}</Callout>}

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

      {deepLinkActive && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'var(--amber-bg, var(--muted-bg))',
            border: '1px solid var(--amber, var(--border))',
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          <Pill tone="amber" size="xs">deep link</Pill>
          <span style={{ color: 'var(--text)' }}>
            Showing all missing-rate entries for this assignee.
            <span style={{ color: 'var(--text-muted)' }}> Topbar space &amp; date range are bypassed.</span>
          </span>
          <span style={{ flex: 1 }} />
          <Button
            size="sm"
            variant="ghost"
            icon={<X size={12} strokeWidth={1.75} />}
            onClick={() => { setDeepLinkActive(false); setPage(1); }}
          >
            Clear
          </Button>
        </div>
      )}

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
        <Select size="md" options={clientOptions} value={clientFilter} onChange={(v) => { setClientFilter(v); setPage(1); }} />
        <Select size="md" options={listOptions} value={listFilter} onChange={(v) => { setListFilter(v); setPage(1); }} />
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

      <QueryError query={timeEntriesQuery} what="time entries" />

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
        initialSort={{ key: 'startTime', dir: 'desc' }}
      />

      <TimeEntryDrawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </div>
  );
}
