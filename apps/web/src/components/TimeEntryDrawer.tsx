import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, CircleCheck, AlertTriangle, Eye, Plus } from 'lucide-react';
import { fmt } from '../lib/formatters';
import { Drawer } from './ui/Drawer';
import { ClickupAvatar } from './ui/ClickupAvatar';
import { Pill } from './ui/Pill';
import { Button } from './ui/Button';

export interface TimeEntryItem {
  [key: string]: unknown;
  timeEntryId: string;
  taskId: string;
  taskName: string | null;
  client?: string | null;
  listName?: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  startTime: string;
  endTime: string | null;
  durationHours: number;
  hourlyRateCents: number;
  costAud: number;
  status: string;
  chargeable: boolean;
  /**
   * The RAW per-entry override, distinct from the resolved `chargeable` above.
   * null = this entry inherits its answer from the (task, assignee) rule or
   * the task flag; true/false = this row is what decides it.
   */
  chargeableOverride: boolean | null;
  description: string | null;
  syncedAt: string | null;
  rateId?: string | null;
  currency?: string;
}

function MetaGrid({ items }: { items: [string, ReactNode][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 20px' }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</span>
          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {v ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

interface TimeEntryDrawerProps {
  entry: TimeEntryItem | null;
  onClose: () => void;
}

export function TimeEntryDrawer({ entry, onClose }: TimeEntryDrawerProps) {
  const navigate = useNavigate();

  if (!entry) {
    return <Drawer open={false} onClose={onClose} width={520} />;
  }

  const currency = entry.currency ?? 'USD';
  const hasCost = entry.status === 'COST_CALCULATED' && entry.costAud > 0;
  const firstName = entry.userName.split(/\s+/)[0] ?? entry.userName;

  return (
    <Drawer open width={520} onClose={onClose}>
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
      }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)', marginBottom: 4 }}>
            {entry.timeEntryId}
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0, color: 'var(--text)', lineHeight: 1.3 }}>
            {entry.taskName ?? '—'}
          </h2>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {entry.status === 'COST_CALCULATED' ? (
              <Pill tone="green" size="xs" icon={<CircleCheck size={11} strokeWidth={2} />}>Cost calculated</Pill>
            ) : entry.status === 'COST_EXCLUDED' ? (
              <Pill tone="gray" size="xs">Excluded</Pill>
            ) : entry.status === 'NOT_CHARGEABLE' ? (
              // Gray, not amber: the rate WAS resolved, the cost is zero
              // because this entry resolved to non-chargeable — the task
              // flag or a per-assignee rule can each be the reason. Nothing
              // to fix.
              <Pill tone="gray" size="xs">Not chargeable</Pill>
            ) : (
              <Pill tone="amber" size="xs" icon={<AlertTriangle size={11} strokeWidth={2} />}>No rate found</Pill>
            )}
            {entry.chargeable
              ? <Pill tone="blue">Chargeable</Pill>
              : <Pill tone="gray">Non-chargeable</Pill>}
          </div>
        </div>
        <button
          type="button"
          className="btn-3d"
          onClick={onClose}
          style={{
            width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)',
            borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            ['--b-edge' as string]: 'var(--border-strong)',
            ['--b-glow' as string]: 'var(--btn-neutral-glow)',
            ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
          }}
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--muted-bg)', borderRadius: 8 }}>
          <ClickupAvatar userId={entry.userId} email={entry.userEmail} name={entry.userName} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{entry.userName}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{entry.userEmail}</div>
          </div>
          <Button size="sm" variant="default" icon={<Eye size={12} strokeWidth={1.75} />} onClick={() => navigate('/assignee-rates')}>
            Rates
          </Button>
        </div>

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Time</h3>
          <MetaGrid items={[
            ['Start', fmt.dateTime(entry.startTime)],
            ['End', entry.endTime ? fmt.dateTime(entry.endTime) : '—'],
            ['Duration', fmt.duration(entry.durationHours)],
            ['Chargeable', entry.chargeable ? 'Yes' : 'No'],
          ]}
          />
        </div>

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Cost calculation</h3>
          {hasCost ? (
            <div style={{ padding: 12, background: 'var(--pill-green-bg)', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--pill-green-text)', fontWeight: 600 }}>Calculated</span>
                <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>
                  rate: {entry.rateId ?? '—'}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {fmt.duration(entry.durationHours)} × {fmt.money(entry.hourlyRateCents, currency)}/h ={' '}
                <strong style={{ fontSize: 16 }}>{fmt.money(entry.costAud * 100, currency)}</strong>
              </div>
            </div>
          ) : entry.status === 'COST_EXCLUDED' ? (
            <div style={{ padding: 12, background: 'var(--muted-bg)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Excluded from costing</div>
              <div style={{ fontSize: 12, color: 'var(--text)' }}>
                {firstName} is excluded from costing, so this entry&apos;s cost is $0. Hours still count toward totals.
                Manage exclusions on the Assignee Rates page.
              </div>
            </div>
          ) : entry.status === 'NOT_CHARGEABLE' ? (
            // Deliberately NOT the amber no-rate box, and deliberately no "Add
            // rate" CTA: the rate was resolved and stored, the cost is zero
            // because this entry resolved to non-chargeable — the task flag
            // or a per-assignee rule can each be the reason. There is no
            // problem to fix.
            <div style={{ padding: 12, background: 'var(--muted-bg)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Not chargeable</div>
              <div style={{ fontSize: 12, color: 'var(--text)' }}>
                This entry is non-chargeable, so its cost is $0. Hours still count toward totals.
                {/* The rate is stored, but only when one covered the entry date —
                    don't present a zero as "the resolved rate". */}
                {entry.hourlyRateCents > 0 && (
                  <> The resolved rate was {fmt.money(entry.hourlyRateCents, currency)}/h.</>
                )}
              </div>
            </div>
          ) : (
            <div style={{ padding: 12, background: 'var(--pill-amber-bg)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--pill-amber-text)', fontWeight: 600, marginBottom: 4 }}>NO_RATE_FOUND</div>
              <div style={{ fontSize: 12, color: 'var(--text)' }}>
                No active assignee rate covers this entry&apos;s start date ({fmt.shortDate(entry.startTime)}).
              </div>
              <Button
                size="sm"
                variant="accent"
                style={{ marginTop: 10 }}
                icon={<Plus size={12} strokeWidth={1.75} />}
                onClick={() => navigate('/assignee-rates')}
              >
                Add rate for {firstName}
              </Button>
            </div>
          )}
        </div>

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Description</h3>
          <div style={{ fontSize: 13, color: 'var(--text)', padding: 10, background: 'var(--muted-bg)', borderRadius: 6, minHeight: 40 }}>
            {entry.description ?? <span style={{ color: 'var(--text-faint)' }}>No description</span>}
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Sync</h3>
          <MetaGrid items={[
            ['Synced at', entry.syncedAt ? fmt.dateTime(entry.syncedAt) : '—'],
            ['Task ID', entry.taskId || '—'],
          ]}
          />
        </div>
      </div>
    </Drawer>
  );
}
