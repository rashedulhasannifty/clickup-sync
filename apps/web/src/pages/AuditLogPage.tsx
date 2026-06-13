import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuditLog } from '../hooks/useAuditLog';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';
import { QueryError } from '../components/ui/QueryError';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Input } from '../components/ui/Input';
import { AuditLogDrawer } from '../components/AuditLogDrawer';
import type { AuditLogRow } from '../api/auditLog';
import { fmt } from '../lib/formatters';

function methodTone(m: string): 'green' | 'amber' | 'red' | 'blue' {
  if (m === 'POST') return 'green';
  if (m === 'PATCH' || m === 'PUT') return 'amber';
  if (m === 'DELETE') return 'red';
  return 'blue';
}

function statusTone(code: number): 'green' | 'amber' | 'red' {
  if (code >= 500) return 'red';
  if (code >= 400) return 'amber';
  return 'green';
}

export function AuditLogPage() {
  const [actor, setActor] = useState('');
  const [selected, setSelected] = useState<AuditLogRow | null>(null);
  const query = useAuditLog({ actor: actor || undefined, limit: 100 });
  const items: AuditLogRow[] = query.data?.items ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Audit Log"
        description="Admin actions (POST / PATCH / DELETE on /admin endpoints). Reads are not audited."
      />

      <QueryError query={query} what="audit log" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <ShieldCheck size={14} style={{ color: 'var(--text-muted)' }} />
        <div style={{ flex: 1, maxWidth: 280 }}>
          <Input aria-label="Filter by actor" placeholder="Filter by actor…" value={actor} onChange={(e) => setActor(e.target.value)} />
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {query.data?.total ?? 0} total
        </span>
      </div>

      {query.isLoading ? (
        <TableSkeleton />
      ) : (
        <Card padding={0}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--muted-bg)', textTransform: 'uppercase', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', fontWeight: 600 }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', width: 130 }}>When</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Actor</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', width: 80 }}>Method</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Path</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', width: 80 }}>Status</th>
                <th style={{ textAlign: 'right', padding: '10px 16px', width: 90 }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={6}>
                  <EmptyState
                    icon={<ShieldCheck size={20} />}
                    title="No audit log entries"
                    body={actor ? 'No actions match this actor filter.' : 'Admin write actions will appear here as they happen.'}
                  />
                </td></tr>
              ) : (
                items.map((row, i) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(row); } }}
                    style={{ borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined, cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt.relative(row.occurredAt)}</td>
                    <td style={{ padding: '12px', color: 'var(--text)' }}>{row.actor ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                    <td style={{ padding: '12px' }}><Pill tone={methodTone(row.method)} size="xs">{row.method}</Pill></td>
                    <td style={{ padding: '12px', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text)' }}>{row.path}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}><Pill tone={statusTone(row.statusCode)} size="xs">{row.statusCode}</Pill></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{row.durationMs != null ? `${row.durationMs}ms` : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}

      <AuditLogDrawer item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
