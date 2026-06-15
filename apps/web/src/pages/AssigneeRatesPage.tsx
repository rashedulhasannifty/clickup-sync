import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CircleCheck,
  DollarSign,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { parseRatesListResponse, type Rate } from '../api/rates';
import type { RatePresetAssignee } from '../components/RateModal';
import { useRates, useRecalcCosts } from '../hooks/useRates';
import { useMissingRates, useStats } from '../hooks/useReports';
import { useAuth } from '../hooks/useAuth';
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from '../lib/csv';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { MetricCard } from '../components/ui/MetricCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Switch } from '../components/ui/Switch';
import { ClickupAvatar } from '../components/ui/ClickupAvatar';
import { Pill } from '../components/ui/Pill';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Card } from '../components/ui/Card';
import { RateModal } from '../components/RateModal';
import { useToast } from '../components/ui/Toast';
import { fmt } from '../lib/formatters';

type GroupRow = {
  assigneeId: string;
  displayName: string;
  email: string | null;
  rates: Rate[];
};

function sortRatesDesc(rates: Rate[]) {
  return [...rates].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
}

export function AssigneeRatesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const ratesQuery = useRates();
  const { data: rates, isLoading } = ratesQuery;
  const recalc = useRecalcCosts();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const toast = useToast();

  function runRecalc(assigneeId?: string) {
    recalc.mutate(assigneeId, {
      onSuccess: () => {
        toast.success(
          assigneeId
            ? 'Recalculation queued for this assignee — costs update shortly.'
            : 'Recalculation queued for all entries — costs update shortly.',
        );
      },
      onError: (err) => toast.error(`Recalculation failed: ${(err as Error).message}`),
    });
  }

  const { data: statsData } = useStats();
  const { data: missingRatesData } = useMissingRates();
  const missingRateEntries = (statsData as Record<string, number> | undefined)?.missingRateEntries ?? 0;
  const missingAssigneeCount = Array.isArray(missingRatesData) ? missingRatesData.length : 0;

  const [search, setSearch] = useState('');

  // Deep link from the command palette / other pages: ?userId=<id> seeds the
  // assignee filter (the filter below already matches assigneeId). Consume the
  // param once so it doesn't fight manual edits to the search box afterward.
  useEffect(() => {
    const urlUserId = searchParams.get('userId');
    if (urlUserId) {
      setSearch(urlUserId);
      searchParams.delete('userId');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedRate, setSelectedRate] = useState<Rate | null>(null);
  const [presetAssignee, setPresetAssignee] = useState<RatePresetAssignee | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const allRates = parseRatesListResponse(rates ?? []);

  const activeRates = allRates.filter((r) => r.validTo === null);
  const activeRatesCount = activeRates.length;
  const coveredAssignees = new Set(allRates.map((r) => r.assigneeId)).size;
  const avgActiveCents =
    activeRates.length > 0
      ? Math.round(activeRates.reduce((sum, r) => sum + r.hourlyRateCents, 0) / activeRates.length)
      : 0;
  const avgActiveCurrency = activeRates[0]?.currency ?? 'USD';

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

  const groupedList = useMemo((): GroupRow[] => {
    const byUser = new Map<string, Rate[]>();
    for (const r of filtered) {
      const arr = byUser.get(r.assigneeId) ?? [];
      arr.push(r);
      byUser.set(r.assigneeId, arr);
    }
    return Array.from(byUser.entries())
      .map(([assigneeId, rs]) => {
        const sorted = sortRatesDesc(rs);
        const first = sorted[0];
        return {
          assigneeId,
          displayName: first.assigneeName ?? assigneeId,
          email: first.assigneeEmail,
          rates: sorted,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [filtered]);

  function closeModal() {
    setIsModalOpen(false);
    setSelectedRate(null);
    setPresetAssignee(null);
  }

  function openNewGlobal() {
    setSelectedRate(null);
    setPresetAssignee(null);
    setIsModalOpen(true);
  }

  function openNewForAssignee(row: GroupRow) {
    setSelectedRate(null);
    setPresetAssignee({
      assigneeId: row.assigneeId,
      assigneeName: row.rates[0]?.assigneeName ?? null,
      assigneeEmail: row.email,
    });
    setIsModalOpen(true);
  }

  function openEdit(rate: Rate) {
    setPresetAssignee(null);
    setSelectedRate(rate);
    setIsModalOpen(true);
  }

  const showFilterEmpty = !isLoading && allRates.length > 0 && groupedList.length === 0;
  const showNoDataEmpty = !isLoading && allRates.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Assignee Rates"
        description="Hourly cost rates by assignee. Used to compute labor cost for tracked time."
        actions={
          <>
            {isAdmin && (
              <Button
                size="md"
                variant="default"
                icon={<RefreshCw size={13} />}
                loading={recalc.isPending}
                onClick={() => runRecalc()}
              >
                Recalculate costs
              </Button>
            )}
            <Button
              size="md"
              variant="default"
              icon={<Download size={13} />}
              disabled={isLoading || filtered.length === 0}
              onClick={() => {
                const cols: CsvColumn<Rate>[] = [
                  { header: 'Rate ID',        value: 'id' },
                  { header: 'Assignee ID',    value: 'assigneeId' },
                  { header: 'Assignee name',  value: 'assigneeName' },
                  { header: 'Assignee email', value: 'assigneeEmail' },
                  { header: 'Hourly rate (cents)', value: 'hourlyRateCents' },
                  { header: 'Currency',       value: 'currency' },
                  { header: 'Valid from',     value: 'validFrom' },
                  { header: 'Valid to',       value: 'validTo' },
                  { header: 'Created',        value: 'createdAt' },
                  { header: 'Updated',        value: 'updatedAt' },
                ];
                downloadCsv(csvFilename('assignee-rates'), toCsv(filtered, cols));
              }}
            >
              Export
            </Button>
            {isAdmin && (
              <Button size="md" variant="accent" icon={<Plus size={13} />} onClick={openNewGlobal}>
                New rate
              </Button>
            )}
          </>
        }
      />


      <QueryError query={ratesQuery} what="assignee rates" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <MetricCard
          dense
          label="Active rates"
          value={isLoading ? '—' : fmt.number(activeRatesCount)}
          icon={<DollarSign size={13} />}
        />
        <MetricCard
          dense
          label="Covered assignees"
          value={isLoading ? '—' : fmt.number(coveredAssignees)}
          icon={<Users size={13} />}
        />
        <MetricCard
          dense
          label="Avg active rate"
          value={
            isLoading
              ? '—'
              : activeRates.length > 0
                ? `${fmt.money(avgActiveCents, avgActiveCurrency)}/h`
                : '—'
          }
          icon={<DollarSign size={13} />}
        />
        <MetricCard
          dense
          label="Without rate"
          value={isLoading ? '—' : fmt.number(missingAssigneeCount)}
          sublabel="see Missing Rates"
          icon={<AlertTriangle size={13} />}
          onClick={
            missingAssigneeCount > 0 || missingRateEntries > 0
              ? () => navigate('/missing-rates')
              : undefined
          }
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Input
            icon={<Search size={14} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assignee…"
            aria-label="Search assignees"
          />
        </div>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <Switch ariaLabel="Active rates only" checked={activeOnly} onChange={setActiveOnly} />
          <span>Active rates only</span>
        </label>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      ) : showNoDataEmpty ? (
        <Card>
          <EmptyState
            icon={<DollarSign size={20} />}
            title="No rates yet"
            body="Create a rate for an assignee so time entries can be costed."
            action={
              isAdmin ? (
                <Button onClick={openNewGlobal} icon={<Plus size={12} />}>
                  New rate
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groupedList.map((g) => {
            const activeRate = g.rates.find((r) => r.validTo === null);
            return (
              <Card key={g.assigneeId} padding={0}>
                <div
                  style={{
                    padding: '14px 16px',
                    borderBottom: '1px solid var(--border-soft)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <ClickupAvatar userId={g.assigneeId} email={g.email} name={g.displayName} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{g.displayName}</div>
                    {g.email && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.email}</div>
                    )}
                  </div>
                  {activeRate ? (
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Current rate</div>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 600,
                          color: 'var(--text)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {fmt.money(activeRate.hourlyRateCents, activeRate.currency)}
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>/h</span>
                      </div>
                    </div>
                  ) : (
                    <Pill tone="amber">No active rate</Pill>
                  )}
                  {isAdmin && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<RefreshCw size={12} />}
                        loading={recalc.isPending}
                        onClick={() => runRecalc(g.assigneeId)}
                      >
                        Recalc
                      </Button>
                      <Button size="sm" variant="default" icon={<Plus size={12} />} onClick={() => openNewForAssignee(g)}>
                        New rate
                      </Button>
                    </>
                  )}
                </div>

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
                      <th style={{ textAlign: 'left', padding: '8px 16px' }}>From</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>To</th>
                      <th style={{ textAlign: 'right', padding: '8px 12px' }}>Rate</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>Updated</th>
                      <th style={{ width: 60, padding: '8px 16px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {g.rates.map((r, i) => {
                      const isActive = r.validTo === null;
                      const updatedAt = r.updatedAt ?? r.validFrom;
                      return (
                        <tr key={r.id} style={{ borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined }}>
                          <td
                            style={{
                              padding: '10px 16px',
                              fontVariantNumeric: 'tabular-nums',
                              color: 'var(--text)',
                            }}
                          >
                            {fmt.shortDate(r.validFrom)}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              fontVariantNumeric: 'tabular-nums',
                              color: r.validTo ? 'var(--text)' : 'var(--text-faint)',
                            }}
                          >
                            {r.validTo ? fmt.shortDate(r.validTo) : '— ongoing'}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              fontWeight: 600,
                              color: 'var(--text)',
                            }}
                          >
                            {fmt.money(r.hourlyRateCents, r.currency)}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {isActive ? (
                              <Pill tone="green" size="xs" icon={<CircleCheck size={10} />}>
                                active
                              </Pill>
                            ) : (
                              <Pill tone="gray" size="xs">
                                historical
                              </Pill>
                            )}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              color: 'var(--text-muted)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {fmt.relative(updatedAt)}
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                            {isAdmin && (
                              <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => openEdit(r)} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            );
          })}

          {showFilterEmpty && (
            <Card>
              <EmptyState
                icon={<DollarSign size={20} />}
                title="No rates match your filters"
                body="Adjust filters or create a new rate to get started."
                action={
                  isAdmin ? (
                    <Button onClick={openNewGlobal} icon={<Plus size={12} />}>
                      New rate
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          )}
        </div>
      )}

      <RateModal
        open={isModalOpen}
        rate={selectedRate}
        presetAssignee={presetAssignee}
        onClose={closeModal}
      />
    </div>
  );
}
