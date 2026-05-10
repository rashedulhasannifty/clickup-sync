import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, CircleCheck, Settings } from 'lucide-react';
import { useSpaces } from '../hooks/useReports';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Tabs } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { Pill } from '../components/ui/Pill';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { fmt } from '../lib/formatters';

const PALETTE = ['#7B68EE', '#FF02F0', '#49CCF9', '#10b981', '#f59e0b', '#ef4444'];

type SpaceRow = {
  spaceId: string | null;
  spaceName: string | null;
  taskCount: number;
  openCount: number;
  hoursLogged: number;
  costAud: number;
};

function spaceDisplayName(s: SpaceRow): string {
  const n = s.spaceName?.trim();
  if (n) return n;
  const id = s.spaceId?.trim();
  if (id) return id;
  return 'Unnamed space';
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

function SpaceGrid({ spaces }: { spaces: SpaceRow[] }) {
  const navigate = useNavigate();
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
              <Pill tone="green" size="xs" icon={<CircleCheck size={10} />}>
                synced
              </Pill>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <Stat label="Tasks" value={fmt.number(space.taskCount)} />
              <Stat label="Open" value={fmt.number(space.openCount)} />
              <Stat label="Members" value="—" />
              <Stat label="Hours" value={fmt.hours(totalHours)} />
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginBottom: 4,
                }}
              >
                <span>Billable {fmt.hours(billableHours)}</span>
                <span>{billPct}%</span>
              </div>
              <ProgressBar value={billPct} color={color} />
            </div>

            <div style={{ display: 'flex', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border-soft)' }}>
              <Button
                size="sm"
                variant="default"
                style={{ flex: 1 }}
                disabled={!sid}
                onClick={() => sid && navigate(`/tasks?spaceId=${encodeURIComponent(sid)}`)}
              >
                View tasks
              </Button>
              <Button size="sm" variant="ghost" icon={<Settings size={12} />} onClick={() => navigate('/settings')} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WorkloadView({ spaces }: { spaces: SpaceRow[] }) {
  const navigate = useNavigate();
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
            <th style={{ width: 80, padding: '8px 16px' }} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((sp, i) => {
            const rowId = sp.spaceId?.trim() ?? '';
            return (
            <tr key={spaceKey(sp, i)} style={{ borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined }}>
              <td style={{ padding: '10px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: spaceColor(sp.spaceId),
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{spaceDisplayName(sp)}</span>
                </div>
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {fmt.number(sp.taskCount)}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {fmt.number(sp.openCount)}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>—</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {fmt.hours(sp.hoursLogged)}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {fmt.hours(0)}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {fmt.money(Math.round(Number(sp.costAud ?? 0) * 100))}
              </td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!rowId}
                  onClick={() => rowId && navigate(`/tasks?spaceId=${encodeURIComponent(rowId)}`)}
                  icon={<ChevronRight size={12} />}
                />
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
  const spacesQuery = useSpaces();

  const spaceRows: SpaceRow[] = Array.isArray(spacesQuery.data) ? spacesQuery.data : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Spaces"
        description="ClickUp space allocation — what we sync, who owns it, and where the work and cost are concentrated."
        actions={
          <Tabs value={view} onChange={(k) => setView(k as TabKey)} variant="segmented" items={TAB_ITEMS} />
        }
      />

      {spacesQuery.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} height={260} />
          ))}
        </div>
      ) : spaceRows.length === 0 ? (
        <EmptyState title="No spaces found" body="Spaces will appear here once data is synced." />
      ) : view === 'grid' ? (
        <SpaceGrid spaces={spaceRows} />
      ) : (
        <WorkloadView spaces={spaceRows} />
      )}
    </div>
  );
}
