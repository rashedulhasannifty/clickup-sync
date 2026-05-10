import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useMissingRates } from '../hooks/useReports';
import { fmt } from '../lib/formatters';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricCard } from '../components/ui/MetricCard';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Tabs } from '../components/ui/Tabs';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Pill';
import type { Column } from '../components/ui/DataTable';
import { DataTable } from '../components/ui/DataTable';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';

const SEVERITY_OPTIONS = [
  { value: '', label: 'All severities' },
  { value: 'high', label: 'High only' },
  { value: 'medium', label: 'Medium only' },
  { value: 'low', label: 'Low only' },
];

interface MissingRateItem {
  [key: string]: unknown;
  userId: string;
  userName: string;
  userEmail: string;
  missingCount: number;
  affectedHours: number;
  firstDate: string;
  latestDate: string;
}

type Severity = 'High' | 'Medium' | 'Low';

function getSeverity(count: number): { label: Severity; tone: 'red' | 'amber' | 'gray'; borderColor: string } {
  if (count > 10) return { label: 'High', tone: 'red', borderColor: '#dc2626' };
  if (count >= 3) return { label: 'Medium', tone: 'amber', borderColor: '#d97706' };
  return { label: 'Low', tone: 'gray', borderColor: 'var(--border)' };
}

const ASSUMED_RATE_CENTS = 8000; // $80/h in cents
const TAB_ITEMS = [
  { value: 'grouped', label: 'Grouped' },
  { value: 'triage', label: 'Triage queue' },
];

