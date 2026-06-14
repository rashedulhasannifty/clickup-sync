import { useMemo, useState } from 'react';
import { Download, Plus, Pencil, Trash2, Wallet, ChevronDown, ChevronRight } from 'lucide-react';
import { type Budget, type BudgetStatus, type BudgetStatusRow } from '../api/budgets';
import {
  useBudgets,
  useBudgetStatus,
  useCreateBudget,
  useUpdateBudget,
  useDeleteBudget,
} from '../hooks/useBudgets';
import { useClients } from '../hooks/useReports';
import { useAuth } from '../hooks/useAuth';
import { deriveBudgetStatus, STATUS_LABEL } from '../lib/budget-status';
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from '../lib/csv';
import { fmt } from '../lib/formatters';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { BudgetModal } from '../components/BudgetModal';

// ---------------------------------------------------------------------------
// Money helper — status rows are in dollars; fmt.money expects cents.
// ---------------------------------------------------------------------------
function moneyDollars(d: number) {
  return fmt.money(Math.round(d * 100));
}

// ---------------------------------------------------------------------------
// Status badge tone mapping
// ---------------------------------------------------------------------------
type PillTone = 'red' | 'amber' | 'green' | 'gray';

function statusTone(status: BudgetStatus): PillTone {
  switch (status) {
    case 'over':           return 'red';
    case 'projected-over': return 'amber';
    case 'near':           return 'amber';
    case 'under':          return 'green';
    case 'no-budget':      return 'gray';
  }
}

// ---------------------------------------------------------------------------
// Forecast toggle type
// ---------------------------------------------------------------------------
type ForecastMode = 'runrate' | 'trailing';

// ---------------------------------------------------------------------------
// Burn-down chart (custom SVG — no Recharts in this app)
// ---------------------------------------------------------------------------
interface BurnDownChartProps {
  row: BudgetStatusRow;
  month: string; // 'YYYY-MM'
  forecastMode: ForecastMode;
}

