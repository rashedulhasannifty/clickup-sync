import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, ChevronRight, Check } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { BarChart, type BarData } from '../components/charts/BarChart';
import { useHourSpikes, useResolveSpike, useUnresolveSpike, type HourSpikeWatchRow } from '../hooks/useReports';
import { useAuth } from '../hooks/useAuth';
import { NotifySpikeModal } from '../components/NotifySpikeModal';
import { ClickupAvatar } from '../components/ui/ClickupAvatar';

const SPIKE_COLOR = '#f59e0b'; // amber, matches the anomalies styling
const BASE_COLOR = '#7B68EE';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Single-day filtered link into Time Entries, in the Asia/Dhaka window.
function dayLink(userId: string, iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
  const startMs = Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS;
  const endMs = startMs + 86_400_000 - 1;
  const from = new Date(startMs).toISOString();
  const to = new Date(endMs).toISOString();
  return `/time-entries?userId=${encodeURIComponent(userId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&spaceScope=all`;
}

function watchSubtitle(s: HourSpikeWatchRow, cap: number): string {
  if (s.rule === 'absolute') return `over the ${cap}h/day cap`;
  const mult = s.multiplier != null ? `${s.multiplier.toFixed(1)}× their ${s.median.toFixed(1)}h median` : 'above their median';
  if (s.rule === 'relative') return mult;
  return `${mult} · over the ${cap}h/day cap`;
}

export function HourSpikesPage() {
  const navigate = useNavigate();
  const [limit, setLimit] = useState(20);
  const [showResolved, setShowResolved] = useState(false);
  const q = useHourSpikes(limit, showResolved);
  const data = q.data;

  const resolveSpike = useResolveSpike();
  const unresolveSpike = useUnresolveSpike();

  // Reset paging when the toggle changes so totals/buttons stay consistent.
  // (Date-range changes already remount the query via its key.)
  const onToggleResolved = (next: boolean) => { setShowResolved(next); setLimit(20); };

  const { hasRole } = useAuth();
  const canNotify = hasRole('ADMIN');
  const [activeRow, setActiveRow] = useState<HourSpikeWatchRow | null>(null);

  const users = data?.byUser.users ?? [];
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  // Default the dropdown to the first user once data arrives.
  // Also fall back to first user when the current selection leaves the filtered set.
  const effectiveUserId =
    selectedUserId && users.some((u) => u.userId === selectedUserId)
      ? selectedUserId
      : users[0]?.userId ?? '';
  const selectedUser = users.find((u) => u.userId === effectiveUserId);

  const chartData: BarData[] = useMemo(
    () => (selectedUser?.points ?? []).map((p) => ({
      label: formatDate(p.date),
      value: p.hours,
      color: p.isSpike ? SPIKE_COLOR : BASE_COLOR,
    })),
    [selectedUser],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="Time Spikes" />

      <Card
        padding={0}
        title="Spike watchlist"
        subtitle="Days a user logged unusually high hours"
        action={
          canNotify ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={showResolved} onChange={(e) => onToggleResolved(e.target.checked)} />
              Show resolved
            </label>
          ) : undefined
        }
      >
        {q.isLoading && (
          <div style={{ padding: 16 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 32, background: 'var(--muted-bg)', borderRadius: 6, marginBottom: 8, opacity: 0.6 }} />
            ))}
          </div>
        )}
        {q.isError && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--red)' }}>Couldn't load spikes.</div>
        )}
        {data && data.watchlist.length === 0 && !q.isLoading && (
          <div style={{ padding: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No spikes in the selected range.</p>
          </div>
        )}
        {data && data.watchlist.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {data.watchlist.map((s, i) => (
              <div
                key={`${s.userId}-${s.date}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                  borderBottom: i < data.watchlist.length - 1 ? '1px solid var(--border-soft)' : 0,
                  opacity: s.resolved ? 0.55 : 1,
                }}
              >
                <button
                  type="button"
                  onClick={() => navigate(dayLink(s.userId, s.date))}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--hover)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 10,
                    background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit', padding: 0,
                  }}
                >
                  <span style={{
                    width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                    background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <TrendingUp size={13} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <ClickupAvatar userId={s.userId} name={s.userName} size={22} />
                        <span>{s.userName} logged {s.hours.toFixed(1)}h on {formatDate(s.date)}</span>
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{watchSubtitle(s, data.cap)}</div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    view <ChevronRight size={12} />
                  </span>
                </button>
                {canNotify && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {s.resolved ? (
                      <>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 7,
                          background: 'var(--muted-bg)', color: 'var(--text-muted)',
                        }}>
                          <Check size={12} /> Resolved
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Unresolve ${s.userName} on ${formatDate(s.date)}`}
                          // row-scoped: only the in-flight row's button disables
                          disabled={unresolveSpike.isPending && unresolveSpike.variables?.userId === s.userId && unresolveSpike.variables?.date === s.date}
                          onClick={() => unresolveSpike.mutate({ userId: s.userId, date: s.date })}
                        >
                          Unresolve
                        </Button>
                      </>
                    ) : (
                      <>
                        {s.notified ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 7,
                            background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
                          }}>
                            <Check size={12} /> Notified
                          </span>
                        ) : (
                          <Button size="sm" variant="caution" aria-label={`Notify ${s.userName} about ${formatDate(s.date)}`} onClick={() => setActiveRow(s)}>
                            Notify
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Resolve ${s.userName} on ${formatDate(s.date)}`}
                          // row-scoped: only the in-flight row's button disables
                          disabled={resolveSpike.isPending && resolveSpike.variables?.userId === s.userId && resolveSpike.variables?.date === s.date}
                          onClick={() => resolveSpike.mutate({ userId: s.userId, date: s.date, userName: s.userName })}
                        >
                          Resolve
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {data && data.watchlist.length < data.watchlistTotal && (
          <div style={{ padding: 12, borderTop: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'center' }}>
            <Button size="sm" variant="ghost" disabled={q.isFetching} onClick={() => setLimit((n) => n + 20)}>
              Load 20 more ({data.watchlist.length} of {data.watchlistTotal})
            </Button>
          </div>
        )}
      </Card>

      <Card
        title="Daily hours by user"
        subtitle={data ? `Spike days in amber · cap ${data.cap}h/day` : 'Daily hours'}
        action={
          users.length > 0 ? (
            <Select
              ariaLabel="Select user"
              size="sm"
              menuAlign="right"
              value={effectiveUserId}
              onChange={setSelectedUserId}
              options={users.map((u) => ({ value: u.userId, label: u.userName, icon: <ClickupAvatar userId={u.userId} name={u.userName} size={18} /> }))}
            />
          ) : undefined
        }
      >
        <BarChart data={chartData} direction="vertical" height={240} formatValue={(v) => `${v.toFixed(1)}h`} />
      </Card>

      {activeRow && <NotifySpikeModal row={activeRow} onClose={() => setActiveRow(null)} />}
    </div>
  );
}
