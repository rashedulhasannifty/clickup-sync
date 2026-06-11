import { useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { StackedBarChart } from './StackedBarChart';
import type { StackedSeries } from './StackedBarChart';
import { useAssigneeCostTrend } from '../../hooks/useReports';
import type { CostTrendBucket } from '../../hooks/useReports';
import { useGlobalFilters } from '../../hooks/useGlobalFilters';
import { fmt } from '../../lib/formatters';

const BUCKET_ARIA: Record<CostTrendBucket, string> = { day: 'daily', week: 'weekly', month: 'monthly' };
const BUCKET_DEFAULTS_DAYS: Record<Exclude<CostTrendBucket, 'month'>, number> = { day: 30, week: 7 * 12 };

// Distinct hues for assignee segments; the last entry colors the "Other" bucket.
// Hues are spread around the wheel so adjacent legend entries stay readable —
// no two near-identical purples/blues (the donut had this exact problem).
const ASSIGNEE_PALETTE = [
  '#7B68EE', '#FF02F0', '#49CCF9', '#10b981', '#f59e0b', '#ef4444',
  '#84cc16', '#06b6d4', '#ec4899', '#6366f1', '#94a3b8',
];

function moneyAud(dollars: number) { return fmt.money(Math.round(dollars * 100)); }

function defaultRangeForBucket(bucket: CostTrendBucket): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (bucket === 'month') from.setMonth(from.getMonth() - 12);
  else from.setDate(from.getDate() - BUCKET_DEFAULTS_DAYS[bucket]);
  return { from: from.toISOString(), to: to.toISOString() };
}

function shortBucketLabel(bucketStr: string, bucket: CostTrendBucket): string {
  const [y, m, d] = bucketStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (bucket === 'month') return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (bucket === 'week')  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function windowDescription(bucket: CostTrendBucket, customActive: boolean): string {
  if (customActive) return 'custom range';
  if (bucket === 'day')  return 'last 30 days';
  if (bucket === 'week') return 'last 12 weeks';
  return 'last 12 months';
}

export function AssigneeCostTrendCard() {
  const [bucket, setBucket] = useState<CostTrendBucket>('day');

  // Same convention as CostTrendCard: only an explicit custom topbar range
  // overrides the bucket-specific default window.
  const { dateRange, customFrom, customTo } = useGlobalFilters();
  const useTopbar = dateRange === 'custom' && !!customFrom && !!customTo;

  const range = useMemo(() => {
    if (useTopbar) return { from: new Date(customFrom).toISOString(), to: new Date(customTo).toISOString() };
    return defaultRangeForBucket(bucket);
  }, [bucket, useTopbar, customFrom, customTo]);

  const q = useAssigneeCostTrend(bucket, range.from, range.to);
  const data = q.data;

  const labels = (data?.buckets ?? []).map(b => shortBucketLabel(b, bucket));
  const values = data?.points.map(p => p.values) ?? [];
  const series: StackedSeries[] = (data?.assignees ?? []).map((key, i) => ({
    key,
    // Keep "Other" visually muted via the palette's last slot.
    color: key === 'Other' ? ASSIGNEE_PALETTE[ASSIGNEE_PALETTE.length - 1] : ASSIGNEE_PALETTE[i % (ASSIGNEE_PALETTE.length - 1)],
  }));

  const total = values.reduce((s, v) => s + Object.values(v).reduce((a, b) => a + b, 0), 0);

  return (
    <Card
      title="Assignee cost trend"
      subtitle={`${bucket === 'day' ? 'Daily' : bucket === 'week' ? 'Weekly' : 'Monthly'} — ${windowDescription(bucket, useTopbar)} · ${moneyAud(total)} total`}
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
                  color: active ? '#fff' : 'var(--text-muted)',
                  border: 0, cursor: 'pointer',
                  borderLeft: b === 'day' ? 0 : '1px solid var(--border)',
                }}
                aria-pressed={active}
                aria-label={`Switch to ${BUCKET_ARIA[b]} granularity`}
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
          Couldn't load assignee cost trend.
        </div>
      ) : (
        <StackedBarChart labels={labels} series={series} values={values} height={220} formatValue={moneyAud} />
      )}
    </Card>
  );
}
