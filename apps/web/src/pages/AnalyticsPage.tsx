import { useNavigate } from 'react-router-dom';
import { Clock, DollarSign, AlertTriangle, Download } from 'lucide-react';
import {
  useStats,
  useTasksSummary,
  useTasksBySpaceStatus,
  useTimeEntriesByUser,
  useTimeEntriesByClient,
  useTimeEntriesByDepartment,
  useSprintPoints,
  useOverviewDeltas,
} from '../hooks/useReports';
import { MetricCard } from '../components/ui/MetricCard';
import { Delta } from '../components/ui/Delta';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { Button } from '../components/ui/Button';
import { BarChart } from '../components/charts/BarChart';
import { ClickupAvatar } from '../components/ui/ClickupAvatar';
import { DonutChart } from '../components/charts/DonutChart';
import { CostTrendCard } from '../components/charts/CostTrendCard';
import { AssigneeCostTrendCard } from '../components/charts/AssigneeCostTrendCard';
import { CycleTimeCard } from '../components/charts/CycleTimeCard';
import { fmt } from '../lib/formatters';
import { toCsv, downloadCsv, csvFilename } from '../lib/csv';
import { useGlobalFilters } from '../hooks/useGlobalFilters';

// Backend returns dollars; fmt.money expects cents. USD is the project currency.
function moneyAud(dollars: number) {
  return fmt.money(Math.round(dollars * 100));
}

const STATUS_COLORS: Record<string, string> = {
  open: '#94a3b8',
  'in progress': '#3b82f6',
  'in review': '#a855f7',
  blocked: '#ef4444',
  closed: '#10b981',
  archived: '#64748b',
};

const SPACE_COLORS = ['#7B68EE', '#FF02F0', '#49CCF9', '#10b981', '#f59e0b', '#ef4444'];

// Distinct fallback hues for statuses with no semantic color in STATUS_COLORS,
// so every donut slice is visually distinguishable instead of collapsing to grey.
const STATUS_FALLBACK_PALETTE = [
  '#7B68EE', '#FF02F0', '#49CCF9', '#f59e0b', '#06b6d4', '#ec4899',
  '#84cc16', '#f97316', '#14b8a6', '#6366f1', '#eab308', '#0ea5e9',
  '#d946ef', '#22c55e', '#fb7185', '#94a3b8',
];

type TaskBySpaceRow = { spaceName: string; status: string; count: number };
type UserTimeRow    = { userName: string; totalHours: number; totalCostAud: number };
type ClientTimeRow  = { client: string; totalHours: number; totalCostAud: number };
type DeptTimeRow    = { department: string; totalHours: number; totalCostAud: number };
type SprintPointRow = { spaceName: string; status: string; totalPoints: number };
type Stats          = { missingRateEntries: number };
type TasksSummary   = {
  bySpace: { spaceId: string | null; spaceName: string | null; count: number }[];
  total: number;
};

