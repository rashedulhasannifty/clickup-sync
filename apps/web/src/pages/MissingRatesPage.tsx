import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  DollarSign,
  Download,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { useMissingRates } from '../hooks/useReports';
import { fmt } from '../lib/formatters';
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from '../lib/csv';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { MetricCard } from '../components/ui/MetricCard';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Tabs } from '../components/ui/Tabs';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Pill';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

/** Placeholder rate for “est. uncosted” (UI only; matches design copy). */
const PLACEHOLDER_RATE_CENTS_PER_H = 4200;

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'All severities' },
  { value: 'high', label: 'High severity' },
  { value: 'medium', label: 'Medium severity' },
  { value: 'low', label: 'Low severity' },
];

const TAB_ITEMS = [
  { value: 'cards', label: 'Grouped' },
  { value: 'queue', label: 'Triage queue' },
];

interface AffectedTask {
  taskId: string;
  taskName: string;
}

interface MissingRateItem {
  userId: string;
  userName: string;
  userEmail: string;
  missingCount: number;
  affectedHours: number;
  firstDate: string;
  latestDate: string;
  affectedTaskCount: number;
  affectedTasks: AffectedTask[];
}

function getSeverity(missingCount: number): {
  key: 'high' | 'medium' | 'low';
  tone: 'red' | 'amber' | 'gray';
  borderCss: string;
} {
  if (missingCount > 10) return { key: 'high', tone: 'red', borderCss: 'var(--red)' };
  if (missingCount >= 3) return { key: 'medium', tone: 'amber', borderCss: 'var(--amber)' };
  return { key: 'low', tone: 'gray', borderCss: 'var(--text-faint)' };
}

function estimatedMissingCostCents(row: MissingRateItem): number {
  return Math.round(row.affectedHours * PLACEHOLDER_RATE_CENTS_PER_H);
}

const INLINE_TASK_LIMIT = 5;

