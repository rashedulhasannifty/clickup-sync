import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleCheck, CircleDashed, Loader2, RefreshCw, Settings } from 'lucide-react';
import { useSpaces } from '../hooks/useReports';
import { useBackfill } from '../hooks/useAdmin';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Tabs } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { Pill } from '../components/ui/Pill';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { fmt } from '../lib/formatters';

const CONFIGURED_SPACES = [
  { id: '3577824', name: 'Digital Marketing', lookbackDays: 90 },
  { id: '3589129', name: 'R&D Apps', lookbackDays: 20 },
  { id: '3525433', name: 'Projects', lookbackDays: 35 },
];

const DEFAULT_LOOKBACK = 30;
const MIN_LOOKBACK = 1;
const MAX_LOOKBACK = 365;

function defaultLookbackFor(spaceId: string): number {
  return CONFIGURED_SPACES.find((s) => s.id === spaceId)?.lookbackDays ?? DEFAULT_LOOKBACK;
}

const PALETTE = ['#7B68EE', '#FF02F0', '#49CCF9', '#10b981', '#f59e0b', '#ef4444'];

type SpaceRow = {
  spaceId: string | null;
  spaceName: string | null;
  taskCount: number;
  openCount: number;
  hoursLogged: number;
  costAud: number;
  /** false = configured space that has never produced any synced data yet */
  synced: boolean;
};

/**
 * Always show every configured space (even if it has never synced), merged
 * with whatever the backend reports from synced data. Any synced space that
 * isn't in the configured list is appended so nothing is hidden.
 */
function buildMergedSpaces(apiRows: Omit<SpaceRow, 'synced'>[]): SpaceRow[] {
  const byId = new Map<string, Omit<SpaceRow, 'synced'>>();
  for (const r of apiRows) {
    const id = r.spaceId?.trim();
    if (id) byId.set(id, r);
  }
  const merged: SpaceRow[] = CONFIGURED_SPACES.map((cfg) => {
    const hit = byId.get(cfg.id);
    byId.delete(cfg.id);
    if (hit) return { ...hit, spaceName: hit.spaceName ?? cfg.name, synced: true };
    return {
      spaceId: cfg.id,
      spaceName: cfg.name,
      taskCount: 0,
      openCount: 0,
      hoursLogged: 0,
      costAud: 0,
      synced: false,
    };
  });
  // Any remaining synced spaces not in the configured list.
  for (const r of byId.values()) merged.push({ ...r, synced: true });
  return merged;
}

function spaceDisplayName(s: SpaceRow): string {
  const n = s.spaceName?.trim();
  if (n) return n;
  const configured = CONFIGURED_SPACES.find((c) => c.id === s.spaceId);
  if (configured) return configured.name;
  return s.spaceId?.trim() || 'Unnamed space';
}

function spaceKey(s: SpaceRow, index: number): string {
  return s.spaceId?.trim() || `space-${index}`;
}

type TabKey = 'grid' | 'workload';

const TAB_ITEMS = [
  { value: 'grid' as TabKey, label: 'Grid' },
  { value: 'workload' as TabKey, label: 'Workload' },
];

function spaceColor(spaceId: string | null | undefined): string {
  const id = spaceId ?? '';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

type SyncControls = {
  syncingId: string | null;
  queuedIds: Set<string>;
  onSync: (id: string) => void;
  /** Current text shown in a space's lookback-days input. */
  lookbackText: (id: string) => string;
  onLookbackChange: (id: string, value: string) => void;
};

function LookbackInput({ sid, controls }: { sid: string; controls: SyncControls }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="How many days back to sync from ClickUp">
      <Input
        type="number"
        value={controls.lookbackText(sid)}
        onChange={(e) => controls.onLookbackChange(sid, e.target.value)}
        disabled={!sid}
        style={{ width: 64 }}
      />
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>days back</span>
    </div>
  );
}

