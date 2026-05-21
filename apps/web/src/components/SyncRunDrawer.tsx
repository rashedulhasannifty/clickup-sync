import type { ReactNode } from 'react';
import { Drawer } from './ui/Drawer';
import { StatusBadge } from './ui/StatusBadge';
import { Callout } from './ui/Callout';
import { fmt } from '../lib/formatters';

export interface JobLogItem {
  id: string;
  queueName: string;
  jobName: string;
  status: string;
  entityId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  tasksSynced: number | null;
  timeEntriesSynced: number | null;
  /** For failed rows: true if a later successful run for the same
   *  (queue, entity) exists. null for non-failed rows. */
  recovered?: boolean | null;
}

interface SyncRunDrawerProps {
  item: JobLogItem | null;
  onClose: () => void;
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      <span className="text-sm text-[var(--text)]">{children}</span>
    </>
  );
}

export function SyncRunDrawer({ item, onClose }: SyncRunDrawerProps) {
  if (!item) return null;

  const durationLabel = item.durationMs == null
    ? '—'
    : item.durationMs < 1000
      ? `${item.durationMs}ms`
      : `${(item.durationMs / 1000).toFixed(1)}s`;

  const logLines = [
    `[INFO] Job started: ${item.jobName}`,
    `[INFO] Entity: ${item.entityId ?? '(none)'}`,
    item.tasksSynced != null ? `[INFO] Tasks synced: ${item.tasksSynced}` : null,
    item.timeEntriesSynced != null ? `[INFO] Time entries synced: ${item.timeEntriesSynced}` : null,
    item.status === 'failed'
      ? `[ERROR] ${item.errorMessage ?? 'Unknown error'}`
      : '[INFO] Completed successfully',
  ].filter(Boolean) as string[];

  return (
    <Drawer open={item !== null} onClose={onClose} title="Sync Run Detail" width={620}>
      <div className="p-5 flex flex-col gap-5">
        {/* Meta grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px 24px',
            alignItems: 'start',
          }}
        >
          <MetaRow label="Run ID">
            <span className="font-mono text-xs">{item.id}</span>
          </MetaRow>
          <MetaRow label="Queue">{item.queueName}</MetaRow>
          <MetaRow label="Job Name">{item.jobName}</MetaRow>
          <MetaRow label="Status">
            <StatusBadge status={item.status} />
          </MetaRow>
          <MetaRow label="Entity ID">
            <span className="font-mono text-xs">{item.entityId ?? '—'}</span>
          </MetaRow>
          <MetaRow label="Started At">
            {item.startedAt ? fmt.dateTime(item.startedAt) : '—'}
          </MetaRow>
          <MetaRow label="Finished At">
            {item.finishedAt ? fmt.dateTime(item.finishedAt) : '—'}
          </MetaRow>
          <MetaRow label="Duration">{durationLabel}</MetaRow>
          {item.tasksSynced != null && (
            <MetaRow label="Tasks synced">{item.tasksSynced}</MetaRow>
          )}
          {item.timeEntriesSynced != null && (
            <MetaRow label="Time entries synced">{item.timeEntriesSynced}</MetaRow>
          )}
        </div>

        {/* Error callout */}
        {item.errorMessage && (
          <Callout tone="error">{item.errorMessage}</Callout>
        )}

        {/* Terminal panel */}
        <div
          style={{
            background: '#0d0d0d',
            borderRadius: 'var(--radius)',
            padding: '12px 16px',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: '1.6',
            color: '#d4d4d4',
            overflow: 'auto',
            maxHeight: 240,
          }}
        >
          {logLines.map((line, i) => (
            <div
              key={i}
              style={{
                color: line.startsWith('[ERROR]')
                  ? '#f87171'
                  : line.startsWith('[INFO]')
                    ? '#86efac'
                    : '#d4d4d4',
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
}
