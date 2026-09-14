import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Clock, DollarSign, Download, Inbox, ListTree, Search, X } from 'lucide-react';
import {
  useClients, useFolders, useLists, useSetEntryChargeableOverride, useSubProjects,
  useTasksAssignees, useTasksSummary, useTimeEntriesByUser, useWork,
  type WorkEntry, type WorkRow,
} from '../hooks/useReports';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { useRowSelection } from '../hooks/useRowSelection';
import { useAuth } from '../hooks/useAuth';
import {
  useClientOptions, useFolderOptions, useListOptions, useLoggedByOptions,
  useStatusOptions, useSubProjectOptions, useTaskAssigneeOptions,
} from '../hooks/useFilterOptions';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { MultiSelect } from '../components/ui/MultiSelect';
import { Switch } from '../components/ui/Switch';
import { MetricCard } from '../components/ui/MetricCard';
import { DataTable, type Column } from '../components/ui/DataTable';
import { QueryError } from '../components/ui/QueryError';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ClickupAvatarStack } from '../components/ui/ClickupAvatar';
import { SelectionBar, type SelectionStat } from '../components/SelectionBar';
import { TaskDetailDrawer } from '../components/tasks/TaskDetailDrawer';
import { parseAssignees, subProjectsOf } from '../lib/taskFields';
import { TimeEntryDrawer, type TimeEntryItem } from '../components/TimeEntryDrawer';
import { ChargeableConfirmModal } from '../components/ChargeableConfirmModal';
import { WorkEntryRows } from '../components/work/WorkEntryRows';
import { reportsApi } from '../api/reports';
import { exportXlsxSheets, xlsxSheet, type XlsxColumn } from '../lib/xlsx';
import { fmt } from '../lib/formatters';
import { NO_TASK_ID, type WorkParams } from '../lib/workParams';

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' },
];
const TYPE_OPTIONS = [
  { value: '', label: 'Parent + subtasks' }, { value: 'parent', label: 'Parent only' }, { value: 'subtask', label: 'Subtasks only' },
];
const ARCHIVED_OPTIONS = [
  { value: 'include', label: 'Include archived' }, { value: 'exclude', label: 'Hide archived' }, { value: 'only', label: 'Archived only' },
];
const SPRINT_STATUS_OPTIONS = [
  { value: 'all', label: 'All sprints' }, { value: 'active', label: 'Active sprints' }, { value: 'completed', label: 'Completed (archived) sprints' },
];
const CHARGEABLE_OPTIONS = [
  { value: 'all', label: 'All chargeability' }, { value: 'true', label: 'Chargeable' },
  { value: 'partial', label: 'Partially chargeable' }, { value: 'false', label: 'Non-chargeable' },
];
const COST_STATUS_OPTIONS = [
  { value: 'COST_CALCULATED', label: 'Cost calculated' }, { value: 'NO_RATE_FOUND', label: 'No rate found' },
  { value: 'COST_EXCLUDED', label: 'Excluded' }, { value: 'NOT_CHARGEABLE', label: 'Not chargeable' },
];
/** Hidden by default (spec): available from the Columns menu. */
const DEFAULT_HIDDEN = ['lifetime', 'client', 'sub_projects', 'list', 'sprint', 'points', 'updated'];
const REASON: Record<WorkRow['inRangeBecause'], string> = {
  updated: 'Listed because it was updated in the range (no time logged in the range)',
  logged: 'Listed because time was logged on it in the range',
  both: 'Listed because it was updated and had time logged in the range',
};
const FEEDBACK_URL = import.meta.env.VITE_WORK_FEEDBACK_URL as string | undefined;

const csv = (v: string[]) => (v.length ? v.join(',') : undefined);
const blank = (v: unknown) => <span style={{ color: 'var(--text-faint)' }}>{v == null || v === '' ? '—' : String(v)}</span>;

