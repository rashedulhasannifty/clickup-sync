import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Clock, DollarSign, AlertTriangle, CircleCheck, Download,
  Search, X,
} from 'lucide-react';
import { useTimeEntriesList, useTimeEntriesByTask, useTimeEntriesByUser, useTimeEntriesAggregates, useClients, useLists, useFolders } from '../hooks/useReports';
import type { TimeEntryTaskGroup } from '../hooks/useReports';
import { useMutation } from '@tanstack/react-query';
import { reportsApi } from '../api/reports';
import { exportXlsx, type XlsxColumn } from '../lib/xlsx';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { fmt } from '../lib/formatters';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricCard } from '../components/ui/MetricCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { MultiSelect } from '../components/ui/MultiSelect';
import { Switch } from '../components/ui/Switch';
import type { Column } from '../components/ui/DataTable';
import { DataTable } from '../components/ui/DataTable';
import { QueryError } from '../components/ui/QueryError';
import { ClickupAvatar } from '../components/ui/ClickupAvatar';
import { Pill } from '../components/ui/Pill';
import { TimeEntryDrawer } from '../components/TimeEntryDrawer';
import { TaskTimeEntriesPanel } from '../components/TaskTimeEntriesPanel';
import { SelectionBar, type SelectionStat } from '../components/SelectionBar';
import { useRowSelection } from '../hooks/useRowSelection';
import type { TimeEntryItem } from '../components/TimeEntryDrawer';

const CHARGEABLE_OPTIONS = [
  { value: '', label: 'Chargeable + non' },
  { value: 'true', label: 'Chargeable only' },
  { value: 'false', label: 'Non-chargeable only' },
];

// Mirrors the Tasks page. Time entries carry no archived column of their own —
// the backend resolves this against the joined task's `archived` flag.
const ARCHIVED_OPTIONS = [
  { value: 'exclude', label: 'Hide archived' },
  { value: 'include', label: 'Include archived' },
  { value: 'only', label: 'Archived only' },
];

const STATUS_OPTIONS = [
  { value: 'COST_CALCULATED', label: 'Cost calculated' },
  { value: 'NO_RATE_FOUND', label: 'No rate found' },
  { value: 'COST_EXCLUDED', label: 'Excluded' },
  { value: 'NOT_CHARGEABLE', label: 'Not chargeable' },
];

// The page's two shapes. Grouped is the default: a task's total is what people
// read the page for, and the individual entries behind it are one click away.
// The entry-level deep links (Missing Rates, cost buckets, anomalies) point at a
// specific entry, so they force 'none' — see the URL-param effect below.
// Label for the backend's synthetic "entries with no task" bucket (`NO_TASK_ID`
// in report-filter.util.ts). Those entries are deliberately kept visible, so the
// grouped view gives them one row rather than dropping them; the row expands
// like any other because the sentinel round-trips as its `taskId`.

/** Stable empty array so a stale expansion tag doesn't churn the table's props. */
const EMPTY_EXPANSION: (string | number)[] = [];
const NO_TASK_LABEL = '(No task)';

const GROUP_OPTIONS = [
  { value: 'task', label: 'Group by task' },
  { value: 'none', label: 'All entries' },
];

const SPRINT_STATUS_OPTIONS = [
  { value: 'all', label: 'All sprints' },
  { value: 'active', label: 'Active sprints' },
  { value: 'completed', label: 'Completed (archived) sprints' },
];

// Deep-link mode wants every entry for the assignee regardless of date. The
// backend floors a missing `from` to 30 days ago, so we pass an explicit
// all-time lower bound instead of omitting it.
const ALL_TIME_FROM = '1970-01-01T00:00:00.000Z';

// Render a deep-link's instant window as friendly day(s). Formatted in
// Asia/Dhaka — the timezone the spike/anomaly day windows are built around — so
// a single-day Dhaka window (which straddles two UTC dates) reads as one day.
function fmtLinkWindow(fromIso: string, toIso: string): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', month: 'short', day: 'numeric' });
  const a = f.format(new Date(fromIso));
  const b = f.format(new Date(toIso));
  return a === b ? a : `${a} → ${b}`;
}

