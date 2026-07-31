import { useEffect, useMemo, useState } from 'react';
import { Search, Download, X, Inbox, Rocket } from 'lucide-react';
import {
  useSprints,
  useSprintFolders,
  useSprintVelocity,
  useSprintDetail,
  type SprintRow,
} from '../hooks/useReports';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { DataTable } from '../components/ui/DataTable';
import type { Column } from '../components/ui/DataTable';
import { QueryError } from '../components/ui/QueryError';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Card } from '../components/ui/Card';
import { DonutChart } from '../components/charts/DonutChart';
import { BarChart } from '../components/charts/BarChart';
import { ClickupAvatar } from '../components/ui/ClickupAvatar';
import { fmt } from '../lib/formatters';
import { toCsv, downloadCsv, csvFilename, type CsvColumn } from '../lib/csv';

// Backend returns dollars (`cost_cents / 100`); fmt.money expects cents. The
// `*Aud` field name is legacy — the project's actual currency is USD (see the
// currency-aud-usd-debt note) — this only fixes the unit, not the label.
function moneyAud(dollars: number) {
  return fmt.money(Math.round(dollars * 100));
}

const SPRINT_STATUS_OPTIONS = [
  { value: 'all', label: 'All sprints' },
  { value: 'active', label: 'Active sprints' },
  { value: 'completed', label: 'Completed (archived) sprints' },
];

