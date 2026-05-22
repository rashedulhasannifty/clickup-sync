import { useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { LineChart } from './LineChart';
import { useCostTrend } from '../../hooks/useReports';
import type { CostTrendPoint } from '../../hooks/useReports';
import { useGlobalFilters } from '../../hooks/useGlobalFilters';
import { CostBucketDrawer } from '../CostBucketDrawer';
import { fmt } from '../../lib/formatters';

type Bucket = 'day' | 'week' | 'month';

const BUCKET_DEFAULTS_DAYS: Record<Bucket, number> = { day: 30, week: 7 * 12, month: 365 };

function moneyAud(dollars: number) { return fmt.money(Math.round(dollars * 100)); }

function defaultRangeForBucket(bucket: Bucket): { from: string; to: string } {
  // Rolling window to now. Month uses ~365d back, which generally produces
  // 12-13 monthly buckets — good enough; bucketing happens server-side.
  const to = new Date();
  const from = new Date();
  if (bucket === 'month') from.setMonth(from.getMonth() - 12);
  else from.setDate(from.getDate() - BUCKET_DEFAULTS_DAYS[bucket]);
  return { from: from.toISOString(), to: to.toISOString() };
}

function shortBucketLabel(p: CostTrendPoint, bucket: Bucket): string {
  const [y, m, d] = p.bucket.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (bucket === 'month') return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (bucket === 'week')  return `Wk of ${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function windowDescription(bucket: Bucket, customActive: boolean): string {
  if (customActive) return 'custom range';
  if (bucket === 'day')   return 'last 30 days';
  if (bucket === 'week')  return 'last 12 weeks';
  return 'last 12 months';
}

export function CostTrendCard() {
  const [bucket, setBucket] = useState<Bucket>('day');
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

  // Topbar override = explicit custom range. Other presets (7d/30d/90d)
  // intentionally don't override the bucket-specific default because they
  // produce too few bars for a meaningful trend (e.g. M view on a 7d
  // window would show 1 bar).
  const { dateRange, customFrom, customTo } = useGlobalFilters();
  const useTopbar = dateRange === 'custom' && !!customFrom && !!customTo;

  const range = useMemo(() => {
    if (useTopbar) {
      return { from: new Date(customFrom).toISOString(), to: new Date(customTo).toISOString() };
    }
    return defaultRangeForBucket(bucket);
  }, [bucket, useTopbar, customFrom, customTo]);

  const q = useCostTrend(bucket, range.from, range.to);
  const data = q.data ?? [];

  // Map to LineChart's data shape. The `key` carries the bucket string so we
  // can resolve clicks back to the drawer window.
  const chartData = data.map(p => ({
    label: shortBucketLabel(p, bucket),
    value: p.totalCostAud,
    key: p.bucket,
  }));

  const hasAnySpend = data.some(p => p.totalCostAud > 0);

  return (
    <>
      <Card
        title="Client cost trend"
        subtitle={`${bucket === 'day' ? 'Daily' : bucket === 'week' ? 'Weekly' : 'Monthly'} — ${windowDescription(bucket, useTopbar)}${!hasAnySpend && !q.isLoading ? ' · no spend in this period' : ''}`}
        padding={16}
        action={
          <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            {(['day', 'week', 'month'] as const).map((b) => {
              const active = bucket === b;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBucket(b)}
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 600,
                    background: active ? 'var(--accent)' : 'var(--surface)',
                    color: active ? 'var(--accent-foreground, white)' : 'var(--text-muted)',
                    border: 0, cursor: 'pointer',
                    borderLeft: b === 'day' ? 0 : '1px solid var(--border)',
                  }}
                  aria-pressed={active}
                  aria-label={`Switch to ${b}ly granularity`}
                >
                  {b === 'day' ? 'D' : b === 'week' ? 'W' : 'M'}
                </button>
              );
            })}
          </div>
        }
      >
        {q.isError ? (
          <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 0' }}>
            Couldn't load cost trend.
          </div>
        ) : (
          <LineChart
            data={chartData}
            height={200}
            onPointClick={(d) => d.key && setSelectedBucket(d.key)}
            renderTooltip={(d) => {
              const point = data.find(p => p.bucket === d.key);
              return (
                <>
                  <div style={{ fontWeight: 600 }}>{d.label}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{moneyAud(d.value)}</div>
                  {point && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                      {fmt.hours(point.totalHours)} · {point.entryCount} entr{point.entryCount === 1 ? 'y' : 'ies'}
                    </div>
                  )}
                </>
              );
            }}
          />
        )}
      </Card>
      <CostBucketDrawer
        open={!!selectedBucket}
        bucket={selectedBucket}
        bucketType={bucket}
        onClose={() => setSelectedBucket(null)}
      />
    </>
  );
}