export function TimeEntriesPage() {
  const navigate = useNavigate();
  const { space, fromDate, toDate } = useGlobalFilters();
  const { data: byUser } = useTimeEntriesByUser();
  const { data: clientsData } = useClients();
  const { data: listsData } = useLists(space !== 'all' ? space : undefined);
  const { data: foldersData } = useFolders(space !== 'all' ? space : undefined);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');

  const [userId, setUserId] = useState<string[]>([]);
  const [chargeable, setChargeable] = useState('');
  const [status, setStatus] = useState<string[]>([]);
  const [missingOnly, setMissingOnly] = useState(false);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [listFilter, setListFilter] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState<string[]>([]);
  const [archivedFilter, setArchivedFilter] = useState('include');
  const [sprintStatus, setSprintStatus] = useState('all');
  const [selectedEntry, setSelectedEntry] = useState<TimeEntryItem | null>(null);
  const [groupBy, setGroupBy] = useState('task');
  // Task ids whose per-entry breakdown is open (grouped mode only), tagged with
  // the filter set they were opened under. An expanded panel belongs to one
  // filter set and one page of tasks: reading `ids` only when the tag still
  // matches collapses everything on any filter or page change, without an
  // effect that would re-render after paint.
  const [expanded, setExpanded] = useState<{ key: string; ids: (string | number)[] }>({ key: '', ids: [] });
  // Mirror the DataTable's column show/hide state so CSV export drops the same
  // hidden columns (keys match the `columns` defs below).
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  // Kept separate from `hiddenCols`: the two modes share no column keys, so one
  // shared set would silently hide nothing (or the wrong thing) after a switch.
  const [hiddenGroupCols, setHiddenGroupCols] = useState<string[]>([]);
  // True when the user arrived via a Missing-Rates "Entries" deep link
  // (userId + missingOnly together). In that mode we bypass the topbar
  // space/date globals so the page renders the full unfiltered set the user
  // expected from the source card. The chip shows the bypass; clicking Clear
  // drops out of the mode.
  const [deepLinkActive, setDeepLinkActive] = useState(false);
  // True when arrived from the Overview Anomalies panel (spaceScope=all). Spend
  // anomalies are computed across all spaces, so we drop the topbar space filter
  // to reproduce the figure — but, unlike deepLinkActive, we keep the explicit
  // date window the anomaly link passed.
  const [bypassSpace, setBypassSpace] = useState(false);
  // Precise date window carried by a deep link (an Hour-Spike day, an anomaly,
  // a cost bucket). Kept page-local instead of pushed into the global topbar
  // custom range, because: (a) these are exact ISO *instants* (e.g. a Dhaka-day
  // window `[12T18:00Z, 13T18:00Z]`) and the topbar date input only renders
  // YYYY-MM-DD — feeding it an instant left the field blank (dd/mm/yyyy); and
  // (b) mutating the global filter made the custom range stick in the topbar
  // after navigating away. The page-local window applies directly to the query
  // and is surfaced (with a Clear) by the linked-view chip below.
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linkTo, setLinkTo] = useState<string | null>(null);

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
    const urlClient = searchParams.get('client');
    const urlSpaceScope = searchParams.get('spaceScope');
    if (!urlSearch && !urlFrom && !urlTo && !urlUserId && !urlStatus && !urlMissingOnly && !urlClient && !urlSpaceScope) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (urlSearch) { setSearchRaw(urlSearch); setSearch(urlSearch); }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (urlFrom && urlTo) {
      setLinkFrom(urlFrom);
      setLinkTo(urlTo);
    }
    // Every deep link into this page targets individual entries. Grouped mode
    // would bury the one they meant inside a collapsed task, so links land flat.
    setGroupBy('none');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (urlUserId) setUserId([urlUserId]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (urlClient) setClientFilter([urlClient]);
    // Anomaly "view" links pass spaceScope=all — drop the topbar space filter
    // (anomalies are cross-space) while still honoring the explicit date window.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (urlSpaceScope === 'all') setBypassSpace(true);
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
      setStatus([urlStatus]);
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

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw), 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  useEffect(() => {
    if (missingOnly) setStatus([]);
  }, [missingOnly]);

  // A ClickUp list belongs to a single space — clear the selection when the
  // topbar space changes so a stale list ID doesn't filter to zero rows.
  useEffect(() => {
    setListFilter([]);
    setFolderFilter([]);
    setPage(1);
  }, [space]);

  const assigneeOptions = useMemo(() => {
    const rows = (byUser ?? []) as { userId?: string; userName: string }[];
    const seen = new Set<string>();
    const opts: { value: string; label: string; icon?: ReactNode }[] = [];
    for (const r of rows) {
      const id = r.userId ?? r.userName;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      opts.push({ value: id, label: r.userName, icon: <ClickupAvatar userId={r.userId} name={r.userName} size={18} /> });
    }
    return opts;
  }, [byUser]);

  const clientOptions = useMemo(() => {
    const rows = (Array.isArray(clientsData) ? clientsData : []) as { client: string; taskCount?: number }[];
    const opts: { value: string; label: string }[] = [];
    for (const r of rows) {
      if (!r.client) continue;
      opts.push({ value: r.client, label: r.client });
    }
    return opts;
  }, [clientsData]);

  const listOptions = useMemo(() => {
    const rows = (Array.isArray(listsData) ? listsData : []) as { listId: string; listName: string; spaceName?: string | null; taskCount?: number }[];
    const showSpace = space === 'all';
    const opts: { value: string; label: string }[] = [];
    for (const r of rows) {
      if (!r.listId) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      const label = showSpace && r.spaceName ? `${r.spaceName} · ${r.listName}${count}` : `${r.listName}${count}`;
      opts.push({ value: r.listId, label });
    }
    return opts;
  }, [listsData, space]);

  const folderOptions = useMemo(() => {
    const rows = (Array.isArray(foldersData) ? foldersData : []) as { folderId: string; folderName: string; spaceName?: string | null; taskCount?: number }[];
    const showSpace = space === 'all';
    const opts: { value: string; label: string }[] = [];
    for (const r of rows) {
      if (!r.folderId) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      const label = showSpace && r.spaceName ? `${r.spaceName} · ${r.folderName}${count}` : `${r.folderName}${count}`;
      opts.push({ value: r.folderId, label });
    }
    return opts;
  }, [foldersData, space]);

  const params: Record<string, string | number | undefined> = useMemo(() => ({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    search: search || undefined,
    // Multi-select filters go over the wire comma-separated; an empty selection
    // omits the param entirely, which the backend reads as "no constraint".
    userId: userId.length ? userId.join(',') : undefined,
    client: clientFilter.length ? clientFilter.join(',') : undefined,
    listId: listFilter.length ? listFilter.join(',') : undefined,
    folderId: folderFilter.length ? folderFilter.join(',') : undefined,
    chargeable: chargeable === 'true' || chargeable === 'false' ? chargeable : undefined,
    status: missingOnly ? undefined : (status.length ? status.join(',') : undefined),
    missingOnly: missingOnly ? 'true' : undefined,
    // 'include' is the neutral default (no backend constraint) — omit it so it
    // stays out of the query key / URL; only send 'exclude' or 'only'.
    archived: archivedFilter !== 'include' ? archivedFilter : undefined,
    sprintStatus: sprintStatus !== 'all' ? sprintStatus : undefined,
    // Topbar space/date globals are bypassed in deep-link mode (arrived from
    // Missing Rates). bypassSpace (from an Anomalies "view") drops only the
    // space filter, keeping the explicit date window. See the state declarations.
    spaceId: (deepLinkActive || bypassSpace) ? undefined : (space !== 'all' ? space : undefined),
    // A page-local linked window (linkFrom/linkTo) takes precedence over the
    // topbar range; deep-link mode (Missing Rates) drops the window entirely.
    // The backend defaults a missing `from` to "now − 30 days", so omitting it
    // does NOT mean "all time" — it silently re-applies a 30-day floor and hid
    // older missing-rate entries (e.g. a rate gap months back). Send an explicit
    // all-time `from` to truly bypass the date. `to` can stay undefined: the
    // backend defaults a missing `to` to now(), which is what we want.
    from: deepLinkActive ? ALL_TIME_FROM : (linkFrom ?? (fromDate || undefined)),
    to: deepLinkActive ? undefined : (linkTo ?? (toDate || undefined)),
  }), [pageSize, page, search, userId, clientFilter, listFilter, folderFilter, chargeable, status, missingOnly, archivedFilter, sprintStatus, deepLinkActive, bypassSpace, space, fromDate, toDate, linkFrom, linkTo]);

  const grouped = groupBy === 'task';
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);
  // Selection is scoped to the FILTERS, not the page: paging must not drop a
  // selection being built across pages, but a filter change must (its totals
  // would otherwise count rows the table can no longer show). Switching group
  // mode changes what a row even is, so that resets it too.
  const selectionScope = useMemo(
    () => `${groupBy}|${JSON.stringify({ ...params, limit: undefined, offset: undefined })}`,
    [params, groupBy],
  );
  const entrySelection = useRowSelection<TimeEntryItem>(selectionScope);
  const groupSelection = useRowSelection<TimeEntryTaskGroup>(selectionScope);
  const selectionCount = grouped ? groupSelection.count : entrySelection.count;
  const expandedTasks = expanded.key === paramsKey ? expanded.ids : EMPTY_EXPANSION;
  // Only one of the two runs — `params` is identical for both, so the grouped
  // totals and the flat rows always describe the same filtered entry set.
  const timeEntriesQuery = useTimeEntriesList(params, !grouped);
  const byTaskQuery = useTimeEntriesByTask(params, grouped);
  const { data, isLoading } = grouped ? byTaskQuery : timeEntriesQuery;

  const exportExcel = useMutation({
    mutationFn: async () => {
      // The export mirrors what's on screen: grouped mode exports one row per
      // task carrying its total, never the individual entries behind it.
      if (grouped) {
        // A selection exports itself — the rows are already in hand, so there's
        // nothing to re-fetch and no risk of the export drifting from the table.
        const items = groupSelection.count > 0
          ? groupSelection.selectedRows
          : (await reportsApi.timeEntriesByTask({ ...params, limit: 5000, offset: 0 })).items;
        const cols: XlsxColumn<TimeEntryTaskGroup>[] = [
          { header: 'Task ID',            value: 'taskId' },
          { header: 'Task name',          value: (r) => r.taskName ?? NO_TASK_LABEL, key: 'taskName', width: 42 },
          { header: 'Client',             value: 'client', key: 'client' },
          { header: 'List',               value: 'listName', key: 'listName' },
          { header: 'Assignees',          value: (r) => r.assignees.map(a => a.userName).filter(Boolean).join(', '), key: 'assignees', width: 30 },
          { header: 'Entries',            value: 'entryCount', key: 'entryCount', type: 'integer' },
          { header: 'Total hours',        value: 'totalHours', key: 'totalHours', type: 'number' },
          { header: 'Chargeable',       value: (r) => (r.chargeable ? 'Yes' : 'No'), key: 'chargeable' },
          { header: 'Chargeable hours', value: 'chargeableHours', key: 'chargeableHours', type: 'number' },
          // Cost of the entries that HAVE a rate. `Entries missing a rate` is the
          // caveat on it — an uncosted entry is never rolled in silently.
          { header: 'Total cost',         value: 'costAud', key: 'costAud', type: 'money' },
          { header: 'Currency',           value: 'currency' },
          { header: 'Entries missing a rate', value: 'missingRateCount', key: 'missingRateCount', type: 'integer' },
          { header: 'Entries excluded from cost', value: 'excludedCount', key: 'missingRateCount', type: 'integer' },
          { header: 'Last activity',      value: 'lastActivity', key: 'lastActivity', type: 'date' },
        ];
        const visible = cols.filter((c) => !c.key || !hiddenGroupCols.includes(c.key));
        await exportXlsx({ filename: 'time-by-task', sheetName: 'Time by task', rows: items, columns: visible });
        return { rows: items.length };
      }
      const items = entrySelection.count > 0
        ? entrySelection.selectedRows
        : (await reportsApi.timeEntriesList({ ...params, limit: 5000, offset: 0 })).items as TimeEntryItem[];
      // `key` ties a column to its DataTable column so columns hidden via the
      // table's "Columns" menu are dropped here too. Columns with no `key` are
      // export-only (not hideable in the table) and always export.
      const cols: XlsxColumn<TimeEntryItem>[] = [
        { header: 'Time entry ID', value: 'timeEntryId', key: 'timeEntryId' },
        { header: 'Task ID',       value: 'taskId' },
        { header: 'Task name',     value: 'taskName', key: 'taskName', width: 42 },
        { header: 'User ID',       value: 'userId', key: 'userName' },
        { header: 'User name',     value: 'userName', key: 'userName', width: 24 },
        { header: 'User email',    value: 'userEmail', key: 'userName', width: 28 },
        { header: 'Client',        value: 'client', key: 'client' },
        { header: 'List',          value: 'listName', key: 'listName' },
        { header: 'Start',         value: 'startTime', key: 'startTime', type: 'date' },
        { header: 'End',           value: 'endTime', type: 'date' },
        { header: 'Duration (h)', value: 'durationHours', key: 'durationHours', type: 'number' },
        { header: 'Chargeable',    value: (r) => (r.chargeable ? 'Yes' : 'No'), key: 'chargeable' },
        // Both money columns export in dollars (matching the UI). `hourlyRateCents`
        // is stored in cents, so divide by 100; `costAud` is already dollars.
        { header: 'Hourly rate',   value: (r) => (r.hourlyRateCents != null ? r.hourlyRateCents / 100 : null), key: 'hourlyRateCents', type: 'money' },
        { header: 'Cost',          value: 'costAud', key: 'costAud', type: 'money' },
        { header: 'Currency',      value: 'currency' },
        { header: 'Status',        value: 'status', key: 'status' },
        { header: 'Description',   value: 'description', width: 42 },
        { header: 'Synced',        value: 'syncedAt', key: 'syncedAt', type: 'date' },
      ];
      const visibleCols = cols.filter((c) => !c.key || !hiddenCols.includes(c.key));
      await exportXlsx({ filename: 'time-entries', sheetName: 'Time entries', rows: items as TimeEntryItem[], columns: visibleCols });
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

  const items: TimeEntryItem[] = grouped ? [] : ((data as { items?: TimeEntryItem[] } | undefined)?.items ?? []);
  const taskGroups: TimeEntryTaskGroup[] = grouped ? (byTaskQuery.data?.items ?? []) : [];
  // In grouped mode this is the number of TASKS — it drives the pager, so it
  // must match whatever the table is listing.
  const total: number = (data as { total?: number } | undefined)?.total ?? 0;

  // All metric cards derive from server-side aggregates so they reflect the
  // entire filtered set, not the 50-row page. Without this the cards looked
  // frozen across date-range changes.
  const totalHours = agg?.totalHours ?? 0;
  const chargeableHours = agg?.chargeableHours ?? 0;
  const nonChargeableHours = agg?.nonChargeableHours ?? 0;
  const totalCostCents = agg?.totalCostCents ?? 0;
  const avgRateCents = agg?.avgRateCents ?? 0;
  const missingRateCount = agg?.noRateFoundCount ?? 0;
  const calculatedCount = agg?.costCalculatedCount ?? 0;
  // Cards always count entries (they aggregate the entry set, not the rows on
  // screen), so grouped mode names both figures rather than relabelling `total`.
  const entryCount = agg?.totalEntries ?? (grouped ? 0 : total);

  const hasFilters = !!(
    search || userId.length || clientFilter.length || listFilter.length
    || folderFilter.length || chargeable || status.length || missingOnly
    || archivedFilter !== 'include' || sprintStatus !== 'all'
  );

  const reset = useCallback(() => {
    setSearchRaw('');
    setSearch('');
    setUserId([]);
    setClientFilter([]);
    setListFilter([]);
    setFolderFilter([]);
    setChargeable('');
    setStatus([]);
    setMissingOnly(false);
    setArchivedFilter('include');
    setSprintStatus('all');
    setDeepLinkActive(false);
    setBypassSpace(false);
    setLinkFrom(null);
    setLinkTo(null);
    setPage(1);
  }, []);

  const groupColumns: Column<TimeEntryTaskGroup>[] = useMemo(() => [
    {
      // Frozen first column. maxWidth leaves room for the expand chevron the
      // table renders ahead of this cell's content.
      key: 'taskName',
      header: 'Task',
      width: 300,
      render: (row) => (
        <span
          title={row.taskName ?? NO_TASK_LABEL}
          style={{
            fontWeight: 500,
            color: row.taskName ? 'var(--text)' : 'var(--text-muted)',
            fontStyle: row.taskName ? 'normal' : 'italic',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            display: 'block', maxWidth: 236,
          }}
        >
          {row.taskName ?? NO_TASK_LABEL}
        </span>
      ),
    },
    {
      key: 'assignees',
      header: 'Assignees',
      width: 170,
      sortable: false,
      render: (row) => {
        const shown = row.assignees.slice(0, 3);
        const rest = row.assignees.length - shown.length;
        if (!row.assignees.length) return <span style={{ color: 'var(--text-faint)' }}>—</span>;
        return (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title={row.assignees.map(a => a.userName).filter(Boolean).join(', ')}
          >
            {shown.map(a => (
              <ClickupAvatar key={a.userId} userId={a.userId} name={a.userName ?? ''} size={20} />
            ))}
            {rest > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>+{rest}</span>
            )}
            {row.assignees.length === 1 && (
              <span style={{ fontSize: 12, marginLeft: 2 }}>{row.assignees[0].userName}</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'entryCount',
      header: 'Entries',
      width: 80,
      align: 'right',
      render: (row) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>
          {fmt.number(row.entryCount)}
        </span>
      ),
    },
    {
      key: 'totalHours',
      header: 'Total time',
      width: 100,
      align: 'right',
      render: (row) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.duration(row.totalHours)}</span>
      ),
    },
    {
      key: 'chargeable',
      header: 'Charge',
      width: 120,
      render: (row) => (
        row.chargeable
          ? <Pill tone="green" size="xs">chargeable</Pill>
          // A mixed task (some chargeable entries, some not) is neither — a flat
          // "non-chargeable" pill would misreport it as wholly excluded. Blue,
          // not amber: this is a state, not a fault — amber in this table means
          // "needs attention" (missing rate, no rate found).
          : row.partiallyChargeable
            ? <Pill tone="blue" size="xs">partial</Pill>
            : <Pill tone="gray" size="xs">non-chargeable</Pill>
      ),
    },
    {
      // Sums only the entries that HAVE a rate — the Rate column has no meaning
      // across a task worked by several people, so it lives in the breakdown.
      key: 'costAud',
      header: 'Cost',
      width: 100,
      align: 'right',
      render: (row) => (
        row.costAud > 0
          ? <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.money(row.costAud * 100, row.currency)}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>
      ),
    },
    {
      key: 'missingRateCount',
      header: 'Rates',
      width: 120,
      render: (row) => {
        // Only a WHOLLY non-chargeable task has no rated entries to report on.
        // A partially-chargeable task still has chargeable entries that can be
        // missing a rate, and that gap must stay visible.
        if (!row.chargeable && !row.partiallyChargeable) return <span style={{ color: 'var(--text-faint)' }}>n/a</span>;
        if (row.missingRateCount > 0) {
          return <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} strokeWidth={2} />}>{row.missingRateCount} missing</Pill>;
        }
        // A task with no missing rates still isn't necessarily costed — excluded
        // assignees contribute zero, so saying "all costed" would overstate it.
        if (row.excludedCount >= row.entryCount) return <Pill tone="gray" size="xs">excluded</Pill>;
        if (row.excludedCount > 0) return <Pill tone="gray" size="xs">{row.excludedCount} excluded</Pill>;
        return <Pill tone="green" size="xs" icon={<CircleCheck size={10} strokeWidth={2} />}>all costed</Pill>;
      },
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
      key: 'lastActivity',
      header: 'Last logged',
      width: 100,
      align: 'right',
      render: (row) => (
        row.lastActivity
          ? <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>{fmt.relative(row.lastActivity)}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>
      ),
    },
  ], []);

  const columns: Column<TimeEntryItem>[] = useMemo(() => [
    {
      // Frozen first column: stays visible while scrolling horizontally.
      key: 'taskName',
      header: 'Task',
      width: 280,
      // maxWidth 256 = column 280 − cell padding (12+12) so a long name
      // truncates instead of widening the column; title shows the full name.
      render: (row) => (
        <span
          title={String(row.taskName ?? '')}
          style={{
            fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            display: 'block', maxWidth: 256,
          }}
        >
          {row.taskName ?? '—'}
        </span>
      ),
    },
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
      key: 'userName',
      header: 'Assignee',
      width: 180,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ClickupAvatar userId={row.userId} email={row.userEmail} name={row.userName} size={22} />
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
      key: 'chargeable',
      header: 'Charge',
      width: 110,
      sortable: false,
      render: (row) => (
        row.chargeable
          ? <Pill tone="green" size="xs">chargeable</Pill>
          : <Pill tone="gray" size="xs">non-chargeable</Pill>
      ),
    },
    {
      key: 'hourlyRateCents',
      header: 'Rate',
      width: 80,
      align: 'right',
      render: (row) => {
        const cur = row.currency ?? 'USD';
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
        const cur = row.currency ?? 'USD';
        if (row.status === 'COST_EXCLUDED') {
          return <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Excluded</span>;
        }
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
      render: (row) =>
        row.status === 'COST_CALCULATED'
          ? <Pill tone="green" size="xs" icon={<CircleCheck size={10} strokeWidth={2} />}>cost calculated</Pill>
          : row.status === 'COST_EXCLUDED'
            ? <Pill tone="gray" size="xs">excluded</Pill>
            // Gray, not amber: the rate WAS resolved, the cost is zero because
            // the task is non-chargeable. Nothing here needs fixing.
            : row.status === 'NOT_CHARGEABLE'
              ? <Pill tone="gray" size="xs">not chargeable</Pill>
              : <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} strokeWidth={2} />}>no rate found</Pill>,
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

  // Summed from the selected rows themselves — every row carries its own hours
  // and cost, so these are exact rather than a second opinion from the server.
  const selectionStats: SelectionStat[] = useMemo(() => {
    const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((n, r) => n + (pick(r) || 0), 0);
    if (grouped) {
      const rows = groupSelection.selectedRows;
      const missing = sum(rows, r => r.missingRateCount);
      return [
        { label: 'entries', value: fmt.number(sum(rows, r => r.entryCount)) },
        { label: 'total', value: fmt.hours(sum(rows, r => r.totalHours)) },
        { label: 'chargeable', value: fmt.hours(sum(rows, r => r.chargeableHours)) },
        { label: 'non-chargeable', value: fmt.hours(sum(rows, r => r.totalHours - r.chargeableHours)) },
        { label: 'cost', value: fmt.money(sum(rows, r => r.costAud) * 100) },
        ...(missing > 0 ? [{ label: 'missing rate', value: fmt.number(missing), warn: true }] : []),
      ];
    }
    const rows = entrySelection.selectedRows;
    const missing = rows.filter(r => r.status === 'NO_RATE_FOUND').length;
    return [
      { label: 'total', value: fmt.hours(sum(rows, r => r.durationHours)) },
      { label: 'chargeable', value: fmt.hours(sum(rows.filter(r => r.chargeable), r => r.durationHours)) },
      { label: 'non-chargeable', value: fmt.hours(sum(rows.filter(r => !r.chargeable), r => r.durationHours)) },
      // Mirrors the grouped row and the data-model rule: an entry with no rate
      // contributes no cost, and is called out separately instead.
      { label: 'cost', value: fmt.money(sum(rows.filter(r => r.status !== 'NO_RATE_FOUND'), r => r.costAud) * 100) },
      ...(missing > 0 ? [{ label: 'missing rate', value: fmt.number(missing), warn: true }] : []),
    ];
  }, [grouped, groupSelection.selectedRows, entrySelection.selectedRows]);

  const chargeablePct = totalHours > 0 ? Math.round((chargeableHours / totalHours) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Time Entries"
        description="Audit time tracking and verify calculated labor costs."
        actions={
          <Button
            size="md"
            variant="subtle"
            icon={<Download size={13} strokeWidth={1.75} />}
            loading={exportExcel.isPending}
            disabled={exportExcel.isPending || isLoading}
            onClick={() => exportExcel.mutate()}
          >
            {selectionCount > 0 ? `Export selected (${selectionCount})` : 'Export Excel'}
          </Button>
        }
      />


      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <MetricCard
          dense
          label="Total hours"
          value={fmt.hours(totalHours)}
          sublabel={grouped
            ? `${fmt.number(total)} tasks · ${fmt.number(entryCount)} entries`
            : `${fmt.number(entryCount)} entries`}
          icon={<Clock size={13} strokeWidth={1.75} />}
        />
        <MetricCard
          dense
          label="Chargeable"
          value={fmt.hours(chargeableHours)}
          sublabel={`${chargeablePct}%`}
          icon={<DollarSign size={13} strokeWidth={1.75} />}
        />
        <MetricCard dense label="Non-chargeable" value={fmt.hours(nonChargeableHours)} icon={<Clock size={13} strokeWidth={1.75} />} />
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

      {(bypassSpace || linkFrom) && !deepLinkActive && (
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
          <Pill tone="amber" size="xs">linked view</Pill>
          <span style={{ color: 'var(--text)' }}>
            {linkFrom && linkTo && (
              <>Showing <strong>{fmtLinkWindow(linkFrom, linkTo)}</strong> from a link.</>
            )}
            {bypassSpace && (
              <span style={{ color: 'var(--text-muted)' }}>
                {linkFrom ? ' ' : 'Showing a cross-space view. '}Topbar space is bypassed.
              </span>
            )}
          </span>
          <span style={{ flex: 1 }} />
          <Button
            size="sm"
            variant="ghost"
            icon={<X size={12} strokeWidth={1.75} />}
            onClick={() => { setBypassSpace(false); setLinkFrom(null); setLinkTo(null); setPage(1); }}
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
            placeholder="Search task name, ID, assignee, client…"
            aria-label="Search time entries"
          />
        </div>
        <Select ariaLabel="Group rows" size="md" options={GROUP_OPTIONS} value={groupBy} onChange={(v) => { setGroupBy(v); setPage(1); }} />
        <MultiSelect ariaLabel="Filter by assignee" size="md" allLabel="Any assignee" options={assigneeOptions} value={userId} onChange={(v) => { setUserId(v); setPage(1); }} />
        <MultiSelect ariaLabel="Filter by client" size="md" allLabel="Any client" options={clientOptions} value={clientFilter} onChange={(v) => { setClientFilter(v); setPage(1); }} />
        <MultiSelect ariaLabel="Filter by folder" size="md" allLabel="Any folder" options={folderOptions} value={folderFilter} onChange={(v) => { setFolderFilter(v); setPage(1); }} />
        <MultiSelect ariaLabel="Filter by list" size="md" allLabel="Any list" options={listOptions} value={listFilter} onChange={(v) => { setListFilter(v); setPage(1); }} />
        <Select ariaLabel="Filter by chargeable state" size="md" options={CHARGEABLE_OPTIONS} value={chargeable} onChange={(v) => { setChargeable(v); setPage(1); }} />
        <Select ariaLabel="Filter by archived state" size="md" options={ARCHIVED_OPTIONS} value={archivedFilter} onChange={(v) => { setArchivedFilter(v); setPage(1); }} />
        <Select ariaLabel="Filter by sprint status" size="md" value={sprintStatus} onChange={(v) => { setSprintStatus(v); setPage(1); }} options={SPRINT_STATUS_OPTIONS} />
        <MultiSelect ariaLabel="Filter by cost status" size="md" allLabel="Any status" options={STATUS_OPTIONS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} disabled={missingOnly} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Switch ariaLabel="Show only entries missing a rate" checked={missingOnly} onChange={(v) => { setMissingOnly(v); setPage(1); }} />
          <span>Missing rate only</span>
        </label>
        {hasFilters && (
          <Button size="md" variant="ghost" onClick={reset} icon={<X size={13} strokeWidth={1.75} />}>Reset</Button>
        )}
      </div>

      <SelectionBar
        count={selectionCount}
        noun={grouped ? 'task' : 'entry'}
        nounPlural={grouped ? 'tasks' : 'entries'}
        stats={selectionStats}
        onClear={grouped ? groupSelection.clear : entrySelection.clear}
      />

      <QueryError query={grouped ? byTaskQuery : timeEntriesQuery} what="time entries" />

      {grouped ? (
        <DataTable<TimeEntryTaskGroup>
          layout="design"
          stickyFirstColumn
          rowKey="taskId"
          columns={groupColumns}
          data={taskGroups}
          loading={byTaskQuery.isLoading}
          emptyTitle="No tracked time found for this filter set"
          emptyBody="Try widening filters or check that ClickUp is sending tracked time updates."
          emptyIcon={<Clock size={20} strokeWidth={1.75} />}
          emptyAction={hasFilters ? <Button variant="default" size="md" onClick={reset}>Clear all filters</Button> : undefined}
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          pageSizeOptions={[10, 25, 50, 100]}
          initialSort={{ key: 'totalHours', dir: 'desc' }}
          hiddenColumns={hiddenGroupCols}
          onHiddenColumnsChange={setHiddenGroupCols}
          selectedKeys={groupSelection.selectedKeys}
          onToggleRow={groupSelection.toggleRow}
          onTogglePage={groupSelection.togglePage}
          expandedKeys={expandedTasks}
          onToggleExpand={(key) => setExpanded(prev => {
            const ids = prev.key === paramsKey ? prev.ids : [];
            return {
              key: paramsKey,
              ids: ids.includes(key) ? ids.filter(k => k !== key) : [...ids, key],
            };
          })}
          renderExpanded={(row) => (
            <TaskTimeEntriesPanel
              taskId={row.taskId}
              params={aggParams}
              onSelectEntry={setSelectedEntry}
            />
          )}
        />
      ) : (
      <DataTable<TimeEntryItem>
        layout="design"
        stickyFirstColumn
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
        hiddenColumns={hiddenCols}
        onHiddenColumnsChange={setHiddenCols}
        selectedKeys={entrySelection.selectedKeys}
        onToggleRow={entrySelection.toggleRow}
        onTogglePage={entrySelection.togglePage}
      />
      )}

      <TimeEntryDrawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </div>
  );
}