export function AnalyticsPage() {
  const navigate = useNavigate();
  const { dateRangeLabel, dateRange, customFrom, customTo } = useGlobalFilters();

  const deltasQ = useOverviewDeltas();
  const deltas = deltasQ.data;

  const stats        = useStats();
  const tasksSummary = useTasksSummary();
  const tasksBySpace = useTasksBySpaceStatus();
  const timeByUser   = useTimeEntriesByUser();
  const timeByClient = useTimeEntriesByClient();
  const timeByDept   = useTimeEntriesByDepartment();
  const sprintPoints = useSprintPoints();

  const sd      = stats.data as Stats | undefined;
  const summary = tasksSummary.data as TasksSummary | undefined;
  const rows = (tasksBySpace.data as TaskBySpaceRow[] | undefined) ?? [];

  const totalTasks = summary?.total ?? 0;

  const userRows = (timeByUser.data as UserTimeRow[] | undefined) ?? [];
  const totalHours = userRows.reduce((s, r) => s + r.totalHours, 0);
  const totalCost  = userRows.reduce((s, r) => s + r.totalCostAud, 0);
  const missingRates = sd?.missingRateEntries ?? 0;

  // Short range label for delta pills — derived from the topbar's dateRange.
  const rangeShort = (() => {
    if (dateRange === '24h')  return '24h';
    if (dateRange === '7d')   return '7d';
    if (dateRange === '30d')  return '30d';
    if (dateRange === '90d')  return '90d';
    if (dateRange === 'custom' && customFrom && customTo) {
      const days = Math.max(1, Math.round((new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400000));
      return `${days}d`;
    }
    return 'period';
  })();

  // ── Chart data ───────────────────────────────────────────────────────────────

  // DonutChart: tasks by status (aggregate across spaces)
  const statusMap = new Map<string, number>();
  rows.forEach(r => statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + r.count));
  // Assign each status a color: prefer the semantic STATUS_COLORS mapping, and
  // for anything else hand out the next unused palette hue so no two statuses
  // share a color (the old `?? '#94a3b8'` collapsed every custom status to grey).
  const usedStatusColors = new Set<string>();
  let statusPaletteIdx = 0;
  const nextStatusColor = () => {
    while (statusPaletteIdx < STATUS_FALLBACK_PALETTE.length && usedStatusColors.has(STATUS_FALLBACK_PALETTE[statusPaletteIdx])) {
      statusPaletteIdx++;
    }
    const c = STATUS_FALLBACK_PALETTE[statusPaletteIdx % STATUS_FALLBACK_PALETTE.length];
    statusPaletteIdx++;
    usedStatusColors.add(c);
    return c;
  };
  const tasksByStatusData = Array.from(statusMap.entries()).map(([status, count]) => {
    const semantic = STATUS_COLORS[status.toLowerCase()];
    let color: string;
    if (semantic && !usedStatusColors.has(semantic)) {
      color = semantic;
      usedStatusColors.add(semantic);
    } else {
      color = nextStatusColor();
    }
    return { label: status, value: count, color };
  });

  // BarChart: tasks by space.
  const tasksBySpaceData = (summary?.bySpace ?? [])
    .map((r, i) => ({
      label: (r.spaceName?.trim()) || (r.spaceId ? `Space ${r.spaceId}` : 'Unnamed space'),
      value: r.count,
      color: SPACE_COLORS[i % SPACE_COLORS.length],
    }))
    .sort((a, b) => b.value - a.value);

  // BarChart: time by assignee — all assignees, ranked by hours.
  const timeByUserData = [...userRows]
    .sort((a, b) => b.totalHours - a.totalHours)
    .map((r, i) => ({ label: r.userName, value: r.totalHours, color: SPACE_COLORS[i % SPACE_COLORS.length], leading: <ClickupAvatar name={r.userName} size={18} /> }));

  // BarChart: cost by assignee — all assignees.
  const costByUserData = [...userRows]
    .sort((a, b) => b.totalCostAud - a.totalCostAud)
    .map((r, i) => ({ label: r.userName, value: r.totalCostAud, color: SPACE_COLORS[i % SPACE_COLORS.length], leading: <ClickupAvatar name={r.userName} size={18} /> }));

  // BarChart: cost by department — all departments.
  const deptRows = (timeByDept.data as DeptTimeRow[] | undefined) ?? [];
  const costByDeptData = [...deptRows]
    .sort((a, b) => b.totalCostAud - a.totalCostAud)
    .map((r, i) => ({ label: r.department, value: r.totalCostAud, color: SPACE_COLORS[i % SPACE_COLORS.length] }));

  // BarChart: cost by client — all clients.
  const clientRows = (timeByClient.data as ClientTimeRow[] | undefined) ?? [];
  const costByClientData = [...clientRows]
    .sort((a, b) => b.totalCostAud - a.totalCostAud)
    .map((r, i) => ({
      label: r.client,
      value: Math.round(r.totalCostAud * 100),
      color: SPACE_COLORS[i % SPACE_COLORS.length],
    }));

  // BarChart: sprint points
  const sprintMap = new Map<string, number>();
  ((sprintPoints.data as SprintPointRow[] | undefined) ?? []).forEach(r => {
    sprintMap.set(r.spaceName, (sprintMap.get(r.spaceName) ?? 0) + r.totalPoints);
  });
  const sprintData = Array.from(sprintMap.entries()).map(([label, value], i) => ({
    label, value, color: SPACE_COLORS[i % SPACE_COLORS.length],
  }));

  // Flatten every breakdown on the page into one long-format CSV. Costs/hours
  // are emitted as raw numbers (not "$1,234.00") so they stay spreadsheet-usable;
  // empty cells where a metric doesn't apply to that category.
  function handleExport() {
    type Row = { category: string; label: string; hours?: number; cost?: number; tasks?: number; points?: number };
    const rows: Row[] = [];
    tasksByStatusData.forEach((d) => rows.push({ category: 'Tasks by status', label: d.label, tasks: d.value }));
    tasksBySpaceData.forEach((d) => rows.push({ category: 'Tasks by space', label: d.label, tasks: d.value }));
    userRows.forEach((r) => rows.push({ category: 'Time by assignee', label: r.userName, hours: r.totalHours, cost: r.totalCostAud }));
    clientRows.forEach((r) => rows.push({ category: 'Time by client', label: r.client, hours: r.totalHours, cost: r.totalCostAud }));
    deptRows.forEach((r) => rows.push({ category: 'Time by department', label: r.department, hours: r.totalHours, cost: r.totalCostAud }));
    sprintData.forEach((d) => rows.push({ category: 'Sprint points by space', label: d.label, points: d.value }));
    downloadCsv(
      csvFilename('analytics'),
      toCsv(rows, [
        { header: 'Category', value: 'category' },
        { header: 'Label', value: 'label' },
        { header: 'Hours', value: (r) => (r.hours != null ? r.hours.toFixed(2) : '') },
        { header: 'Cost (USD)', value: (r) => (r.cost != null ? r.cost.toFixed(2) : '') },
        { header: 'Tasks', value: (r) => r.tasks ?? '' },
        { header: 'Points', value: (r) => r.points ?? '' },
      ]),
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        title="Analytics"
        description="Cost, time, and delivery analytics across your ClickUp workspace."
        actions={<Button variant="accent" icon={<Download size={13} strokeWidth={1.75} />} onClick={handleExport}>Export</Button>}
      />

      <QueryError
        queries={[stats, tasksSummary, tasksBySpace, timeByUser, timeByClient, timeByDept, sprintPoints]}
        what="analytics data"
      />

      {/* Focused KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <MetricCard
          accent
          label="Time tracked"
          value={timeByUser.isLoading ? '—' : fmt.hours(totalHours)}
          sublabel={dateRangeLabel}
          delta={deltas && <Delta current={deltas.current.totalHours} prior={deltas.prior.totalHours} rangeLabel={rangeShort} />}
          icon={<Clock size={14} strokeWidth={1.75} />}
          onClick={() => navigate('/time-entries')}
        />
        <MetricCard
          label="Calculated cost"
          value={timeByUser.isLoading ? '—' : moneyAud(totalCost)}
          sublabel={dateRangeLabel}
          delta={deltas && <Delta current={deltas.current.totalCostAud} prior={deltas.prior.totalCostAud} rangeLabel={rangeShort} />}
          icon={<DollarSign size={14} strokeWidth={1.75} />}
        />
        <MetricCard
          label="Missing rates"
          value={stats.isLoading ? '—' : fmt.number(missingRates)}
          sublabel={missingRates > 0 ? 'needs review' : 'all costed'}
          delta={missingRates > 0 ? 'needs review' : undefined}
          deltaTone={missingRates > 0 ? 'down' : undefined}
          icon={<AlertTriangle size={14} strokeWidth={1.75} />}
          onClick={() => navigate('/missing-rates')}
        />
      </div>

      {/* Cost trend */}
      <CostTrendCard />

      {/* Assignee cost trend (stacked over time) */}
      <AssigneeCostTrendCard />

      {/* Cycle time */}
      <CycleTimeCard />

      {/* Breakdown charts. Fixed-height rows (gridAutoRows) + default stretch
          alignment make every card the same size regardless of content; the
          Card body scrolls any overflow (e.g. long assignee/status lists). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, gridAutoRows: 320 }}>
        <Card title="Tasks by status" subtitle={`${fmt.number(totalTasks)} total tasks tracked`} padding={16}>
          <DonutChart data={tasksByStatusData} size={140} thickness={14} centerLabel="Total" centerValue={totalTasks} />
        </Card>

        <Card title="Cost by client" subtitle={`By spend · ${costByClientData.length} clients`} padding={16}>
          <BarChart data={costByClientData} direction="horizontal" formatValue={(v) => moneyAud(v / 100)} />
        </Card>

        <Card title="Time tracked by assignee" subtitle={`Hours logged in ${dateRangeLabel} · ${timeByUserData.length} assignees`} padding={16}>
          <BarChart data={timeByUserData} direction="horizontal" formatValue={fmt.hours} />
        </Card>

        <Card title="Cost by assignee" subtitle={`Calculated labor cost · ${costByUserData.length} assignees`} padding={16}>
          <BarChart data={costByUserData} direction="horizontal" formatValue={(v) => moneyAud(v)} />
        </Card>

        <Card title="Cost by department" subtitle="Calculated labor cost" padding={16}>
          <BarChart data={costByDeptData} direction="horizontal" formatValue={v => moneyAud(v)} />
        </Card>

        <Card title="Tasks by space" subtitle="Distribution across workspaces" padding={16}>
          <BarChart data={tasksBySpaceData} direction="horizontal" formatValue={fmt.number} />
        </Card>
      </div>

      {/* Sprint points */}
      {sprintData.length > 0 && (
        <Card title="Sprint points by space" subtitle="Work delivered across active sprints" padding={16}>
          <BarChart data={sprintData} direction="horizontal" formatValue={v => `${v} pts`} />
        </Card>
      )}
    </div>
  );
}
