import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, ChevronRight, Check, Eye, EyeOff } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { BarChart, type BarData } from '../components/charts/BarChart';
import { useHourSpikes, useResolveSpike, useUnresolveSpike, type HourSpikeWatchRow } from '../hooks/useReports';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { useAuth } from '../hooks/useAuth';
import { NotifySpikeModal } from '../components/NotifySpikeModal';
import { ClickupAvatar } from '../components/ui/ClickupAvatar';

const SPIKE_COLOR = '#f59e0b'; // amber, matches the anomalies styling
const BASE_COLOR = '#7B68EE';

// Shared height for every control in a watchlist row's right-hand cluster, so
// pills, action buttons, and the open-chevron all line up on one baseline.
const CONTROL_H = 28;

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

/** A soft status pill sized to match the row's action buttons exactly. */
function StatusPill({ tone, icon, children }: { tone: 'amber' | 'muted'; icon: ReactNode; children: ReactNode }) {
  const bg = tone === 'amber' ? 'var(--pill-amber-bg)' : 'var(--muted-bg)';
  const color = tone === 'amber' ? 'var(--pill-amber-text)' : 'var(--text-muted)';
  return (
    <span
      style={{
        height: CONTROL_H, display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '0 10px', borderRadius: 7, fontSize: 12, fontWeight: 600,
        background: bg, color, whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {children}
    </span>
  );
}

export function HourSpikesPage() {
  const navigate = useNavigate();
  const [limit, setLimit] = useState(20);
  const [showResolved, setShowResolved] = useState(false);
  const { fromDate, toDate } = useGlobalFilters();
  const q = useHourSpikes(limit, showResolved);
  const data = q.data;

  const resolveSpike = useResolveSpike();
  const unresolveSpike = useUnresolveSpike();

  // Reset paging when the toggle changes so totals/buttons stay consistent.
  const onToggleResolved = (next: boolean) => { setShowResolved(next); setLimit(20); };

  // Reset paging when the date range changes so a stale large limit doesn't
  // carry over to a different window.
  useEffect(() => { setLimit(20); }, [fromDate, toDate]);

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
            <Button
              size="sm"
              variant={showResolved ? 'subtle' : 'default'}
              icon={showResolved ? <Eye size={14} /> : <EyeOff size={14} />}
              aria-pressed={showResolved}
              onClick={() => onToggleResolved(!showResolved)}
            >
              Show resolved
            </Button>
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
            {data.watchlist.map((s, i) => {
              const resolvePending = resolveSpike.isPending && resolveSpike.variables?.userId === s.userId && resolveSpike.variables?.date === s.date;
              const unresolvePending = unresolveSpike.isPending && unresolveSpike.variables?.userId === s.userId && unresolveSpike.variables?.date === s.date;
              return (
              <div
                key={`${s.userId}-${s.date}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  borderBottom: i < data.watchlist.length - 1 ? '1px solid var(--border-soft)' : 0,
                  background: s.resolved ? 'var(--muted-bg)' : 'transparent',
                }}
              >
                {/* Left: clickable navigation target (big hit area). Content is
                    muted when resolved; the controls stay crisp. */}
                <button
                  type="button"
                  onClick={() => navigate(dayLink(s.userId, s.date))}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--hover)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11,
                    background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left',
                    color: 'inherit', padding: '4px 6px', margin: '-4px -6px', borderRadius: 8,
                    opacity: s.resolved ? 0.7 : 1, transition: 'background 100ms, opacity 100ms',
                  }}
                >
                  <span style={{
                    width: CONTROL_H, height: CONTROL_H, borderRadius: 8, flexShrink: 0,
                    background: s.resolved ? 'var(--muted-bg)' : 'var(--pill-amber-bg)',
                    color: s.resolved ? 'var(--text-muted)' : 'var(--pill-amber-text)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: s.resolved ? '1px solid var(--border-soft)' : '1px solid transparent',
                  }}>
                    <TrendingUp size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: s.resolved ? 'var(--text-muted)' : 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 7 }}>
                      <ClickupAvatar userId={s.userId} name={s.userName} size={22} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.userName} logged {s.hours.toFixed(1)}h on {formatDate(s.date)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 29 }}>{watchSubtitle(s, data.cap)}</div>
                  </div>
                </button>

                {/* Right: one aligned control cluster — status, actions, open. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {canNotify && (
                    s.resolved ? (
                      <>
                        <StatusPill tone="muted" icon={<Check size={13} />}>Resolved</StatusPill>
                        <Button
                          size="sm"
                          variant="subtle"
                          aria-label={`Unresolve ${s.userName} on ${formatDate(s.date)}`}
                          disabled={unresolvePending}
                          onClick={() => unresolveSpike.mutate({ userId: s.userId, date: s.date })}
                        >
                          Unresolve
                        </Button>
                      </>
                    ) : (
                      <>
                        {s.notified ? (
                          <StatusPill tone="amber" icon={<Check size={13} />}>Notified</StatusPill>
                        ) : (
                          <Button
                            size="sm"
                            variant="caution"
                            aria-label={`Notify ${s.userName} about ${formatDate(s.date)}`}
                            onClick={() => setActiveRow(s)}
                          >
                            Notify
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="subtle"
                          aria-label={`Resolve ${s.userName} on ${formatDate(s.date)}`}
                          disabled={resolvePending}
                          onClick={() => resolveSpike.mutate({ userId: s.userId, date: s.date, userName: s.userName })}
                        >
                          Resolve
                        </Button>
                      </>
                    )
                  )}
                  <Button
                    size="iconSm"
                    variant="ghost"
                    aria-label={`View time entries for ${s.userName} on ${formatDate(s.date)}`}
                    onClick={() => navigate(dayLink(s.userId, s.date))}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        )}
        {data && data.watchlist.length < data.watchlistTotal && (
          <div style={{ padding: 12, borderTop: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'center' }}>
            <Button size="sm" variant="default" disabled={q.isFetching} onClick={() => setLimit((n) => n + 20)}>
              Load 20 more · {data.watchlist.length} of {data.watchlistTotal}
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