function MissingRateGroupCard({ item, navigate }: { item: MissingRateItem; navigate: ReturnType<typeof useNavigate> }) {
  const [expanded, setExpanded] = useState(false);
  const sev = getSeverity(item.missingCount);
  const allAffectedTasks = item.affectedTasks ?? [];
  const totalAffected = item.affectedTaskCount ?? allAffectedTasks.length;
  const inlineTasks = allAffectedTasks.slice(0, INLINE_TASK_LIMIT);
  const remainder = Math.max(0, totalAffected - inlineTasks.length);
  const isTruncatedFromBackend = totalAffected > allAffectedTasks.length;

  function showAllAffectedInTasksPage() {
    const taskIds = allAffectedTasks.map((t) => t.taskId).join(',');
    if (!taskIds) return;
    navigate(`/tasks?taskIds=${encodeURIComponent(taskIds)}`);
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        borderLeft: `3px solid ${sev.borderCss}`,
      }}
    >
      <div style={{ padding: 14, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Avatar name={item.userName} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{item.userName}</span>
            <Pill tone={sev.tone} size="xs">
              {sev.key}
            </Pill>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{item.userEmail}</div>
          <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} />}>
            No active rate
          </Pill>
        </div>
      </div>

      <div style={{ padding: '0 14px 14px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <div style={{ padding: 10, background: 'var(--muted-bg)', borderRadius: 7 }}>
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Entries
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {item.missingCount}
          </div>
        </div>
        <div style={{ padding: 10, background: 'var(--muted-bg)', borderRadius: 7 }}>
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Hours
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {fmt.hours(item.affectedHours)}
          </div>
        </div>
        <div style={{ padding: 10, background: 'var(--muted-bg)', borderRadius: 7, gridColumn: '1 / -1' }}>
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Date range
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {fmt.shortDate(item.firstDate)} <ChevronRight size={11} /> {fmt.shortDate(item.latestDate)}
          </div>
        </div>
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-soft)' }}>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: 0,
            padding: 0,
            fontSize: 12,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontWeight: 500,
            fontFamily: 'inherit',
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? 'Hide' : 'Show'} affected tasks ({totalAffected})
        </button>
        {expanded && (
          <>
            <ul
              style={{
                listStyle: 'none',
                padding: '8px 0 0 16px',
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {inlineTasks.map((t) => (
                <li
                  key={t.taskId}
                  style={{
                    fontSize: 12,
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: 'var(--text-faint)', marginRight: 6 }}>·</span>
                  {t.taskName}
                </li>
              ))}
            </ul>
            {remainder > 0 && (
              <button
                type="button"
                onClick={showAllAffectedInTasksPage}
                style={{
                  marginTop: 8,
                  marginLeft: 16,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'transparent',
                  border: 0,
                  padding: 0,
                  fontSize: 12,
                  color: 'var(--accent, var(--text))',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  textDecoration: 'underline',
                }}
                title={
                  isTruncatedFromBackend
                    ? `Opens Tasks page with the ${allAffectedTasks.length} most recent affected tasks. True total: ${totalAffected}.`
                    : `Opens Tasks page filtered to all ${totalAffected} affected tasks.`
                }
              >
                {isTruncatedFromBackend
                  ? `Show more · open ${allAffectedTasks.length} of ${totalAffected} in Tasks`
                  : `Show more · open all ${totalAffected} in Tasks`}
                <ChevronRight size={12} />
              </button>
            )}
          </>
        )}
      </div>

      <div
        style={{
          padding: 10,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 6,
          background: 'var(--muted-bg)',
        }}
      >
        <Button
          size="sm"
          variant="accent"
          icon={<Plus size={12} />}
          style={{ flex: 1 }}
          onClick={() => navigate(`/assignee-rates?userId=${item.userId}`)}
        >
          Add rate
        </Button>
        <Button
          size="sm"
          variant="default"
          icon={<Clock size={12} />}
          onClick={() => navigate(`/time-entries?userId=${item.userId}&status=NO_RATE_FOUND`)}
        >
          Entries
        </Button>
        <Button
          size="sm"
          variant="default"
          icon={<DollarSign size={12} />}
          onClick={() => navigate(`/assignee-rates?userId=${item.userId}`)}
        >
          Rates
        </Button>
      </div>
    </div>
  );
}

