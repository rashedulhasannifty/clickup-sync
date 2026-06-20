import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CircleX, Clock, AlertTriangle, TrendingUp, DollarSign,
  CheckCheck, CircleCheck,
} from 'lucide-react';
import { useStats, useAnomalies, useHourSpikeWatch } from '../../hooks/useReports';
import { useBudgetStatus } from '../../hooks/useBudgets';
import type { BudgetStatusRow } from '../../api/budgets';
import { fmt } from '../../lib/formatters';

type Severity = 'red' | 'amber';

interface Notice {
  id: string;
  severity: Severity;
  title: string;
  subtitle: string;
  target: string;
  icon: React.ReactNode;
}

const SEEN_KEY = 'cc-notif-seen-v1';

function moneyAud(dollars: number) {
  return fmt.money(Math.round(dollars * 100));
}

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeen(ids: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable (private mode / quota) — badge just won't persist */
  }
}

/**
 * Top-bar notification center. Aggregates the operational + analytical signals
 * already computed elsewhere on the dashboard into one feed:
 *   • operations  — failed jobs, dead-letter backlog, missing rates (useStats)
 *   • budgets     — clients over / projected over budget (useBudgetStatus)
 *   • anomalies   — daily + per-client cost spikes (useAnomalies)
 *   • hour spikes — un-notified per-user hour-spike watchlist (useHourSpikeWatch)
 *
 * The unread badge counts items whose stable id isn't in a persisted "seen"
 * set. Resolved problems drop out of the feed and are pruned from storage, so
 * the badge only ever lights for genuinely new items — never for things getting
 * better. (The old bell was a permanent placeholder with a fake unread dot;
 * this replaces it with a real one.)
 */