export function MissingRatesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useMissingRates();
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [activeTab, setActiveTab] = useState('grouped');

  const allItems: MissingRateItem[] = (data as MissingRateItem[] | undefined) ?? [];

  const filtered = allItems.filter((item) => {
    if (search && !item.userName.toLowerCase().includes(search.toLowerCase()) && !item.userEmail.toLowerCase().includes(search.toLowerCase())) return false;
    if (severity) {
      const sev = getSeverity(item.missingCount).label.toLowerCase();
      if (sev !== severity) return false;
    }
    return true;
  });

  // KPIs computed from all items (not filtered)
  const totalAssignees = allItems.length;
  const totalEntries = allItems.reduce((s, r) => s + r.missingCount, 0);
  const totalHours = allItems.reduce((s, r) => s + r.affectedHours, 0);
  const estUncostedCents = totalHours * ASSUMED_RATE_CENTS;

  const triageColumns: Column<MissingRateItem>[] = [
    {
      key: 'userName',
      header: 'Assignee',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Avatar name={row.userName} size="sm" />
          <span>
            <span style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem' }}>
              {row.userName}
            </span>
            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {row.userEmail}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'missingCount',
      header: 'Entries',
      render: (row) => <strong>{row.missingCount}</strong>,
      sortable: true,
    },
    {
      key: 'affectedHours',
      header: 'Hours',
      render: (row) => <>{fmt.hours(row.affectedHours)}</>,
      sortable: true,
    },
    {
      key: 'firstDate',
      header: 'First date',
      render: (row) => <>{fmt.date(row.firstDate)}</>,
    },
    {
      key: 'latestDate',
      header: 'Latest date',
      render: (row) => <>{fmt.date(row.latestDate)}</>,
    },
    {
      key: 'severity',
      header: 'Severity',
      render: (row) => {
        const sev = getSeverity(row.missingCount);
        return <Pill tone={sev.tone}>{sev.label}</Pill>;
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <Button
          variant="accent"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/assignee-rates?userId=${row.userId}`);
          }}
        >
          Add Rate
        </Button>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHeader title="Missing Rates" description="Operational queue for cost calculation problems." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
        <Skeleton height={40} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHeader title="Missing Rates" description="Operational queue for cost calculation problems." />
        <EmptyState
          title="No missing rates"
          body="All time entries have matching assignee rates. Great work!"
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Missing Rates
            {totalAssignees > 0 && <Pill tone="amber">{totalAssignees} active</Pill>}
          </span>
        }
        description="Operational queue for cost calculation problems. Resolve to enable accurate labor cost reporting."
        actions={
          <>
            <Tabs items={TAB_ITEMS} value={activeTab} onChange={setActiveTab} variant="plain" />
          </>
        }
      />

      {/* KPI Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <MetricCard dense label="Affected assignees" value={totalAssignees} />
        <MetricCard dense label="Affected entries" value={totalEntries} />
        <MetricCard dense label="Affected hours" value={fmt.hours(totalHours)} />
        <MetricCard
          dense
          label="Est. uncosted spend"
          value={fmt.money(estUncostedCents)}
        />
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search assignee…"
          style={{ width: 220 }}
        />
        <Select options={SEVERITY_OPTIONS} value={severity} onChange={setSeverity} />
        <div style={{ flex: 1 }} />
        <Button variant="default" size="md" icon={<Download size={13} />}>Export issues</Button>
      </div>

      {/* Grouped view */}
      {activeTab === 'grouped' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 16,
          }}
        >
          {filtered.map((item) => {
            const sev = getSeverity(item.missingCount);
            return (
              <div
                key={item.userId}
                style={{
                  background: 'var(--surface)',
                  border: `1px solid var(--border)`,
                  borderLeft: `4px solid ${sev.borderColor}`,
                  borderRadius: 'var(--radius-lg)',
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={item.userName} size="md" />
                    <div>
                      <p
                        style={{
                          fontWeight: 600,
                          color: 'var(--text)',
                          margin: 0,
                          fontSize: '0.875rem',
                        }}
                      >
                        {item.userName}
                      </p>
                      <p
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          margin: 0,
                        }}
                      >
                        {item.userEmail}
                      </p>
                    </div>
                  </div>
                  <Pill tone={sev.tone}>{sev.label}</Pill>
                </div>

                {/* Warning message */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: sev.tone === 'red' ? 'var(--pill-amber-bg)' : 'var(--pill-amber-bg)', borderRadius: 6 }}>
                  <span style={{ fontSize: 12 }}>⚠️</span>
                  <span style={{ fontSize: 11, color: 'var(--pill-amber-text)', fontWeight: 500 }}>No active rate</span>
                </div>

                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ padding: '8px 12px', background: 'var(--muted-bg)', borderRadius: 8 }}>
                    <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: 'var(--text-muted)', margin: '0 0 3px' }}>Entries</p>
                    <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{item.missingCount}</p>
                  </div>
                  <div style={{ padding: '8px 12px', background: 'var(--muted-bg)', borderRadius: 8 }}>
                    <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: 'var(--text-muted)', margin: '0 0 3px' }}>Hours</p>
                    <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{fmt.hours(item.affectedHours)}</p>
                  </div>
                </div>

                {/* Date range */}
                <div>
                  <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: 'var(--text-muted)', margin: '0 0 4px' }}>Date Range</p>
                  <p style={{ fontSize: 13, color: 'var(--text)', margin: 0 }}>
                    {fmt.date(item.firstDate)}
                    <span style={{ margin: '0 6px', color: 'var(--text-faint)' }}>→</span>
                    {fmt.date(item.latestDate)}
                  </p>
                </div>

                {/* Footer buttons */}
                <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={() => navigate(`/assignee-rates?userId=${item.userId}`)}
                    style={{ flex: 1 }}
                  >
                    + Add rate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/time-entries?userId=${item.userId}&status=NO_RATE_FOUND`)}
                  >
                    Entries
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/assignee-rates?userId=${item.userId}`)}
                  >
                    Rates
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Triage queue view */}
      {activeTab === 'triage' && (
        <DataTable<MissingRateItem>
          columns={triageColumns}
          data={filtered}
          emptyTitle="No missing rates match your filter"
          pageSize={50}
        />
      )}
    </div>
  );
}
