import type { ReactNode } from 'react';
import { Drawer } from './ui/Drawer';
import { Pill } from './ui/Pill';
import { Callout } from './ui/Callout';
import { Button } from './ui/Button';
import { StatusBadge } from './ui/StatusBadge';
import { fmt } from '../lib/formatters';

export interface WebhookItem {
  id: string;
  eventType: string;
  taskId: string | null;
  status: string;
  receivedAt: string;
  processedAt: string | null;
}

interface WebhookEventDrawerProps {
  item: WebhookItem | null;
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

export function WebhookEventDrawer({ item, onClose }: WebhookEventDrawerProps) {
  if (!item) return null;

  const jsonPayload = JSON.stringify(item, null, 2);

  function handleCopy() {
    navigator.clipboard.writeText(jsonPayload).catch(() => undefined);
  }

  return (
    <Drawer open={item !== null} onClose={onClose} title="Webhook Event" width={580}>
      <div className="p-5 flex flex-col gap-5">
        {/* Status + event type */}
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />
          <Pill tone="blue">{item.eventType}</Pill>
        </div>

        {/* Meta grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px 24px',
            alignItems: 'start',
          }}
        >
          <MetaRow label="Event ID">
            <span className="font-mono text-xs">{item.id}</span>
          </MetaRow>
          <MetaRow label="Task ID">
            <span className="font-mono text-xs">{item.taskId ?? '—'}</span>
          </MetaRow>
          <MetaRow label="Received">{fmt.dateTime(item.receivedAt)}</MetaRow>
          <MetaRow label="Processed">
            {item.processedAt ? fmt.dateTime(item.processedAt) : 'Pending'}
          </MetaRow>
        </div>

        {/* Not processed callout */}
        {!item.processedAt && (
          <Callout tone="warning">This event has not been processed yet.</Callout>
        )}

        {/* JSON viewer */}
        <pre
          style={{
            background: 'var(--code-bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '12px 16px',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: '1.6',
            color: 'var(--text)',
            overflow: 'auto',
            maxHeight: 280,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {jsonPayload}
        </pre>

        {/* Footer actions */}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            Copy payload
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