// DataTable's generic is constrained to `{ [key: string]: unknown }`. SprintRow
// is declared as an `interface`, which TS does not treat as having an implicit
// index signature — this intersection satisfies the constraint without
// touching the shared hook type.
type SprintTableRow = SprintRow & Record<string, unknown>;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 8, background: 'var(--muted-bg)', borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function SprintDetailPanel({ listId }: { listId: string }) {
  const detailQuery = useSprintDetail(listId);
  const detail = detailQuery.data;

  return (
    <Card title="Sprint detail" subtitle={detail?.list.name} padding={16}>
      <QueryError query={detailQuery} what="sprint detail" />
      {detailQuery.isLoading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : detail ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <DonutChart
            data={detail.byStatus.map((s) => ({ label: s.status, value: s.count, color: s.color ?? undefined }))}
            size={140}
            thickness={14}
            centerLabel="Done"
            centerValue={`${detail.list.pctDone}%`}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
            <Stat label="Tasks done" value={`${fmt.number(detail.list.taskDone)}/${fmt.number(detail.list.taskTotal)}`} />
            <Stat label="Open" value={fmt.number(Math.max(0, detail.list.taskTotal - detail.list.taskDone))} />
            <Stat label="Hours" value={fmt.hours(detail.list.hours)} />
            <Stat label="Cost" value={moneyAud(detail.list.costAud)} />
            <Stat label="Assignees" value={fmt.number(detail.assigneeCount)} />
            <Stat label="Cycle time" value={detail.cycleTimeHours != null ? fmt.duration(detail.cycleTimeHours) : '—'} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Hours by assignee
            </div>
            <BarChart
              data={detail.byAssignee.map((a) => ({
                label: a.userName,
                value: a.hours,
                leading: <ClickupAvatar name={a.userName} size={18} />,
              }))}
              direction="horizontal"
              formatValue={fmt.hours}
              maxHeight={240}
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function SprintsPage() {
  const { space } = useGlobalFilters();

  // Debounced search: typing fires `searchRaw` immediately, but the request
  // (and `page=1` reset) only fire after 300ms of quiet, matching TasksPage.
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [folderId, setFolderId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);

  const foldersQuery = useSprintFolders(space !== 'all' ? space : undefined);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchRaw);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  // A folder belongs to a single space, so a selection made under one space is
  // meaningless after the topbar space changes — clear it (mirrors TasksPage).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFolderId('');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [space]);

  const folderOptions = useMemo(() => {
    const rows = foldersQuery.data ?? [];
    const opts: { value: string; label: string }[] = [{ value: '', label: 'All folders' }];
    for (const f of rows) {
      if (!f.folderId) continue;
      opts.push({ value: f.folderId, label: `${f.folderName ?? '(no folder)'} (${f.activeCount} active / ${f.completedCount} done)` });
    }
    return opts;
  }, [foldersQuery.data]);

  const sprintParams = useMemo(
    () => ({
      spaceId: space !== 'all' ? space : undefined,
      folderId: folderId || undefined,
      status,
      search: search || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [space, folderId, status, search, page, pageSize],
  );

  const sprintsQuery = useSprints(sprintParams as Record<string, string | number | undefined>);
  const velocityQuery = useSprintVelocity(folderId || undefined);

  const items: SprintTableRow[] = (sprintsQuery.data?.items ?? []) as SprintTableRow[];
  const total = sprintsQuery.data?.total ?? 0;

  const hasFilters = !!(searchRaw || search || status !== 'active' || folderId);

  function reset() {
    setSearchRaw('');
    setSearch('');
    setStatus('active');
    setFolderId('');
    setPage(1);
  }

  // Velocity comes back newest-sprint-first (ORDER BY due_date DESC); reverse
  // so the bar chart reads left-to-right as a normal time series.
  const velocityData = useMemo(() => {
    const rows = velocityQuery.data ?? [];
    return [...rows].reverse().map((v) => ({ label: v.name, value: v.taskDone }));
  }, [velocityQuery.data]);

  function handleExport() {
    const rows = sprintsQuery.data?.items ?? [];
    const cols: CsvColumn<SprintRow>[] = [
      { header: 'Sprint', value: 'name' },
      { header: 'Folder', value: (r) => r.folderName ?? '' },
      { header: 'Space', value: (r) => r.spaceName ?? '' },
      { header: 'Status', value: (r) => (r.archived ? 'Completed' : 'Active') },
      { header: 'Start date', value: (r) => r.startDate ?? '' },
      { header: 'Due date', value: (r) => r.dueDate ?? '' },
      { header: 'Tasks done', value: 'taskDone' },
      { header: 'Tasks total', value: 'taskTotal' },
      { header: '% done', value: 'pctDone' },
      { header: 'Hours', value: (r) => r.hours.toFixed(2) },
      { header: 'Cost (USD)', value: (r) => r.costAud.toFixed(2) },
    ];
    downloadCsv(csvFilename('sprints'), toCsv(rows, cols));
  }

  const columns: Column<SprintTableRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Sprint',
        width: 280,
        render: (r) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[r.spaceName, r.folderName].filter(Boolean).join(' · ') || '—'}
            </span>
          </div>
        ),
      },
      {
        key: 'dueDate',
        header: 'Dates',
        width: 170,
        render: (r) => (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {r.startDate ? fmt.shortDate(r.startDate) : '—'} – {r.dueDate ? fmt.shortDate(r.dueDate) : '—'}
          </span>
        ),
      },
      {
        key: 'archived',
        header: 'Status',
        width: 110,
        render: (r) => <StatusBadge status={r.archived ? 'Completed' : 'Active'} />,
      },
      {
        key: 'pctDone',
        header: '% Done',
        width: 170,
        render: (r) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 6, background: 'var(--muted-bg)', borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, r.pctDone))}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  borderRadius: 999,
                  transition: 'width 200ms ease-out',
                }}
              />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', width: 76, textAlign: 'right', flexShrink: 0 }}>
              {r.taskDone}/{r.taskTotal} ({r.pctDone}%)
            </span>
          </div>
        ),
      },
      {
        key: 'hours',
        header: 'Hours',
        width: 90,
        align: 'right',
        render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{fmt.hours(r.hours)}</span>,
      },
      {
        key: 'costAud',
        header: 'Cost',
        width: 100,
        align: 'right',
        render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{moneyAud(r.costAud)}</span>,
      },
    ],
    [],
  );

  const selectedFolderLabel = folderOptions.find((f) => f.value === folderId)?.label;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Sprints"
        description="Sprint completion, cost, and velocity across ClickUp sprint lists."
        badge={<Pill tone="gray">{fmt.number(total)}</Pill>}
        actions={
          <Button
            variant="subtle"
            size="md"
            icon={<Download size={13} strokeWidth={1.75} />}
            disabled={items.length === 0}
            onClick={handleExport}
            title="Exports the current page only, not the full filtered set"
          >
            Export page
          </Button>
        }
      />

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Input
            icon={<Search size={14} strokeWidth={1.75} />}
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder="Search sprint name…"
            aria-label="Search sprints"
          />
        </div>
        <Select
          ariaLabel="Filter by sprint folder"
          size="md"
          value={folderId}
          onChange={(v) => { setFolderId(v); setPage(1); }}
          options={folderOptions}
        />
        <Select
          ariaLabel="Filter by sprint status"
          size="md"
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={SPRINT_STATUS_OPTIONS}
        />
        {hasFilters && (
          <Button size="md" variant="ghost" icon={<X size={13} strokeWidth={1.75} />} onClick={reset}>Reset</Button>
        )}
      </div>

      <QueryError queries={[sprintsQuery]} what="sprints" />

      <DataTable
        layout="design"
        rowKey="listId"
        columns={columns}
        data={items}
        loading={sprintsQuery.isLoading}
        emptyTitle="No sprints match your filters"
        emptyBody="Try clearing filters or picking a different folder."
        emptyIcon={<Inbox size={20} strokeWidth={1.75} />}
        emptyAction={<Button variant="default" size="md" onClick={reset}>Clear all filters</Button>}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(p) => setPage(p)}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        pageSizeOptions={[10, 25, 50, 100]}
        onRowClick={(r) => setSelectedListId(r.listId)}
        initialSort={{ key: 'dueDate', dir: 'desc' }}
      />

      {selectedListId ? (
        <SprintDetailPanel listId={selectedListId} />
      ) : (
        <Card title="Sprint detail" padding={16}>
          <EmptyState
            title="Select a sprint"
            body="Click a row in the table above to see its completion, assignee hours, and cycle time."
            icon={<Rocket size={20} strokeWidth={1.75} />}
          />
        </Card>
      )}

      <Card
        title="Velocity"
        subtitle={folderId ? `Done tasks per sprint · ${selectedFolderLabel ?? ''}` : 'Pick a folder to compare sprints'}
        padding={16}
      >
        {folderId ? (
          <BarChart data={velocityData} direction="vertical" height={200} formatValue={fmt.number} />
        ) : (
          <EmptyState
            title="Pick a folder"
            body="Velocity compares done tasks per sprint within a folder over time."
            icon={<Rocket size={20} strokeWidth={1.75} />}
          />
        )}
      </Card>
    </div>
  );
}
