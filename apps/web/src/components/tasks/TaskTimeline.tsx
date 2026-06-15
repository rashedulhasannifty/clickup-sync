import { type ReactNode } from 'react';
import { Activity, ArrowRight, Flag, FolderInput, UserMinus, UserPlus } from 'lucide-react';
import { fmt } from '../../lib/formatters';
import { ClickupAvatar } from '../ui/ClickupAvatar';

/**
 * Human-readable timeline of captured task change events
 * (status / priority / assignee / move) from clickup_task_events. Consumes the
 * `kind: 'event'` items returned by /admin/tasks/:id/history — see
 * api/task-history.ts. before/after shapes follow ClickUp's webhook history
 * payloads; we read them defensively since they vary per event type.
 */
export interface TaskTimelineEvent {
  kind: 'event';
  id: string;
  at: string;
  eventType: string;
  changedByUserName: string | null;
  before: unknown;
  after: unknown;
}

// --- safe accessors over the untyped before/after JSON --------------------
function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

const PRIORITY_TINT: Record<string, string> = {
  urgent: 'var(--pill-red-text)',
  high: 'var(--amber)',
  normal: 'var(--blue)',
  low: 'var(--text-faint)',
};

function DotChip({ label, color }: { label: string; color?: string | null }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        background: 'var(--muted-bg)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color || 'var(--text-faint)', flexShrink: 0 }} />
      {label}
    </span>
  );
}

function Transition({ from, to }: { from: ReactNode; to: ReactNode }) {
  const dash = <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {from ?? dash}
      <ArrowRight size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
      {to ?? dash}
    </span>
  );
}

interface Described {
  icon: ReactNode;
  tint: string;
  headline: string;
  body: ReactNode;
}

function describe(ev: TaskTimelineEvent): Described {
  const before = asObj(ev.before);
  const after = asObj(ev.after);

  switch (ev.eventType) {
    case 'taskStatusUpdated': {
      const b = asStr(before?.status);
      const a = asStr(after?.status);
      return {
        icon: <Activity size={13} strokeWidth={2} />,
        tint: 'var(--accent)',
        headline: b ? 'Status changed' : 'Status set',
        body: (
          <Transition
            from={b ? <DotChip label={b} color={asStr(before?.color)} /> : null}
            to={a ? <DotChip label={a} color={asStr(after?.color)} /> : null}
          />
        ),
      };
    }
    case 'taskPriorityUpdated': {
      const b = asStr(before?.priority);
      const a = asStr(after?.priority);
      return {
        icon: <Flag size={13} strokeWidth={2} />,
        tint: 'var(--amber)',
        headline: b ? 'Priority changed' : 'Priority set',
        body: (
          <Transition
            from={b ? <DotChip label={b} color={PRIORITY_TINT[b.toLowerCase()] ?? asStr(before?.color)} /> : null}
            to={a ? <DotChip label={a} color={PRIORITY_TINT[a.toLowerCase()] ?? asStr(after?.color)} /> : null}
          />
        ),
      };
    }
    case 'taskAssigneeUpdated': {
      // ClickUp sends assignee_add (after = user) and assignee_rem (before = user)
      // as separate history items; we infer which from before/after presence.
      const added = after ? asStr(after.username) || asStr(after.email) : null;
      const removed = before ? asStr(before.username) || asStr(before.email) : null;
      if (added && !removed) {
        return {
          icon: <UserPlus size={13} strokeWidth={2} />,
          tint: 'var(--blue)',
          headline: 'Assignee added',
          body: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ClickupAvatar name={added} email={asStr(after?.email)} userId={asStr(after?.id) ?? (typeof after?.id === 'number' ? String(after.id) : null)} size="sm" />
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)' }}>{added}</span>
            </span>
          ),
        };
      }
      if (removed && !added) {
        return {
          icon: <UserMinus size={13} strokeWidth={2} />,
          tint: 'var(--pill-red-text)',
          headline: 'Assignee removed',
          body: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.75 }}>
              <ClickupAvatar name={removed} email={asStr(before?.email)} userId={asStr(before?.id) ?? (typeof before?.id === 'number' ? String(before.id) : null)} size="sm" />
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', textDecoration: 'line-through' }}>{removed}</span>
            </span>
          ),
        };
      }
      return {
        icon: <UserPlus size={13} strokeWidth={2} />,
        tint: 'var(--blue)',
        headline: 'Assignee changed',
        body: <Transition from={removed ? <DotChip label={removed} /> : null} to={added ? <DotChip label={added} /> : null} />,
      };
    }
    case 'taskMoved': {
      const b = asStr(before?.name);
      const a = asStr(after?.name);
      return {
        icon: <FolderInput size={13} strokeWidth={2} />,
        tint: 'var(--pill-purple-text)',
        headline: 'Moved list',
        body: (
          <Transition
            from={b ? <DotChip label={b} color="var(--pill-purple-text)" /> : null}
            to={a ? <DotChip label={a} color="var(--pill-purple-text)" /> : null}
          />
        ),
      };
    }
    default:
      return {
        icon: <Activity size={13} strokeWidth={2} />,
        tint: 'var(--text-muted)',
        headline: ev.eventType,
        body: null,
      };
  }
}

export function TaskTimeline({ events, loading }: { events: TaskTimelineEvent[]; loading?: boolean }) {
  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading timeline…</div>;
  }
  if (events.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
        No status, priority, assignee, or move events recorded yet. These are captured from ClickUp webhooks as they happen.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {events.map((ev, i) => {
        const d = describe(ev);
        const isLast = i === events.length - 1;
        return (
          <div key={ev.kind + ev.id} style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
            {/* Rail: dot + connecting line */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: `color-mix(in srgb, ${d.tint} 14%, transparent)`,
                  color: d.tint,
                  border: `1px solid color-mix(in srgb, ${d.tint} 35%, transparent)`,
                  flexShrink: 0,
                }}
              >
                {d.icon}
              </span>
              {!isLast && <span style={{ flex: 1, width: 2, background: 'var(--border)', marginTop: 2, minHeight: 12 }} />}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: d.body ? 6 : 2 }}>{d.headline}</div>
              {d.body && <div style={{ marginBottom: 6 }}>{d.body}</div>}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {ev.changedByUserName && <span style={{ fontWeight: 500 }}>{ev.changedByUserName}</span>}
                {ev.changedByUserName && <span style={{ color: 'var(--text-faint)' }}>·</span>}
                <span title={fmt.dateTime(ev.at)}>{fmt.relative(ev.at)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