function ProgressBar({ value = 0, color = 'var(--accent)', height = 6 }: { value?: number; color?: string; height?: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      style={{
        width: '100%',
        height,
        background: 'var(--muted-bg)',
        borderRadius: height / 2,
        overflow: 'hidden',
      }}
    >
      <div style={{ width: `${v}%`, height: '100%', background: color, transition: 'width 200ms ease-out' }} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 8, background: 'var(--muted-bg)', borderRadius: 6 }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function SpaceGrid({ spaces, controls }: { spaces: SpaceRow[]; controls: SyncControls }) {
  const navigate = useNavigate();
  const { syncingId, queuedIds, onSync } = controls;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
      {spaces.map((space, index) => {
        const displayName = spaceDisplayName(space);
        const color = spaceColor(space.spaceId);
        const totalHours = space.hoursLogged;
        const billableHours = 0;
        const billPct = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0;
        const initial = (displayName.slice(0, 1) || '?').toUpperCase();
        const sid = space.spaceId?.trim() ?? '';
        const isSyncing = syncingId === sid;
        const isQueued = queuedIds.has(sid);

        return (
          <div
            key={spaceKey(space, index)}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              borderTop: `3px solid ${color}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: `${color}22`,
                  color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {initial}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  {displayName}
                </div>
                <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>
                  {sid || '—'}
                </div>
              </div>
              {isQueued || isSyncing ? (
                <Pill tone="amber" size="xs" icon={<Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />}>
                  syncing…
                </Pill>
              ) : space.synced ? (
                <Pill tone="green" size="xs" icon={<CircleCheck size={10} />}>synced</Pill>
              ) : (
                <Pill tone="amber" size="xs" icon={<CircleDashed size={10} />}>Never synced</Pill>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <Stat label="Tasks" value={fmt.number(space.taskCount)} />
              <Stat label="Open" value={fmt.number(space.openCount)} />
              <Stat label="Members" value="—" />
              <Stat label="Hours" value={isQueued ? '…' : fmt.hours(totalHours)} />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>Billable {fmt.hours(billableHours)}</span>
                <span>{billPct}%</span>
              </div>
              <ProgressBar value={billPct} color={color} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border-soft)', flexWrap: 'wrap' }}>
              <LookbackInput sid={sid} controls={controls} />
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  size="sm"
                  variant="default"
                  disabled={!sid}
                  onClick={() => sid && navigate(`/tasks?spaceId=${encodeURIComponent(sid)}`)}
                >
                  View tasks
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  icon={<RefreshCw size={12} />}
                  loading={isSyncing}
                  disabled={!sid || syncingId !== null || isQueued}
                  onClick={() => sid && onSync(sid)}
                >
                  {isQueued ? 'Queued' : 'Sync'}
                </Button>
                <Button size="sm" variant="ghost" icon={<Settings size={12} />} onClick={() => navigate('/settings')} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WorkloadView({ spaces, controls }: { spaces: SpaceRow[]; controls: SyncControls }) {
  const navigate = useNavigate();
  const { syncingId, queuedIds, onSync } = controls;
  const sorted = useMemo(() => [...spaces].sort((a, b) => b.hoursLogged - a.hoursLogged), [spaces]);
  const total = sorted.reduce((s, sp) => s + sp.hoursLogged, 0);

  return (
    <Card padding={0}>
      <div
        style={{
          padding: 16,
          borderBottom: '1px solid var(--border-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}
          >
            Last 30 days
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {fmt.hours(total)}{' '}
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>across {sorted.length} spaces</span>
          </div>
        </div>
      </div>

      <div style={{ padding: 16, borderBottom: '1px solid var(--border-soft)' }}>
        {total > 0 ? (
          <>
            <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--muted-bg)' }}>
              {sorted.map((sp, si) => (
                <div
                  key={spaceKey(sp, si)}
                  style={{
                    width: `${(sp.hoursLogged / total) * 100}%`,
                    background: spaceColor(sp.spaceId),
                    transition: 'all 200ms',
                  }}
                  title={`${spaceDisplayName(sp)}: ${fmt.hours(sp.hoursLogged)}`}
                />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
              {sorted.map((sp, si) => (
                <div
                  key={spaceKey(sp, si)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: spaceColor(sp.spaceId),
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 500, color: 'var(--text)' }}>{spaceDisplayName(sp)}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmt.hours(sp.hoursLogged)} ({Math.round((sp.hoursLogged / total) * 100)}%)
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No hours logged in this period.</div>
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
            <th style={{ textAlign: 'left', padding: '8px 16px' }}>Space</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Tasks</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Open</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Members</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Hours</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Billable</th>
            <th style={{ textAlign: 'right', padding: '8px 12px' }}>Cost</th>
            <th style={{ width: 230, padding: '8px 16px' }} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((sp, i) => {
            const rowId = sp.spaceId?.trim() ?? '';
            const isSyncing = syncingId === rowId;
            const isQueued = queuedIds.has(rowId);
            return (
            <tr key={spaceKey(sp, i)} style={{ borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined }}>
              <td style={{ padding: '10px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: spaceColor(sp.spaceId), flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{spaceDisplayName(sp)}</span>
                  {!sp.synced && (
                    <Pill tone="amber" size="xs" icon={<CircleDashed size={10} />}>Never synced</Pill>
                  )}
                </div>
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.number(sp.taskCount)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.number(sp.openCount)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>—</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.hours(sp.hoursLogged)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(0)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {fmt.money(Math.round(Number(sp.costAud ?? 0) * 100))}
              </td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                  <LookbackInput sid={rowId} controls={controls} />
                  <Button
                    size="sm"
                    variant="default"
                    icon={isQueued ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
                    loading={isSyncing}
                    disabled={!rowId || syncingId !== null || isQueued}
                    onClick={() => rowId && onSync(rowId)}
                  >
                    {isQueued ? 'Queued' : 'Sync'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!rowId}
                    onClick={() => rowId && navigate(`/tasks?spaceId=${encodeURIComponent(rowId)}`)}
                    icon={<ChevronRight size={12} />}
                  />
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

export function SpacesPage() {
  const [view, setView] = useState<TabKey>('grid');
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [lookbackInput, setLookbackInput] = useState<Record<string, string>>({});
  const prevHoursRef = useRef<Record<string, number>>({});
  const spacesQuery = useSpaces();
  const backfill = useBackfill();
  const queryClient = useQueryClient();

  const apiRows: Omit<SpaceRow, 'synced'>[] = Array.isArray(spacesQuery.data) ? spacesQuery.data : [];
  const mergedSpaces = useMemo(() => buildMergedSpaces(apiRows), [apiRows]);

  // Poll every 8s while any jobs are queued
  useEffect(() => {
    if (queuedIds.size === 0) return;
    const id = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['spaces'] });
    }, 8000);
    return () => clearInterval(id);
  }, [queuedIds.size, queryClient]);

  // Remove a space from queuedIds once its hours change (workers finished)
  useEffect(() => {
    if (queuedIds.size === 0) return;
    const resolved = new Set<string>();
    for (const row of mergedSpaces) {
      const sid = row.spaceId ?? '';
      if (!queuedIds.has(sid)) continue;
      const prev = prevHoursRef.current[sid];
      if (prev !== undefined && row.hoursLogged !== prev) resolved.add(sid);
      prevHoursRef.current[sid] = row.hoursLogged;
    }
    if (resolved.size > 0) {
      setQueuedIds((cur) => { const next = new Set(cur); resolved.forEach((id) => next.delete(id)); return next; });
    }
  }, [mergedSpaces, queuedIds]);

  function lookbackText(spaceId: string): string {
    return lookbackInput[spaceId] ?? String(defaultLookbackFor(spaceId));
  }

  function onLookbackChange(spaceId: string, value: string) {
    // Keep only digits while typing; clamping to [1,365] happens at sync time.
    const digits = value.replace(/[^0-9]/g, '').slice(0, 3);
    setLookbackInput((cur) => ({ ...cur, [spaceId]: digits }));
  }

  function effectiveLookback(spaceId: string): number {
    const raw = lookbackInput[spaceId];
    if (raw === undefined || raw.trim() === '') return defaultLookbackFor(spaceId);
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return defaultLookbackFor(spaceId);
    return Math.max(MIN_LOOKBACK, Math.min(MAX_LOOKBACK, Math.round(n)));
  }

  function markQueued(spaceId: string) {
    prevHoursRef.current[spaceId] = mergedSpaces.find((r) => r.spaceId === spaceId)?.hoursLogged ?? 0;
    setQueuedIds((cur) => new Set(cur).add(spaceId));
  }

  function handleSync(spaceId: string) {
    setSyncingId(spaceId);
    backfill.mutate(
      { spaceId, lookbackDays: effectiveLookback(spaceId) },
      {
        onSuccess: () => markQueued(spaceId),
        onSettled: () => setSyncingId(null),
      },
    );
  }

  function handleSyncAll() {
    if (syncingId !== null) return;
    let chain = Promise.resolve();
    for (const s of mergedSpaces) {
      const sid = s.spaceId?.trim();
      if (!sid) continue;
      chain = chain.then(
        () =>
          new Promise<void>((resolve) => {
            setSyncingId(sid);
            backfill.mutate(
              { spaceId: sid, lookbackDays: effectiveLookback(sid) },
              {
                onSuccess: () => markQueued(sid),
                onSettled: () => { setSyncingId(null); resolve(); },
              },
            );
          }),
      );
    }
  }

  const controls: SyncControls = { syncingId, queuedIds, onSync: handleSync, lookbackText, onLookbackChange };
  const isBusy = syncingId !== null || queuedIds.size > 0;
  const anySynced = mergedSpaces.some((s) => s.synced);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Spaces"
        description="ClickUp space allocation — tasks, time, and cost by space. Set how many days back each space syncs."
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              variant="accent"
              size="md"
              icon={<RefreshCw size={13} />}
              loading={syncingId !== null}
              disabled={isBusy}
              onClick={handleSyncAll}
            >
              Sync all
            </Button>
            <Tabs value={view} onChange={(k) => setView(k as TabKey)} variant="segmented" items={TAB_ITEMS} />
          </div>
        }
      />

      {/* Background processing banner */}
      {queuedIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'var(--pill-amber-bg)',
            color: 'var(--pill-amber-text)',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          <span>
            Fetching time entries for {queuedIds.size === 1 ? [...queuedIds][0] : `${queuedIds.size} spaces`} — workers processing in background. Hours will update automatically.
          </span>
        </div>
      )}

      {!spacesQuery.isLoading && !anySynced && (
        <div style={{ padding: '10px 14px', background: 'var(--muted-bg)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)' }}>
          No spaces have synced yet. Set a "days back" value and hit Sync (or Sync all) to pull tasks and time entries from ClickUp.
        </div>
      )}

      {spacesQuery.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {[1, 2, 3].map((n) => <Skeleton key={n} height={260} />)}
        </div>
      ) : view === 'grid' ? (
        <SpaceGrid spaces={mergedSpaces} controls={controls} />
      ) : (
        <WorkloadView spaces={mergedSpaces} controls={controls} />
      )}
    </div>
  );
}