export function WorkPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const { space, fromDate, toDate } = useGlobalFilters();

  // ── Filters ───────────────────────────────────────────────────────────────
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');
  const [loggedBy, setLoggedBy] = useState<string[]>([]);
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [priority, setPriority] = useState<string[]>([]);
  const [type, setType] = useState('');
  const [client, setClient] = useState<string[]>([]);
  const [subProject, setSubProject] = useState<string[]>([]);
  const [listIds, setListIds] = useState<string[]>([]);
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [archived, setArchived] = useState('include');
  const [sprintStatus, setSprintStatus] = useState('all');
  const [chargeable, setChargeable] = useState('all');
  const [costStatus, setCostStatus] = useState<string[]>([]);
  const [missingOnly, setMissingOnly] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'logged', dir: 'desc' });
  const [hiddenCols, setHiddenCols] = useState<string[]>(DEFAULT_HIDDEN);

  /** Wrap a setter so every filter change returns to page 1. */
  const on = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchRaw); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  // A ClickUp list/folder belongs to one space — a selection is meaningless after the topbar space changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListIds([]);
    setFolderIds([]);
    setPage(1);
  }, [space]);

  // ── Dropdown data ─────────────────────────────────────────────────────────
  const spaceId = space !== 'all' ? space : undefined;
  const { data: summary } = useTasksSummary();
  const { data: taskAssignees } = useTasksAssignees();
  const { data: byUser } = useTimeEntriesByUser();
  const { data: clientsData } = useClients({ spaceId, from: fromDate || undefined, to: toDate || undefined, archived });
  const { data: subProjectsData } = useSubProjects({ spaceId, from: fromDate || undefined, to: toDate || undefined, archived });
  const { data: listsData } = useLists(spaceId);
  const { data: foldersData } = useFolders(spaceId);
  const statusOptions = useStatusOptions(summary);
  const assignedToOptions = useTaskAssigneeOptions(taskAssignees);
  const loggedByOptions = useLoggedByOptions(byUser);
  const clientOptions = useClientOptions(clientsData, client);
  const subProjectOptions = useSubProjectOptions(subProjectsData, subProject);
  const listOptions = useListOptions(listsData, space === 'all');
  const folderOptions = useFolderOptions(foldersData, space === 'all');

  // ── Query ─────────────────────────────────────────────────────────────────
  const params: WorkParams = useMemo(() => ({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    from: fromDate || undefined,
    to: toDate || undefined,
    spaceId,
    search: search || undefined,
    status: csv(status),
    priority: csv(priority),
    type: type || undefined,
    assignedTo: csv(assignedTo),
    loggedBy: csv(loggedBy),
    client: csv(client),
    subProject: csv(subProject),
    listId: csv(listIds),
    folderId: csv(folderIds),
    archived,
    sprintStatus: sprintStatus !== 'all' ? sprintStatus : undefined,
    chargeable: chargeable !== 'all' ? chargeable : undefined,
    costStatus: missingOnly ? undefined : csv(costStatus),
    missingOnly: missingOnly ? 'true' : undefined,
    sort: sort.key,
    dir: sort.dir,
  }), [pageSize, page, fromDate, toDate, spaceId, search, status, priority, type, assignedTo, loggedBy, client, subProject, listIds, folderIds, archived, sprintStatus, chargeable, costStatus, missingOnly, sort]);

  const workQuery = useWork(params);
  const items = useMemo(() => workQuery.data?.items ?? [], [workQuery.data]);
  const total = workQuery.data?.total ?? 0;
  const totals = workQuery.data?.totals;

  /** Filter-set identity without paging — scopes selection and expansion. */
  const filterKey = useMemo(() => JSON.stringify({ ...params, limit: undefined, offset: undefined, sort: undefined, dir: undefined }), [params]);
  const pageKey = useMemo(() => JSON.stringify(params), [params]);

  const entryFiltersActive = loggedBy.length > 0 || costStatus.length > 0 || missingOnly;

  // ── Expansion: auto-open matching tasks while entry filters are on ────────
  const [expanded, setExpanded] = useState<{ key: string; ids: (string | number)[] }>({ key: '', ids: [] });
  const autoOpen = useMemo(
    () => (entryFiltersActive ? items.filter((r) => r.logged).map((r) => r.taskId) : []),
    [entryFiltersActive, items],
  );
  const expandedKeys = expanded.key === pageKey ? expanded.ids : autoOpen;
  const expandable = items.filter((r) => r.logged).map((r) => r.taskId);
  const allOpen = expandable.length > 0 && expandable.every((id) => expandedKeys.includes(id));

  // ── Selection: one kind at a time (spec, Rule 3) ──────────────────────────
  const taskSel = useRowSelection<WorkRow>(filterKey);
  const entrySel = useRowSelection<TimeEntryItem>(filterKey);
  const selectableTask = (r: WorkRow) => r.taskId !== NO_TASK_ID && !r.isDeleted;
  const toggleTask = (key: string | number, row: WorkRow) => {
    if (!selectableTask(row)) return;
    entrySel.clear();
    taskSel.toggleRow(key, row);
  };
  const toggleTaskPage = (entries: { key: string | number; row: WorkRow }[], select: boolean) => {
    entrySel.clear();
    // DataTable counts unselectable rows (deleted, "(No task)") toward "whole page selected", so its
    // header would never clear on such a page. Decide from the selectable rows instead.
    const selectable = entries.filter((e) => selectableTask(e.row));
    const allSelected = selectable.length > 0 && selectable.every((e) => taskSel.selectedKeys.includes(e.key));
    taskSel.togglePage(selectable, allSelected ? false : select);
  };
  const toggleEntry = (e: TimeEntryItem) => {
    taskSel.clear();
    entrySel.toggleRow(e.timeEntryId, e);
  };
  const selectedEntryIds = useMemo(() => new Set(entrySel.selectedKeys.map(String)), [entrySel.selectedKeys]);

  // ── Drawers / modal / mutations ───────────────────────────────────────────
  const [selectedTask, setSelectedTask] = useState<WorkRow | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<TimeEntryItem | null>(null);
  const [chargeableTarget, setChargeableTarget] = useState<{ taskIds: string[]; chargeable: boolean; clearSelectionOnApply: boolean } | null>(null);
  const setOverride = useSetEntryChargeableOverride();
  const applyOverride = (value: boolean | null) => {
    const ids = entrySel.selectedRows.map((r) => r.timeEntryId);
    if (ids.length) setOverride.mutate({ timeEntryIds: ids, chargeable: value }, { onSuccess: () => entrySel.clear() });
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const clearEntryFilters = () => { setLoggedBy([]); setCostStatus([]); setMissingOnly(false); setPage(1); };
  const hasFilters = !!(searchRaw || status.length || priority.length || type || assignedTo.length || loggedBy.length
    || client.length || subProject.length || listIds.length || folderIds.length || archived !== 'include'
    || sprintStatus !== 'all' || chargeable !== 'all' || costStatus.length || missingOnly);
  function reset() {
    setSearchRaw(''); setSearch(''); setStatus([]); setPriority([]); setType(''); setAssignedTo([]);
    setClient([]); setSubProject([]); setListIds([]); setFolderIds([]); setArchived('include');
    setSprintStatus('all'); setChargeable('all');
    clearEntryFilters();
  }

  // ── Entry-filter banner text ──────────────────────────────────────────────
  const bannerText = useMemo(() => {
    const parts: string[] = [];
    if (loggedBy.length) {
      const names = loggedBy.map((id) => loggedByOptions.find((o) => o.value === id)?.label ?? id);
      parts.push(`${names.join(', ')}'s time`);
    }
    if (missingOnly) parts.push('entries missing a rate');
    else if (costStatus.length) parts.push(`entries with status ${costStatus.map((s) => COST_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s).join(', ')}`);
    return `Totals count only ${parts.join(' and only ')} in the range.`;
  }, [loggedBy, loggedByOptions, missingOnly, costStatus]);

  // ── Export: Tasks + Entries sheets from the same filters ──────────────────
  const [exportNote, setExportNote] = useState<string | null>(null);
  const exportExcel = useMutation({
    mutationFn: async () => {
      setExportNote(null);
      const full = { ...params, limit: 5000, offset: 0 };
      const tasks = taskSel.count > 0 ? taskSel.selectedRows : (await reportsApi.work(full)).items;
      let entries: WorkEntry[];
      if (entrySel.count > 0) {
        entries = entrySel.selectedRows.map((e) => ({
          timeEntryId: e.timeEntryId, taskId: e.taskId, taskName: e.taskName, userId: e.userId, userName: e.userName,
          userEmail: e.userEmail, startTime: e.startTime, endTime: e.endTime, durationHours: e.durationHours,
          hourlyRateCents: e.hourlyRateCents, costCents: Math.round(e.costAud * 100), currency: e.currency ?? 'USD',
          status: e.status, chargeable: e.chargeable, chargeableOverride: e.chargeableOverride, description: e.description,
        }));
      } else {
        const res = await reportsApi.workEntries(full);
        if (res.truncated) {
          // Refuse rather than write a workbook whose two sheets disagree.
          setExportNote('Too many entries to export (over 5,000). Narrow the date range or filters, then export again.');
          return;
        }
        const ids = new Set(tasks.map((t) => t.taskId));
        entries = res.items.filter((e) => ids.has(e.taskId ?? NO_TASK_ID));
      }
      const taskCols: XlsxColumn<WorkRow>[] = [
        { header: 'Task ID', value: 'taskId' },
        { header: 'Task name', value: (r) => r.taskName ?? '(No task)', width: 42 },
        { header: 'Status', value: 'status' },
        { header: 'Chargeable', value: (r) => (r.chargeable === 'yes' ? 'Yes' : r.chargeable === 'no' ? 'No' : 'Partial') },
        { header: 'Assignees', value: 'assigneesNames', width: 30 },
        { header: 'Client', value: 'client' },
        { header: 'Sub-project', value: (r) => subProjectsOf(r).join(', ') },
        { header: 'List', value: 'listName' },
        { header: 'Est. hours', value: 'timeEstimateHours', type: 'number' },
        { header: 'Logged hours (in range)', value: (r) => r.logged?.hours ?? 0, type: 'number' },
        { header: 'Chargeable hours (in range)', value: (r) => r.logged?.chargeableHours ?? 0, type: 'number' },
        { header: 'Cost (rated entries)', value: (r) => (r.logged?.costCents ?? 0) / 100, type: 'money' },
        { header: 'Currency', value: (r) => r.logged?.currency ?? '' },
        { header: 'Entries missing a rate', value: (r) => r.logged?.missingRateCount ?? 0, type: 'integer' },
        { header: 'Lifetime hours (ClickUp, ignores range)', value: 'lifetimeSpentHours', type: 'number' },
        { header: 'In range because', value: 'inRangeBecause' },
        { header: 'Deleted', value: (r) => (r.isDeleted ? 'Yes' : '') },
        { header: 'Updated', value: 'updatedDate', type: 'date' },
      ];
      const entryCols: XlsxColumn<WorkEntry>[] = [
        { header: 'Time entry ID', value: 'timeEntryId' },
        { header: 'Task ID', value: 'taskId' },
        { header: 'Task name', value: (e) => e.taskName ?? '(No task)', width: 42 },
        { header: 'Logged by', value: 'userName', width: 24 },
        { header: 'Email', value: 'userEmail', width: 28 },
        { header: 'Start', value: 'startTime', type: 'date' },
        { header: 'End', value: 'endTime', type: 'date' },
        { header: 'Duration (h)', value: 'durationHours', type: 'number' },
        { header: 'Chargeable', value: (e) => (e.chargeable ? 'Yes' : 'No') },
        { header: 'Override', value: (e) => (e.chargeableOverride === null ? '' : e.chargeableOverride ? 'Chargeable' : 'Non-chargeable') },
        { header: 'Hourly rate', value: (e) => e.hourlyRateCents / 100, type: 'money' },
        { header: 'Cost', value: (e) => (e.status === 'NO_RATE_FOUND' ? null : e.costCents / 100), type: 'money' },
        { header: 'Currency', value: 'currency' },
        { header: 'Status', value: 'status' },
        { header: 'Description', value: 'description', width: 42 },
      ];
      await exportXlsxSheets('tasks-and-time', [
        xlsxSheet({ sheetName: 'Tasks', rows: tasks, columns: taskCols }),
        xlsxSheet({ sheetName: 'Entries', rows: entries, columns: entryCols }),
      ]);
    },
  });

  // ── Columns ───────────────────────────────────────────────────────────────
  const columns: Column<WorkRow>[] = useMemo(() => [
    {
      key: 'name', header: 'Task', width: 340,
      render: (r) => {
        const noTask = r.taskId === NO_TASK_ID;
        const isSubtask = !!r.parentTaskId;
        return (
          <div title={noTask ? 'Time entries with no task' : REASON[r.inRangeBecause]} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: 290, overflow: 'hidden', paddingLeft: isSubtask ? 14 : 0 }}>
            {isSubtask && <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--text-faint)', flexShrink: 0 }} />}
            <span style={{ width: 4, height: 16, borderRadius: 2, background: String(r.statusColor ?? '#94a3b8'), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, fontStyle: noTask ? 'italic' : 'normal', color: noTask || r.isDeleted ? 'var(--text-muted)' : 'var(--text)' }}>
              {noTask ? '(No task)' : r.taskName}
            </span>
            {r.isDeleted && <Pill tone="gray" size="xs">deleted</Pill>}
            {r.archived && <Pill tone="gray" size="xs">archived</Pill>}
          </div>
        );
      },
    },
    { key: 'status', header: 'Status', width: 120, sortable: false, render: (r) => (r.status ? <StatusBadge status={r.status} color={r.statusColor ?? undefined} /> : blank(null)) },
    {
      key: 'charge', header: 'Charge', width: 120, sortable: false,
      render: (r) => {
        const title = r.chargeableSource === 'entries' ? 'From the time logged in the range' : 'From the task flag and its rules (no time logged in the range)';
        return (
          <span title={title}>
            {r.chargeable === 'partial' ? <Pill tone="blue" size="xs">partial</Pill>
              : r.chargeable === 'no' ? <Pill tone="gray" size="xs">non-chargeable</Pill>
                : <Pill tone="green" size="xs">chargeable</Pill>}
          </span>
        );
      },
    },
    {
      key: 'assignees', header: 'Assignees', width: 110, sortable: false,
      render: (r) => { const users = parseAssignees(r); return users.length ? <ClickupAvatarStack users={users} max={3} /> : blank(null); },
    },
    { key: 'est', header: 'Est', width: 70, align: 'right', sortable: false, render: (r) => (r.timeEstimateHours != null ? <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{fmt.shortHours(r.timeEstimateHours)}</span> : blank(null)) },
    { key: 'logged', header: 'Logged', width: 90, align: 'right', render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.duration(r.logged?.hours ?? 0)}</span> },
    { key: 'lifetime', header: 'Lifetime (ClickUp)', width: 130, align: 'right', sortable: false, render: (r) => (r.lifetimeSpentHours != null ? <span title="ClickUp's own total — ignores the date range" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{fmt.shortHours(r.lifetimeSpentHours)}</span> : blank(null)) },
    { key: 'cost', header: 'Cost', width: 100, align: 'right', render: (r) => (r.logged && r.logged.costCents > 0 ? <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.money(r.logged.costCents, r.logged.currency)}</span> : blank(null)) },
    {
      key: 'rates', header: 'Rates', width: 120, sortable: false,
      render: (r) => {
        const l = r.logged;
        if (!l) return blank(null);
        if (r.chargeable === 'no') return <span style={{ color: 'var(--text-faint)' }}>n/a</span>;
        if (l.missingRateCount > 0) return <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} strokeWidth={2} />}>{l.missingRateCount} missing</Pill>;
        if (l.excludedCount >= l.entryCount) return <Pill tone="gray" size="xs">excluded</Pill>;
        if (l.excludedCount > 0) return <Pill tone="gray" size="xs">{l.excludedCount} excluded</Pill>;
        return <Pill tone="green" size="xs">all costed</Pill>;
      },
    },
    { key: 'lastActivity', header: 'Last logged', width: 100, align: 'right', render: (r) => (r.logged?.lastActivity ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt.relative(r.logged.lastActivity)}</span> : blank(null)) },
    { key: 'client', header: 'Client', width: 130, sortable: false, render: (r) => (r.client ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.client}</span> : blank(null)) },
    { key: 'sub_projects', header: 'Sub-project', width: 140, sortable: false, render: (r) => { const s = subProjectsOf(r); return s.length ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.join(', ')}</span> : blank(null); } },
    { key: 'list', header: 'List', width: 120, sortable: false, render: (r) => (r.listName ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.listName}</span> : blank(null)) },
    { key: 'sprint', header: 'Sprint', width: 100, sortable: false, render: (r) => (r.sprintName ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.sprintName}</span> : blank(null)) },
    { key: 'points', header: 'Pts', width: 60, align: 'right', sortable: false, render: (r) => (r.sprintPoints ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.sprintPoints}</span> : blank(null)) },
    { key: 'updated', header: 'Updated', width: 100, align: 'right', render: (r) => (r.updatedDate ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt.relative(r.updatedDate)}</span> : blank(null)) },
  ], []);

  // ── Selection bar content ─────────────────────────────────────────────────
  const selectionStats: SelectionStat[] = useMemo(() => {
    if (taskSel.count > 0) {
      const rows = taskSel.selectedRows;
      return [
        { label: 'logged', value: fmt.hours(rows.reduce((n, r) => n + (r.logged?.hours ?? 0), 0)) },
        { label: 'cost', value: fmt.money(rows.reduce((n, r) => n + (r.logged?.costCents ?? 0), 0)) },
      ];
    }
    const rows = entrySel.selectedRows;
    return [
      { label: 'total', value: fmt.hours(rows.reduce((n, r) => n + r.durationHours, 0)) },
      { label: 'chargeable', value: fmt.hours(rows.filter((r) => r.chargeable).reduce((n, r) => n + r.durationHours, 0)) },
    ];
  }, [taskSel.count, taskSel.selectedRows, entrySel.selectedRows]);

  // What "Use task setting" will fall back to, when every selected entry is on one task.
  const useTaskSettingTitle = useMemo(() => {
    const taskIds = new Set(entrySel.selectedRows.map((e) => e.taskId));
    const base = 'Removes the manual setting. Each entry then follows its per-assignee rule, or else the task flag.';
    if (taskIds.size !== 1) return base;
    const row = items.find((r) => r.taskId === [...taskIds][0]);
    if (!row || row.isChargeable == null) return base;
    return `${base} This task is ${row.isChargeable ? 'chargeable' : 'non-chargeable'}.`;
  }, [entrySel.selectedRows, items]);

  const selectionActions = !canEdit ? undefined : taskSel.count > 0 ? (
    <>
      <Button size="sm" variant="subtle" onClick={() => setChargeableTarget({ taskIds: taskSel.selectedRows.map((r) => r.taskId), chargeable: true, clearSelectionOnApply: true })}>Mark chargeable</Button>
      <Button size="sm" variant="subtle" onClick={() => setChargeableTarget({ taskIds: taskSel.selectedRows.map((r) => r.taskId), chargeable: false, clearSelectionOnApply: true })}>Mark non-chargeable</Button>
    </>
  ) : entrySel.count > 0 ? (
    <>
      <Button size="sm" variant="default" disabled={setOverride.isPending} onClick={() => applyOverride(true)}>Mark chargeable</Button>
      <Button size="sm" variant="default" disabled={setOverride.isPending} onClick={() => applyOverride(false)}>Mark non-chargeable</Button>
      <span title={useTaskSettingTitle}>
        <Button size="sm" variant="ghost" disabled={setOverride.isPending} onClick={() => applyOverride(null)}>Use task setting</Button>
      </span>
    </>
  ) : undefined;

  const chargeablePct = totals && totals.hours > 0 ? Math.round((totals.chargeableHours / totals.hours) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Tasks & time"
        description="Every task with activity in the date range, and the time logged on it."
        badge={<Pill tone="purple">Beta</Pill>}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {FEEDBACK_URL && <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Give feedback</a>}
            <Button variant="subtle" size="md" onClick={() => setExpanded({ key: pageKey, ids: allOpen ? [] : expandable })} disabled={!expandable.length}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
            <Button variant="subtle" size="md" icon={<Download size={13} strokeWidth={1.75} />} loading={exportExcel.isPending} disabled={exportExcel.isPending || workQuery.isLoading} onClick={() => exportExcel.mutate()}>
              {taskSel.count > 0 ? `Export selected (${taskSel.count})` : entrySel.count > 0 ? `Export selected (${entrySel.count})` : 'Export Excel'}
            </Button>
          </div>
        }
      />

      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', maxWidth: '80ch' }}>
        A task is listed if it was updated or had time logged in the range. Logged and Cost count only time logged in the range, so they can differ from the Tasks page&apos;s Spent column. Deleted tasks&apos; time is counted in every space.
      </p>
      {exportNote && <Pill tone="amber">{exportNote}</Pill>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <MetricCard dense label="Tasks" value={fmt.number(total)} sublabel="with activity in range" icon={<ListTree size={13} strokeWidth={1.75} />} />
        <MetricCard dense label="Logged in range" value={fmt.hours(totals?.hours ?? 0)} sublabel={`${fmt.number(totals?.entries ?? 0)} entries`} icon={<Clock size={13} strokeWidth={1.75} />} />
        <MetricCard dense label="Chargeable" value={fmt.hours(totals?.chargeableHours ?? 0)} sublabel={`${chargeablePct}%`} icon={<DollarSign size={13} strokeWidth={1.75} />} />
        <MetricCard dense label="Cost" value={fmt.money(totals?.costCents ?? 0)} sublabel="rated entries only" icon={<DollarSign size={13} strokeWidth={1.75} />} />
        <MetricCard dense label="Missing rates" value={fmt.number(totals?.missingRateCount ?? 0)} sublabel="entries need a rate" icon={<AlertTriangle size={13} strokeWidth={1.75} />} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div style={{ flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Input icon={<Search size={14} strokeWidth={1.75} />} value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} placeholder="Search task, ID, client, list, sprint, entry ID…" aria-label="Search tasks and entries" />
        </div>
        <MultiSelect ariaLabel="Filter by who logged the time" size="md" allLabel="Logged by: anyone" value={loggedBy} onChange={on(setLoggedBy)} options={loggedByOptions} />
        <MultiSelect ariaLabel="Filter by client" size="md" allLabel="Any client" value={client} onChange={on(setClient)} options={clientOptions} />
        <MultiSelect ariaLabel="Filter by sub-project" size="md" allLabel="Any sub-project" value={subProject} onChange={on(setSubProject)} options={subProjectOptions} />
        <MultiSelect ariaLabel="Filter by folder" size="md" allLabel="Any folder" value={folderIds} onChange={on(setFolderIds)} options={folderOptions} />
        <MultiSelect ariaLabel="Filter by list" size="md" allLabel="Any list" value={listIds} onChange={on(setListIds)} options={listOptions} />
        <MultiSelect ariaLabel="Filter by status" size="md" allLabel="Any status" value={status} onChange={on(setStatus)} options={statusOptions} />
        <Select ariaLabel="Filter by chargeability" size="md" value={chargeable} onChange={on(setChargeable)} options={CHARGEABLE_OPTIONS} />
        <MultiSelect ariaLabel="Filter by cost status" size="md" allLabel="Any cost status" value={costStatus} onChange={on(setCostStatus)} options={COST_STATUS_OPTIONS} disabled={missingOnly} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Switch ariaLabel="Show only entries missing a rate" checked={missingOnly} onChange={on(setMissingOnly)} />
          <span>Missing rate only</span>
        </label>
        <Button size="md" variant="ghost" onClick={() => setMoreFilters((v) => !v)} aria-expanded={moreFilters}>{moreFilters ? 'Fewer filters' : 'More filters'}</Button>
        {moreFilters && (
          <>
            <MultiSelect ariaLabel="Filter by task assignee" size="md" allLabel="Assigned to: anyone" value={assignedTo} onChange={on(setAssignedTo)} options={assignedToOptions} />
            <MultiSelect ariaLabel="Filter by priority" size="md" allLabel="Any priority" value={priority} onChange={on(setPriority)} options={PRIORITY_OPTIONS} />
            <Select ariaLabel="Filter by task type" size="md" value={type} onChange={on(setType)} options={TYPE_OPTIONS} />
            <Select ariaLabel="Filter by sprint status" size="md" value={sprintStatus} onChange={on(setSprintStatus)} options={SPRINT_STATUS_OPTIONS} />
            <Select ariaLabel="Filter by archived state" size="md" value={archived} onChange={on(setArchived)} options={ARCHIVED_OPTIONS} />
          </>
        )}
        {hasFilters && <Button size="md" variant="ghost" icon={<X size={13} strokeWidth={1.75} />} onClick={reset}>Reset</Button>}
      </div>

      {entryFiltersActive && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--muted-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}>
          <Pill tone="blue" size="xs">entry filter</Pill>
          <span style={{ color: 'var(--text)' }}>{bannerText}</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon={<X size={12} strokeWidth={1.75} />} onClick={clearEntryFilters}>Clear</Button>
        </div>
      )}

      <SelectionBar
        count={taskSel.count || entrySel.count}
        noun={taskSel.count > 0 ? 'task' : 'entry'}
        nounPlural={taskSel.count > 0 ? 'tasks' : 'entries'}
        stats={selectionStats}
        onClear={() => { taskSel.clear(); entrySel.clear(); }}
        actions={selectionActions}
      />

      <QueryError query={workQuery} what="tasks and time" />

      <DataTable<WorkRow>
        layout="design"
        stickyFirstColumn
        rowKey="taskId"
        columns={columns}
        data={items}
        loading={workQuery.isLoading}
        emptyTitle="No task activity matches these filters"
        emptyBody="Widen the date range or clear some filters."
        emptyIcon={<Inbox size={20} strokeWidth={1.75} />}
        emptyAction={hasFilters ? <Button variant="default" size="md" onClick={reset}>Clear all filters</Button> : undefined}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        pageSizeOptions={[25, 50, 100]}
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        hiddenColumns={hiddenCols}
        onHiddenColumnsChange={setHiddenCols}
        onRowClick={(r) => { if (r.taskId !== NO_TASK_ID) setSelectedTask(r); }}
        selectedKeys={taskSel.selectedKeys}
        onToggleRow={toggleTask}
        onTogglePage={toggleTaskPage}
        expandedKeys={expandedKeys}
        onToggleExpand={(key) => setExpanded({
          key: pageKey,
          ids: expandedKeys.includes(key) ? expandedKeys.filter((k) => k !== key) : [...expandedKeys, key],
        })}
        renderExpanded={(row) => (row.logged
          ? <WorkEntryRows taskId={row.taskId} params={params} selectedIds={selectedEntryIds} onToggle={toggleEntry} onOpen={setSelectedEntry} />
          : <div style={{ padding: '10px 14px 10px 46px', fontSize: 12, color: 'var(--text-muted)' }}>No time logged on this task in the range.</div>)}
      />

      <TaskDetailDrawer
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        // A deleted task is listed for its time only — no task-level actions (spec, "Special rows").
        canEdit={canEdit && !selectedTask?.isDeleted}
        onSetChargeable={(taskId, next) => setChargeableTarget({ taskIds: [taskId], chargeable: next, clearSelectionOnApply: false })}
      />
      <TimeEntryDrawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />

      {chargeableTarget && (
        <ChargeableConfirmModal
          taskIds={chargeableTarget.taskIds}
          chargeable={chargeableTarget.chargeable}
          onClose={(changed) => {
            const { taskIds, chargeable: next, clearSelectionOnApply } = chargeableTarget;
            setChargeableTarget(null);
            if (!changed) return;
            if (clearSelectionOnApply) taskSel.clear();
            setSelectedTask((prev) => (prev && taskIds.includes(prev.taskId) ? { ...prev, isChargeable: next } : prev));
          }}
        />
      )}
    </div>
  );
}
