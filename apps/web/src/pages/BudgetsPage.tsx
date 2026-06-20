import { Fragment, useMemo, useState } from 'react';
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
import { BudgetBurnDownChart } from '../components/charts/BudgetBurnDownChart';

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
    default:               return 'gray';
  }
}

// ---------------------------------------------------------------------------
// Forecast toggle type
// ---------------------------------------------------------------------------
type ForecastMode = 'runrate' | 'trailing';

// ---------------------------------------------------------------------------
// Helper: find the most recent budget record for a client
// ---------------------------------------------------------------------------
function findBudgetForClient(budgets: Budget[], client: string): Budget | null {
  const matches = budgets.filter((b) => b.client === client);
  if (matches.length === 0) return null;
  return matches.slice().sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
}

// ---------------------------------------------------------------------------
// CSV export columns (module-level — no closure dependencies)
// ---------------------------------------------------------------------------
const CSV_COLS: CsvColumn<BudgetStatusRow>[] = [
  { header: 'Client',                   value: 'client' },
  { header: 'Budget',                   value: (r) => r.monthlyAmount ?? '' },
  { header: 'MTD Cost',                 value: 'mtdCost' },
  { header: 'MTD Hours',                value: 'mtdHours' },
  { header: '% Used',                   value: (r) => r.pctOfBudget != null ? `${(r.pctOfBudget * 100).toFixed(1)}%` : '' },
  { header: 'Forecast (run-rate)',       value: 'forecastRunRate' },
  { header: 'Forecast (trailing)',       value: 'forecastTrailing' },
  { header: 'Status',                   value: 'status' },
];

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
      createBudget.mutate(data, { onSuccess: closeModal });
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Budgets"
        description="Monthly client budgets — track MTD spend and forecast against targets."
        actions={
          <>
            <Button
              size="md"
              variant="subtle"
              icon={<Download size={13} />}
              disabled={isLoading || statusRows.length === 0}
              onClick={() =>
                downloadCsv(csvFilename('client-budgets'), toCsv(statusRows, CSV_COLS))
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
            value={rawMonth || effectiveMonth}
            onChange={(e) => setRawMonth(e.target.value)}
            className="btn-3d"
            style={{
              fontSize: 12,
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 9,
              background: 'var(--input-bg, var(--surface))',
              color: 'var(--text)',
              fontFamily: 'inherit',
              outline: 'none',
              cursor: 'pointer',
              ['--b-edge' as string]: 'var(--border-strong)',
              ['--b-glow' as string]: 'var(--btn-neutral-glow)',
              ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
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

        {/* Forecast toggle — 3D segmented control: recessed track, raised active
            pill (accent). Matches the Tabs segmented variant + the app's filter
            language. */}
        <div className="seg-track" style={{ display: 'inline-flex', gap: 2, background: 'var(--muted-bg)', borderRadius: 8, padding: 3 }}>
          {(['runrate', 'trailing'] as const).map((m) => {
            const active = forecastMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setForecastMode(m)}
                className="btn-3d"
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 6,
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-muted)',
                  border: 0,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  // Only the active pill carries a visible raised edge; the
                  // inactive segment stays flat (transparent edge/glow) but keeps
                  // the press feel.
                  ['--b-edge' as string]: active ? 'var(--accent-strong)' : 'transparent',
                  ['--b-glow' as string]: active ? 'rgba(123,104,238,.32)' : 'transparent',
                  ['--b-glow-strong' as string]: active ? 'rgba(123,104,238,.46)' : 'transparent',
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
                <Button variant="accent" onClick={() => openCreate()} icon={<Plus size={12} />}>
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

                const hasBudget = row.monthlyAmount != null;
                const existingBudget = findBudgetForClient(budgets, row.client);

                return (
                  <Fragment key={row.client}>
                    <tr
                      className="row-3d"
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
                              variant="accent"
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
                                variant="danger"
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
                      <tr style={{ borderTop: '1px solid var(--border)' }}>
                        <td colSpan={9} style={{ padding: 0, background: 'var(--surface)' }}>
                          <BudgetBurnDownChart
                            dailySeries={row.dailySeries}
                            monthlyAmount={row.monthlyAmount}
                            forecast={forecastMode === 'runrate' ? row.forecastRunRate : row.forecastTrailing}
                            month={effectiveMonth}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
