import { Drawer } from './ui/Drawer';
import type { AuditLogRow } from '../api/auditLog';
import { fmt } from '../lib/formatters';

export function AuditLogDrawer({ item, onClose }: { item: AuditLogRow | null; onClose: () => void }) {
  if (!item) return null;
  return (
    <Drawer open={!!item} onClose={onClose} title={`${item.method} ${item.path}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, padding: 18, overflowY: 'auto' }}>
        <Field label="Occurred" value={fmt.dateTime(item.occurredAt)} />
        <Field label="Actor" value={item.actor ?? '— (no X-Admin-User header)'} />
        <Field label="Status" value={String(item.statusCode)} />
        <Field label="Duration" value={item.durationMs != null ? `${item.durationMs} ms` : '—'} />
        <Field label="Route" value={item.routePattern ?? item.path} />
        <Field label="IP" value={item.ip ?? '—'} />
        <Field label="User-Agent" value={item.userAgent ?? '—'} />
        {item.errorMessage && <Field label="Error" value={item.errorMessage} />}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Request body</div>
          <pre style={{
            background: 'var(--muted-bg)', border: '1px solid var(--border)', borderRadius: 6,
            padding: 10, fontSize: 11, lineHeight: 1.5,
            maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>{JSON.stringify(item.requestBody ?? null, null, 2)}</pre>
        </div>
      </div>
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ color: 'var(--text)', marginTop: 2 }}>{value}</div>
    </div>
  );
}
