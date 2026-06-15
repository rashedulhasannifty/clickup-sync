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
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{children}</span>
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
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Status + event type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{item.id}</span>
          </MetaRow>
          <MetaRow label="Task ID">
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{item.taskId ?? '—'}</span>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            Copy payload
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