function BurnDownChart({ row, month, forecastMode }: BurnDownChartProps) {
  const { dailySeries, monthlyAmount } = row;

  // Derive the month's last day
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();

  // Build cumulative actual series
  const cumulativeActual: { day: number; value: number }[] = [];
  let running = 0;
  for (const pt of dailySeries) {
    const day = parseInt(pt.date.split('-')[2], 10);
    running += pt.cost;
    cumulativeActual.push({ day, value: running });
  }

  const lastActual = cumulativeActual[cumulativeActual.length - 1] ?? null;
  const forecast = forecastMode === 'runrate' ? row.forecastRunRate : row.forecastTrailing;

  // Y domain: 0 → max of budget, last actual, forecast
  const maxY = Math.max(
    monthlyAmount ?? 0,
    lastActual?.value ?? 0,
    forecast,
    1,
  );

  const W = 100; // viewBox width
  const H = 120; // viewBox height
  const PAD = { top: 8, right: 4, bottom: 20, left: 4 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const xOf = (day: number) => PAD.left + ((day - 1) / (daysInMonth - 1 || 1)) * chartW;
  const yOf = (val: number) => PAD.top + chartH - (val / maxY) * chartH;

  // Actual line
  const actualPoints = cumulativeActual.map(({ day, value }) => [xOf(day), yOf(value)] as [number, number]);

  // Ideal-pace line: 0 on day 1 → budget on last day (skip if no budget)
  const idealLine =
    monthlyAmount != null
      ? `M ${xOf(1)},${yOf(0)} L ${xOf(daysInMonth)},${yOf(monthlyAmount)}`
      : null;

  // Budget ceiling: horizontal line (skip if no budget)
  const ceilingY = monthlyAmount != null ? yOf(monthlyAmount) : null;

  // Projection: dashed from last actual to (month-end, forecast)
  let projectionPath: string | null = null;
  if (lastActual) {
    const fromX = xOf(lastActual.day);
    const fromY = yOf(lastActual.value);
    const toX = xOf(daysInMonth);
    const toY = yOf(forecast);
    if (Math.abs(fromX - toX) > 0.5) {
      projectionPath = `M ${fromX},${fromY} L ${toX},${toY}`;
    }
  }

  // Actual polyline path
  const actualPath =
    actualPoints.length > 1
      ? actualPoints.map(([x, y], i) => (i === 0 ? `M ${x},${y}` : `L ${x},${y}`)).join(' ')
      : actualPoints.length === 1
        ? `M ${actualPoints[0][0]},${actualPoints[0][1]}`
        : null;

  // X-axis tick labels (first, mid, last)
  const xTicks = [1, Math.ceil(daysInMonth / 2), daysInMonth];

  if (dailySeries.length === 0 && monthlyAmount == null) {
    return (
      <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
        No spend data for this month.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px 4px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {actualPath && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 20, height: 2, background: 'var(--accent)', borderRadius: 1 }} />
            Actual
          </span>
        )}
        {idealLine && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 20, height: 2, background: 'var(--text-faint)', borderRadius: 1 }} />
            Ideal pace
          </span>
        )}
        {ceilingY != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 20, height: 2, background: 'var(--pill-red-text)', borderRadius: 1, opacity: 0.7 }} />
            Budget ceiling
          </span>
        )}
        {projectionPath && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 20, height: 2, background: 'var(--accent)', borderRadius: 1, opacity: 0.5, borderTop: '1px dashed var(--accent)' }} />
            Projection
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}
      >
        {/* Budget ceiling */}
        {ceilingY != null && (
          <line
            x1={PAD.left}
            y1={ceilingY}
            x2={W - PAD.right}
            y2={ceilingY}
            stroke="var(--pill-red-text)"
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Ideal-pace line */}
        {idealLine && (
          <path
            d={idealLine}
            fill="none"
            stroke="var(--text-faint)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Actual cumulative line */}
        {actualPath && (
          <path
            d={actualPath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Dashed projection */}
        {projectionPath && (
          <path
            d={projectionPath}
            fill="none"
            stroke="var(--accent)"
            strokeOpacity={0.5}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* X-axis tick labels */}
        {xTicks.map((day) => (
          <text
            key={day}
            x={xOf(day)}
            y={H - 4}
            textAnchor={day === 1 ? 'start' : day === daysInMonth ? 'end' : 'middle'}
            fontSize={7}
            fill="var(--text-muted)"
          >
            {`${month}-${String(day).padStart(2, '0')}`}
          </text>
        ))}

        {/* Y-axis max label */}
        <text x={PAD.left} y={PAD.top - 2} fontSize={7} fill="var(--text-muted)">
          {moneyDollars(maxY)}
        </text>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: find the most recent budget record for a client
// ---------------------------------------------------------------------------
function findBudgetForClient(budgets: Budget[], client: string): Budget | null {
  const matches = budgets.filter((b) => b.client === client);
  if (matches.length === 0) return null;
  return matches.slice().sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
}

// ---------------------------------------------------------------------------
// BudgetsPage
// ---------------------------------------------------------------------------
export function BudgetsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');

  // Month picker state ('YYYY-MM' or '' for current month)
  const [rawMonth, setRawMonth] = useState('');
  const month = rawMonth || undefined;

  // Forecast toggle
  const [forecastMode, setForecastMode] = useState<ForecastMode>('runrate');

  // Queries
  const statusQuery = useBudgetStatus(month);
  const budgetsQuery = useBudgets();
  const clientsQuery = useClients();

  const statusRows: BudgetStatusRow[] = statusQuery.data ?? [];
  const budgets: Budget[] = budgetsQuery.data ?? [];

  // Client names for the modal autocomplete
  const clientOptions = useMemo(() => {
    const fromStatus = statusRows.map((r) => r.client);
    const fromClients = Array.isArray(clientsQuery.data)
      ? (clientsQuery.data as { client: string }[]).map((c) => c.client)
      : [];
    return Array.from(new Set([...fromStatus, ...fromClients])).sort();
  }, [statusRows, clientsQuery.data]);

  // Expanded rows (burn-down chart)
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  function toggleExpand(client: string) {
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(client)) next.delete(client);
      else next.add(client);
      return next;
    });
  }

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editBudget, setEditBudget] = useState<Budget | null>(null);
  const [presetClient, setPresetClient] = useState<string | undefined>(undefined);

  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const deleteBudget = useDeleteBudget();

  function openCreate(client?: string) {
    setEditBudget(null);
    setPresetClient(client);
    setModalOpen(true);
  }

  function openEdit(client: string, e: React.MouseEvent) {
    e.stopPropagation();
    const budget = findBudgetForClient(budgets, client);
    if (!budget) return;
    setPresetClient(undefined);
    setEditBudget(budget);
    setModalOpen(true);
  }

  function handleDelete(client: string, e: React.MouseEvent) {
    e.stopPropagation();
    const budget = findBudgetForClient(budgets, client);
    if (!budget) return;
    if (!window.confirm(`Delete budget for "${client}"? This cannot be undone.`)) return;
    deleteBudget.mutate(budget.id);
  }

  function closeModal() {
    setModalOpen(false);
    setEditBudget(null);
    setPresetClient(undefined);
  }

  function handleModalSubmit(data: {
    client: string;
    monthlyAmountCents: number;
    currency: string;
    validFrom: string;
    validTo: string | null;
    notes: string | null;
  }) {
    if (editBudget) {
      updateBudget.mutate(
        { id: editBudget.id, data },
        { onSuccess: closeModal },
      );
    } else {
      createBudget.mutate(data as Omit<Budget, 'id' | 'updatedAt'>, { onSuccess: closeModal });
    }
  }

  const isSubmitting = createBudget.isPending || updateBudget.isPending;

  // Effective month string for the burn-down chart (fall back to current month)
  const effectiveMonth = rawMonth || (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  })();

  const isLoading = statusQuery.isLoading;

  // CSV export columns
  const csvCols: CsvColumn<BudgetStatusRow>[] = [
    { header: 'Client',                   value: 'client' },
    { header: 'Budget',                   value: (r) => r.monthlyAmount ?? '' },
    { header: 'MTD Cost',                 value: 'mtdCost' },
    { header: 'MTD Hours',                value: 'mtdHours' },
    { header: 'Forecast (run-rate)',       value: 'forecastRunRate' },
    { header: 'Forecast (trailing)',       value: 'forecastTrailing' },
    { header: 'Status',                   value: 'status' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Budgets"
        description="Monthly client budgets — track MTD spend and forecast against targets."
        actions={
          <>
            <Button
              size="md"
              variant="default"
              icon={<Download size={13} />}
              disabled={isLoading || statusRows.length === 0}
              onClick={() =>
                downloadCsv(csvFilename('client-budgets'), toCsv(statusRows, csvCols))
              }
            >
              Export
            </Button>
            {isAdmin && (
              <Button
                size="md"
                variant="accent"
                icon={<Plus size={13} />}
                onClick={() => openCreate()}
              >
                Add budget
              </Button>
            )}
          </>
        }
      />

      <QueryError query={statusQuery} what="budget status" />
      <QueryError query={budgetsQuery} what="budgets" />

      {/* Controls row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          padding: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        {/* Month picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Month</span>
          <input
            type="month"
            value={rawMonth}
            onChange={(e) => setRawMonth(e.target.value)}
            style={{
              fontSize: 12,
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--input-bg, var(--surface))',
              color: 'var(--text)',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          {rawMonth && (
            <button
              type="button"
              onClick={() => setRawMonth('')}
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                padding: '2px 4px',
              }}
              aria-label="Reset to current month"
            >
              ×
            </button>
          )}
        </div>

        {/* Forecast toggle */}
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['runrate', 'trailing'] as const).map((m) => {
            const active = forecastMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setForecastMode(m)}
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: active ? 'var(--accent)' : 'var(--surface)',
                  color: active ? '#fff' : 'var(--text-muted)',
                  border: 0,
                  cursor: 'pointer',
                  borderLeft: m === 'runrate' ? 0 : '1px solid var(--border)',
                }}
                aria-pressed={active}
              >
                {m === 'runrate' ? 'Run-rate' : 'Trailing'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : statusRows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet size={20} />}
            title="No client data yet"
            body="Once time entries are synced, clients with spend will appear here."
            action={
              isAdmin ? (
                <Button onClick={() => openCreate()} icon={<Plus size={12} />}>
                  Add budget
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card padding={0}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr
                style={{
                  background: 'var(--muted-bg)',
                  textTransform: 'uppercase',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.05em',
                  fontWeight: 600,
                }}
              >
                <th style={{ width: 24, padding: '8px 8px 8px 12px' }} />
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Client</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>Budget</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>MTD Cost</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>MTD Hours</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>% Used</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>Forecast</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Status</th>
                <th style={{ textAlign: 'right', padding: '8px 16px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {statusRows.map((row, i) => {
                const isExpanded = expandedClients.has(row.client);
                const forecast =
                  forecastMode === 'runrate' ? row.forecastRunRate : row.forecastTrailing;
                const budgetCents =
                  row.monthlyAmount != null ? Math.round(row.monthlyAmount * 100) : null;
                const status: BudgetStatus =
                  forecastMode === 'runrate'
                    ? row.status
                    : deriveBudgetStatus(
                        Math.round(row.mtdCost * 100),
                        Math.round(forecast * 100),
                        budgetCents,
                      );

                const hasBudget = row.status !== 'no-budget' || row.monthlyAmount != null;
                const existingBudget = findBudgetForClient(budgets, row.client);

                return (
                  <>
                    <tr
                      key={`row-${row.client}`}
                      onClick={() => toggleExpand(row.client)}
                      style={{
                        borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined,
                        cursor: 'pointer',
                        background: isExpanded ? 'var(--hover)' : undefined,
                        transition: 'background 100ms',
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded) (e.currentTarget as HTMLTableRowElement).style.background = 'var(--hover)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isExpanded) (e.currentTarget as HTMLTableRowElement).style.background = '';
                      }}
                    >
                      {/* Expand chevron */}
                      <td style={{ padding: '10px 8px 10px 12px', color: 'var(--text-muted)' }}>
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </td>

                      {/* Client */}
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>
                        {row.client}
                      </td>

                      {/* Budget */}
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          color: row.monthlyAmount != null ? 'var(--text)' : 'var(--text-faint)',
                        }}
                      >
                        {row.monthlyAmount != null ? moneyDollars(row.monthlyAmount) : '—'}
                      </td>

                      {/* MTD Cost */}
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--text)',
                        }}
                      >
                        {moneyDollars(row.mtdCost)}
                      </td>

                      {/* MTD Hours */}
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {fmt.hours(row.mtdHours)}
                      </td>

                      {/* % Used */}
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {row.pctOfBudget != null
                          ? `${(row.pctOfBudget * 100).toFixed(1)}%`
                          : '—'}
                      </td>

                      {/* Forecast */}
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--text)',
                        }}
                      >
                        {moneyDollars(forecast)}
                      </td>

                      {/* Status badge */}
                      <td style={{ padding: '10px 12px' }}>
                        <Pill tone={statusTone(status)} size="xs">
                          {STATUS_LABEL[status]}
                        </Pill>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                        <div
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {!hasBudget && isAdmin && (
                            <Button
                              size="sm"
                              variant="default"
                              icon={<Plus size={12} />}
                              onClick={(e) => {
                                e.stopPropagation();
                                openCreate(row.client);
                              }}
                            >
                              Set budget
                            </Button>
                          )}
                          {hasBudget && existingBudget && isAdmin && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Pencil size={12} />}
                                onClick={(e) => openEdit(row.client, e)}
                                aria-label={`Edit budget for ${row.client}`}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Trash2 size={12} />}
                                onClick={(e) => handleDelete(row.client, e)}
                                aria-label={`Delete budget for ${row.client}`}
                              />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded burn-down chart row */}
                    {isExpanded && (
                      <tr key={`chart-${row.client}`} style={{ borderTop: '1px solid var(--border-soft)' }}>
                        <td colSpan={9} style={{ padding: 0, background: 'var(--muted-bg)' }}>
                          <BurnDownChart
                            row={row}
                            month={effectiveMonth}
                            forecastMode={forecastMode}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <BudgetModal
        open={modalOpen}
        initial={editBudget}
        presetClient={presetClient}
        clientOptions={clientOptions}
        onClose={closeModal}
        onSubmit={handleModalSubmit}
        submitting={isSubmitting}
      />
    </div>
  );
}