function QueueView({ items, navigate }: { items: MissingRateItem[]; navigate: ReturnType<typeof useNavigate> }) {
  const sorted = useMemo(() => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...items].sort((a, b) => {
      const ka = getSeverity(a.missingCount).key;
      const kb = getSeverity(b.missingCount).key;
      if (order[ka] !== order[kb]) return order[ka] - order[kb];
      return b.missingCount - a.missingCount;
    });
  }, [items]);

  return (
    <Card padding={0}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sorted.map((issue, i) => {
          const sev = getSeverity(issue.missingCount);
          const est = estimatedMissingCostCents(issue);
          return (
            <div
              key={issue.userId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                borderBottom: i < sorted.length - 1 ? '1px solid var(--border-soft)' : undefined,
                transition: 'background 100ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <span
                style={{
                  width: 6,
                  alignSelf: 'stretch',
                  borderRadius: 3,
                  background: sev.borderCss,
                  flexShrink: 0,
                }}
              />
              <Avatar name={issue.userName} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{issue.userName}</span>
                  <Pill tone="amber" size="xs">
                    No active rate
                  </Pill>
                  <Pill tone={sev.tone} size="xs">
                    {sev.key}
                  </Pill>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {issue.userEmail} · {fmt.shortDate(issue.firstDate)} → {fmt.shortDate(issue.latestDate)}
                </div>
              </div>
              <div style={{ textAlign: 'right', minWidth: 110 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                  {issue.missingCount} entries
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt.hours(issue.affectedHours)} · ~{fmt.money(est)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => navigate(`/time-entries?userId=${issue.userId}&status=NO_RATE_FOUND`)}
                >
                  Entries
                </Button>
                <Button
                  size="sm"
                  variant="accent"
                  icon={<Plus size={12} />}
                  onClick={() => navigate(`/assignee-rates?userId=${issue.userId}`)}
                >
                  Add rate
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function MissingRatesPage() {
  const navigate = useNavigate();
  const missingRatesQuery = useMissingRates();
  const { data, isLoading } = missingRatesQuery;
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [view, setView] = useState('cards');

  const allItems: MissingRateItem[] = (data as MissingRateItem[] | undefined) ?? [];

  const filtered = useMemo(() => {
    return allItems.filter((item) => {
      if (severityFilter !== 'all') {
        const sev = getSeverity(item.missingCount).key;
        if (sev !== severityFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!item.userName.toLowerCase().includes(q) && !item.userEmail.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allItems, search, severityFilter]);

  const totalEntries = filtered.reduce((s, i) => s + i.missingCount, 0);
  const totalHours = filtered.reduce((s, i) => s + i.affectedHours, 0);
  const totalCostCents = filtered.reduce((s, i) => s + estimatedMissingCostCents(i), 0);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHeader title="Missing Rates" description="Operational queue for cost calculation problems." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </div>
        <Skeleton height={48} />
        <Skeleton height={240} />
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHeader title="Missing Rates" description="Operational queue for cost calculation problems." />
        <Card>
          <EmptyState
            icon={<CircleCheck size={20} />}
            title="All costs are calculated"
            body="No missing rate issues found. Time entries are being costed correctly."
          />
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Missing Rates"
        description="Operational queue for cost calculation problems. Resolve to enable accurate labor cost reporting."
        badge={<Pill tone="amber">{filtered.length} active</Pill>}
        actions={
          <Tabs value={view} onChange={setView} variant="segmented" items={TAB_ITEMS} />
        }
      />

      <QueryError query={missingRatesQuery} what="missing rates" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <MetricCard
          dense
          label="Affected assignees"
          value={fmt.number(filtered.length)}
          icon={<Users size={13} />}
        />
        <MetricCard dense label="Affected entries" value={fmt.number(totalEntries)} icon={<Clock size={13} />} />
        <MetricCard dense label="Affected hours" value={fmt.hours(totalHours)} icon={<Clock size={13} />} />
        <MetricCard
          dense
          label="Est. uncosted spend"
          value={fmt.money(totalCostCents)}
          sublabel="at $42/h placeholder"
          icon={<DollarSign size={13} />}
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 200, maxWidth: 300 }}>
          <Input
            icon={<Search size={14} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assignee…"
          />
        </div>
        <Select size="md" value={severityFilter} onChange={setSeverityFilter} options={SEVERITY_OPTIONS} />
        <span style={{ flex: 1 }} />
        <Button
          size="md"
          variant="ghost"
          icon={<Download size={13} />}
          disabled={filtered.length === 0}
          onClick={() => {
            const cols: CsvColumn<MissingRateItem>[] = [
              { header: 'User ID',         value: 'userId' },
              { header: 'User name',       value: 'userName' },
              { header: 'User email',      value: 'userEmail' },
              { header: 'Missing entries', value: 'missingCount' },
              { header: 'Affected hours',  value: 'affectedHours' },
              { header: 'First date',      value: 'firstDate' },
              { header: 'Latest date',     value: 'latestDate' },
              { header: 'Severity',        value: (r) => getSeverity(r.missingCount).key },
              { header: 'Est. uncosted cents', value: (r) => estimatedMissingCostCents(r) },
            ];
            downloadCsv(csvFilename('missing-rates'), toCsv(filtered, cols));
          }}
        >
          Export issues
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No issues match your filters"
            body="Try clearing search or changing severity."
            action={
              <Button size="sm" variant="default" onClick={() => { setSearch(''); setSeverityFilter('all'); }}>
                Reset filters
              </Button>
            }
          />
        </Card>
      ) : view === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
          {filtered.map((item) => (
            <MissingRateGroupCard key={item.userId} item={item} navigate={navigate} />
          ))}
        </div>
      ) : (
        <QueueView items={filtered} navigate={navigate} />
      )}
    </div>
  );
}