export function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  const stats = useStats();
  const budgetStatus = useBudgetStatus();
  const anomalies = useAnomalies();
  const hourSpikes = useHourSpikeWatch();

  const notices = useMemo<Notice[]>(() => {
    const out: Notice[] = [];

    // Operations
    const s = stats.data as
      | { failedJobsLast24h?: number; deadLetterPending?: number; missingRateEntries?: number }
      | undefined;
    if (s) {
      if ((s.failedJobsLast24h ?? 0) > 0) {
        out.push({
          id: 'ops-failed-jobs',
          severity: 'red',
          title: `${s.failedJobsLast24h} failed job${s.failedJobsLast24h === 1 ? '' : 's'} (24h)`,
          subtitle: 'Check queue logs and retry',
          target: '/sync-logs?tab=runs&status=failed',
          icon: <CircleX size={14} strokeWidth={1.75} />,
        });
      }
      if ((s.deadLetterPending ?? 0) > 0) {
        out.push({
          id: 'ops-dead-letters',
          severity: 'amber',
          title: `${s.deadLetterPending} dead-letter job${s.deadLetterPending === 1 ? '' : 's'} pending`,
          subtitle: 'Unrecoverable jobs need review',
          target: '/sync-logs?tab=dead-letters',
          icon: <Clock size={14} strokeWidth={1.75} />,
        });
      }
      if ((s.missingRateEntries ?? 0) > 0) {
        out.push({
          id: 'ops-missing-rates',
          severity: 'amber',
          title: `${s.missingRateEntries} time entr${s.missingRateEntries === 1 ? 'y' : 'ies'} missing rates`,
          subtitle: "Can't be costed until rates are assigned",
          target: '/missing-rates',
          icon: <DollarSign size={14} strokeWidth={1.75} />,
        });
      }
    }

    // Budgets
    const budgetRows = (budgetStatus.data ?? []) as BudgetStatusRow[];
    for (const r of budgetRows) {
      if (r.status !== 'over' && r.status !== 'projected-over') continue;
      const isOver = r.status === 'over';
      const pct = r.pctOfBudget != null ? `${(r.pctOfBudget * 100).toFixed(0)}% used` : 'over budget';
      out.push({
        id: `budget-${r.client}`,
        severity: isOver ? 'red' : 'amber',
        title: `${r.client} is ${isOver ? 'over' : 'projected over'} budget`,
        subtitle: pct,
        target: '/budgets',
        icon: <AlertTriangle size={14} strokeWidth={1.75} />,
      });
    }

    // Cost anomalies
    if (anomalies.data) {
      for (const d of anomalies.data.dailySpikes) {
        out.push({
          id: `anomaly-daily-${d.date}`,
          severity: 'amber',
          title: `${d.date} cost was ${d.multiplier.toFixed(1)}× typical`,
          subtitle: `${moneyAud(d.totalCostAud)} vs ${moneyAud(d.medianAud)} median`,
          target: '/overview',
          icon: <TrendingUp size={14} strokeWidth={1.75} />,
        });
      }
      for (const c of anomalies.data.clientSpikes) {
        out.push({
          id: `anomaly-client-${c.client}`,
          severity: 'amber',
          title: `${c.client} up ${c.multiplier.toFixed(1)}× vs baseline`,
          subtitle: `${moneyAud(c.lastWeekCostAud)} last 7d`,
          target: '/overview',
          icon: <TrendingUp size={14} strokeWidth={1.75} />,
        });
      }
    }

    // Hour-spike watchlist (only the not-yet-notified rows are actionable)
    if (hourSpikes.data) {
      for (const w of hourSpikes.data.watchlist) {
        if (w.notified) continue;
        out.push({
          id: `hourspike-${w.userId}-${w.date}`,
          severity: 'amber',
          title: `${w.userName} logged ${fmt.hours(w.hours)} on ${w.date}`,
          subtitle: w.multiplier != null ? `${w.multiplier.toFixed(1)}× their median day` : 'Above the daily cap',
          target: '/time-spikes',
          icon: <Clock size={14} strokeWidth={1.75} />,
        });
      }
    }

    // Red items first, then keep insertion order.
    return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'red' ? -1 : 1));
  }, [stats.data, budgetStatus.data, anomalies.data, hourSpikes.data]);

  const [seen, setSeen] = useState<Set<string>>(loadSeen);

  // Don't act on the feed until every source has loaded at least once —
  // otherwise the "empty while loading" state would prune the persisted
  // seen-set to nothing and re-light the badge for everything once data lands.
  const ready =
    !stats.isLoading && !budgetStatus.isLoading && !anomalies.isLoading && !hourSpikes.isLoading;

  // Prune the persisted seen-set down to ids that still exist, so resolved
  // problems don't linger in storage (and the badge never re-lights for a
  // problem that got better). Runs once the feed is ready and whenever the live
  // id set changes.
  const idsKey = notices.map((n) => n.id).join('|');
  useEffect(() => {
    if (!ready) return;
    const live = new Set(notices.map((n) => n.id));
    setSeen((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed) return prev;
      saveSeen(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, ready]);

  const unreadCount = notices.filter((n) => !seen.has(n.id)).length;

  // Close on outside click / Escape — mirrors UserMenu's popover contract.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function markAllRead() {
    const all = new Set(notices.map((n) => n.id));
    setSeen(all);
    saveSeen(all);
  }

  function openNotice(n: Notice) {
    if (!seen.has(n.id)) {
      const next = new Set(seen).add(n.id);
      setSeen(next);
      saveSeen(next);
    }
    setOpen(false);
    navigate(n.target);
  }

  const label = unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications';

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        className="btn-3d"
        style={{
          position: 'relative',
          width: 32, height: 32, border: '1px solid var(--border)',
          background: open ? 'var(--hover)' : 'var(--surface)',
          color: 'var(--text-muted)',
          borderRadius: 9, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          ['--b-edge' as string]: 'var(--border-strong)',
          ['--b-glow' as string]: 'var(--btn-neutral-glow)',
          ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
        }}
      >
        <Bell size={14} strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span
            aria-hidden
            style={{
              position: 'absolute', top: -5, right: -5,
              minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 999,
              background: 'var(--red)', color: '#fff',
              fontSize: 10, fontWeight: 700, lineHeight: '16px',
              textAlign: 'center',
              border: '1.5px solid var(--surface)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 50,
            width: 360, maxWidth: 'calc(100vw - 24px)',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: '0 12px 32px rgba(15,23,42,0.16)', overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '11px 14px', borderBottom: '1px solid var(--border-soft)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Notifications</span>
              {unreadCount > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--pill-red-text)',
                  background: 'var(--pill-red-bg)', borderRadius: 999, padding: '1px 7px',
                }}>
                  {unreadCount} new
                </span>
              )}
            </div>
            {notices.length > 0 && unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  border: 0, background: 'transparent', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: 'inherit',
                  padding: '2px 4px', borderRadius: 6,
                }}
              >
                <CheckCheck size={13} strokeWidth={2} /> Mark all read
              </button>
            )}
          </div>

          {/* Body */}
          <div style={{ maxHeight: 'min(60vh, 440px)', overflowY: 'auto' }}>
            {notices.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '30px 16px', textAlign: 'center' }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'var(--pill-green-bg)', color: 'var(--pill-green-text)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CircleCheck size={18} strokeWidth={2} />
                </span>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>You’re all caught up</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 240 }}>
                  No failed jobs, budget overruns, or spikes need attention right now.
                </div>
              </div>
            ) : (
              notices.map((n, i) => {
                const isUnread = !seen.has(n.id);
                return (
                  <button
                    key={n.id}
                    type="button"
                    className="row-3d"
                    onClick={() => openNotice(n)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%',
                      padding: '11px 14px', textAlign: 'left',
                      border: 0, borderBottom: i < notices.length - 1 ? '1px solid var(--border-soft)' : 0,
                      background: isUnread ? 'var(--accent-soft)' : 'transparent',
                      cursor: 'pointer', color: 'inherit',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = isUnread ? 'var(--accent-soft)' : 'transparent')}
                  >
                    <span style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0, marginTop: 1,
                      background: `var(--pill-${n.severity}-bg)`, color: `var(--pill-${n.severity}-text)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {n.icon}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.35 }}>
                        {n.title}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {n.subtitle}
                      </div>
                    </div>
                    {isUnread && (
                      <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--accent)', flexShrink: 0, marginTop: 6 }} />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </span>
  );
}
