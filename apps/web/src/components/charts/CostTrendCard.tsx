import { useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { LineChart } from './LineChart';
import { StackedBarChart } from './StackedBarChart';
import type { StackedSeries } from './StackedBarChart';
import { useCostTrend, useClientCostTrend, useOverviewDeltas } from '../../hooks/useReports';
import type { CostTrendBucket, CostTrendPoint } from '../../hooks/useReports';
import { useGlobalFilters } from '../../hooks/useGlobalFilters';
import { CostBucketDrawer } from '../CostBucketDrawer';
import { fmt } from '../../lib/formatters';
import { segmentColor } from '../../lib/segmentColors';
import { currentPeriodProgress } from '../../lib/periodProgress';
import { Delta } from '../ui/Delta';

type ChartMode = 'line' | 'bar';

// Day-count fallbacks for the rolling default window. The `month` branch uses
// setMonth(-12) directly (calendar-month math) and doesn't read from here, so
// it's intentionally omitted.
const BUCKET_DEFAULTS_DAYS: Record<Exclude<CostTrendBucket, 'month'>, number> = { day: 30, week: 7 * 12 };

const BUCKET_ARIA: Record<CostTrendBucket, string> = {
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
};

function moneyAud(dollars: number) { return fmt.money(Math.round(dollars * 100)); }

function defaultRangeForBucket(bucket: CostTrendBucket): { from: string; to: string } {
  // Rolling window to now. Month uses ~365d back, which generally produces
  // 12-13 monthly buckets — good enough; bucketing happens server-side.
  const to = new Date();
  const from = new Date();
  if (bucket === 'month') from.setMonth(from.getMonth() - 12);
  else from.setDate(from.getDate() - BUCKET_DEFAULTS_DAYS[bucket]);
  return { from: from.toISOString(), to: to.toISOString() };
}

function shortBucketLabel(p: CostTrendPoint, bucket: CostTrendBucket): string {
  const [y, m, d] = p.bucket.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (bucket === 'month') return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (bucket === 'week')  return `Wk of ${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Compact label for the stacked bar view (no "Wk of" prefix — bars are narrow
// and the axis is thinned, matching the Assignee cost trend chart).
function barBucketLabel(bucketStr: string, bucket: CostTrendBucket): string {
  const [y, m, d] = bucketStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (bucket === 'month') return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function windowDescription(bucket: CostTrendBucket, customActive: boolean): string {
  if (customActive) return 'custom range';
  if (bucket === 'day')   return 'last 30 days';
  if (bucket === 'week')  return 'last 12 weeks';
  return 'last 12 months';
}

export function CostTrendCard() {
  const [bucket, setBucket] = useState<CostTrendBucket>('day');
  const [mode, setMode] = useState<ChartMode>('line');
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

  // Period-over-period delta for the trend total — uses the chart's effective
  // range (which may differ from the topbar when in default bucket mode).
  const deltasQ = useOverviewDeltas(range.from, range.to);

  const q = useCostTrend(bucket, range.from, range.to);
  const data = q.data ?? [];

  // Bar view: cost split by client per bucket. Only fetched while the bar mode
  // is active so the line view stays a single request.
  const clientQ = useClientCostTrend(bucket, range.from, range.to, mode === 'bar');
  const clientData = clientQ.data;
  const barLabels = (clientData?.buckets ?? []).map(b => barBucketLabel(b, bucket));
  const barValues = clientData?.points.map(p => p.values) ?? [];
  const barSeries: StackedSeries[] = (clientData?.clients ?? []).map((key, i) => ({
    key,
    color: segmentColor(i),
  }));

  const totalCostAud = data.reduce((s, p) => s + p.totalCostAud, 0);

  const subtitleRangeShort =
    useTopbar
      ? (() => {
          const days = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000));
          return `${days}d`;
        })()
      : (bucket === 'day' ? '30d' : bucket === 'week' ? '12w' : '12mo');

  // Forecast: if the last bucket is the current incomplete period AND we're
  // past the 5% elapsed-fraction floor AND there's spend to extrapolate
  // from, project it forward to the end of the period.
  const lastPoint = data[data.length - 1];
  const progress = lastPoint ? currentPeriodProgress(lastPoint.bucket, bucket) : null;
  const elapsedFrac = progress ? progress.elapsed / progress.total : 0;
  const projection = (progress && elapsedFrac >= 0.05 && lastPoint && lastPoint.totalCostAud > 0)
    ? lastPoint.totalCostAud * (progress.total / progress.elapsed)
    : null;

  // Map to LineChart's data shape. The `key` carries the bucket string so we
  // can resolve clicks back to the drawer window.
  const chartData = data.map(p => ({
    label: shortBucketLabel(p, bucket),
    value: p.totalCostAud,
    key: p.bucket,
  }));

  return (
    <>
      <Card
        title="Client cost trend"
        subtitle={`${bucket === 'day' ? 'Daily' : bucket === 'week' ? 'Weekly' : 'Monthly'} — ${windowDescription(bucket, useTopbar)} · ${moneyAud(totalCostAud)} total`}
        padding={16}
        action={
          <div style={{ display: 'inline-flex', gap: 8 }}>
            {/* Line / bar toggle */}
            <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {(['line', 'bar'] as const).map((m) => {
                const active = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    className="btn-3d"
                    onClick={() => setMode(m)}
                    style={{
                      padding: '4px 10px', fontSize: 11, fontWeight: 600,
                      background: active ? 'var(--accent)' : 'var(--surface)',
                      color: active ? '#fff' : 'var(--text-muted)',
                      border: 0, cursor: 'pointer',
                      borderLeft: m === 'line' ? 0 : '1px solid var(--border)',
                      ['--b-edge' as string]: 'var(--border-strong)',
                      ['--b-glow' as string]: 'var(--btn-neutral-glow)',
                      ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
                    }}
                    aria-pressed={active}
                    aria-label={m === 'line' ? 'Show line chart (total cost)' : 'Show bar chart split by client'}
                  >
                    {m === 'line' ? 'Line' : 'Bar'}
                  </button>
                );
              })}
            </div>
            {/* Granularity */}
            <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {(['day', 'week', 'month'] as const).map((b) => {
                const active = bucket === b;
                return (
                  <button
                    key={b}
                    type="button"
                    className="btn-3d"
                    onClick={() => setBucket(b)}
                    style={{
                      padding: '4px 10px', fontSize: 11, fontWeight: 600,
                      background: active ? 'var(--accent)' : 'var(--surface)',
                      color: active ? '#fff' : 'var(--text-muted)',
                      border: 0, cursor: 'pointer',
                      borderLeft: b === 'day' ? 0 : '1px solid var(--border)',
                      ['--b-edge' as string]: 'var(--border-strong)',
                      ['--b-glow' as string]: 'var(--btn-neutral-glow)',
                      ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
                    }}
                    aria-pressed={active}
                    aria-label={`Switch to ${BUCKET_ARIA[b]} granularity`}
                  >
                    {b === 'day' ? 'D' : b === 'week' ? 'W' : 'M'}
                  </button>
                );
              })}
            </div>
          </div>
        }
      >
        {deltasQ.data && (
          <div style={{ marginBottom: 8 }}>
            <Delta
              current={deltasQ.data.current.totalCostAud}
              prior={deltasQ.data.prior.totalCostAud}
              rangeLabel={subtitleRangeShort}
            />
          </div>
        )}
        {mode === 'bar' ? (
          clientQ.isError ? (
            <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 0' }}>
              Couldn't load client cost trend.
            </div>
          ) : (
            <StackedBarChart
              labels={barLabels}
              series={barSeries}
              values={barValues}
              height={200}
              formatValue={moneyAud}
              sortSegmentsByValue
            />
          )
        ) : q.isError ? (
          <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 0' }}>
            Couldn't load cost trend.
          </div>
        ) : (
          <LineChart
            data={chartData}
            height={200}
            formatMax={moneyAud}
            dashedTail={projection != null ? { toValue: projection } : null}
            onPointClick={(d) => d.key && setSelectedBucket(d.key)}
            renderTooltip={(d) => {
              const point = data.find(p => p.bucket === d.key);
              const isCurrentBucket = lastPoint && d.key === lastPoint.bucket && projection != null;
              return (
                <>
                  <div style={{ fontWeight: 600 }}>{d.label}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{moneyAud(d.value)}</div>
                  {point && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                      {fmt.hours(point.totalHours)} · {point.entryCount} entr{point.entryCount === 1 ? 'y' : 'ies'}
                    </div>
                  )}
                  {isCurrentBucket && projection != null && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 4, fontStyle: 'italic' }}>
                      Projected: {moneyAud(projection)} at current pace
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
