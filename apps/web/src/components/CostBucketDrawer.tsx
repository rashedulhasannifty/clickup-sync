import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../api/reports';
import { Drawer } from './ui/Drawer';
import { Pill } from './ui/Pill';
import { fmt } from '../lib/formatters';
import { bucketWindowUtc, bucketLabel } from '../lib/bucketWindow';
import type { CostTrendBucket } from '../hooks/useReports';

interface CostBucketDrawerProps {
  open: boolean;
  bucket: string | null;                    // 'YYYY-MM-DD' or null when closed
  bucketType: CostTrendBucket;
  onClose: () => void;
}

interface ClientRow { client: string; totalHours: number; totalCostAud: number; }

function moneyAud(dollars: number) { return fmt.money(Math.round(dollars * 100)); }

export function CostBucketDrawer({ open, bucket, bucketType, onClose }: CostBucketDrawerProps) {
  const navigate = useNavigate();

  // Compute the window unconditionally when we have a bucket, so the
  // react-query key is stable per bucket+type pair.
  const window = bucket ? bucketWindowUtc(bucket, bucketType) : null;

  const q = useQuery<ClientRow[]>({
    queryKey: ['cost-trend-drawer', bucketType, bucket],
    queryFn: () => reportsApi.timeEntriesByClient({ from: window!.from, to: window!.to }),
    enabled: open && !!bucket,
  });

  const rows = (q.data ?? []).slice().sort((a, b) => {
    if (b.totalCostAud !== a.totalCostAud) return b.totalCostAud - a.totalCostAud;
    return b.totalHours - a.totalHours;
  });
  const footerTotal = rows.reduce((s, r) => s + r.totalCostAud, 0);

  const title = bucket ? `Cost by client — ${bucketLabel(bucket, bucketType)}` : 'Cost by client';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      width={560}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>Total</span>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{moneyAud(footerTotal)}</span>
        </div>
      }
    >
      <div style={{ flex: 1, overflow: 'auto' }}>
        {q.isLoading && (
          <div style={{ padding: 16 }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ height: 32, background: 'var(--muted-bg)', borderRadius: 6, marginBottom: 8, opacity: 0.6 }} />
            ))}
          </div>
        )}
        {q.isError && (
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>
              Couldn't load this bucket's breakdown.
            </div>
            <button
              type="button"
              onClick={() => q.refetch()}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600,
                background: 'var(--surface)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}
        {!q.isLoading && !q.isError && rows.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            No time entries logged in this period.
          </div>
        )}
        {!q.isLoading && !q.isError && rows.length > 0 && (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                {['Client', 'Hours', 'Cost'].map((h, i) => (
                  <th key={h} style={{
                    padding: '8px 14px', textAlign: i === 0 ? 'left' : 'right',
                    fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--muted-bg)',
                    position: 'sticky', top: 0,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const noRate = r.totalCostAud === 0;
                return (
                  <tr
                    key={r.client}
                    onClick={() => {
                      if (!window) return;
                      navigate(`/time-entries?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}&search=${encodeURIComponent(r.client)}`);
                    }}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-soft)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '8px 14px', color: 'var(--text)' }}>{r.client}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                      {fmt.hours(r.totalHours)}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {noRate
                        ? <Pill tone="amber">no rate</Pill>
                        : <span style={{ color: 'var(--text)', fontWeight: 500 }}>{moneyAud(r.totalCostAud)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}
