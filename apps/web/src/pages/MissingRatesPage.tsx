import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMissingRates } from '../hooks/useReports';
import { fmt } from '../lib/formatters';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricCard } from '../components/ui/MetricCard';
import { Input } from '../components/ui/Input';
import { Tabs } from '../components/ui/Tabs';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Pill';
import type { Column } from '../components/ui/DataTable';
import { DataTable } from '../components/ui/DataTable';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';

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
  { key: 'grouped', label: 'Grouped' },
  { key: 'triage', label: 'Triage queue' },
];

export function MissingRatesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useMissingRates();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('grouped');

  const allItems: MissingRateItem[] = (data as MissingRateItem[] | undefined) ?? [];

  const filtered = search
    ? allItems.filter(
        (item) =>
          item.userName.toLowerCase().includes(search.toLowerCase()) ||
          item.userEmail.toLowerCase().includes(search.toLowerCase()),
      )
    : allItems;

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24 }}>
        <PageHeader title="Missing Rates" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24 }}>
        <PageHeader title="Missing Rates" />
        <EmptyState
          title="No missing rates"
          body="All time entries have matching assignee rates. Great work!"
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24 }}>
      <PageHeader title="Missing Rates" />

      {/* KPI Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
        }}
      >
        <MetricCard dense label="Affected Assignees" value={totalAssignees} />
        <MetricCard dense label="Affected Entries" value={totalEntries} />
        <MetricCard dense label="Affected Hours" value={fmt.hours(totalHours)} />
        <MetricCard
          dense
          label="Est. Uncosted Spend"
          value={fmt.money(estUncostedCents)}
          sub="est."
        />
      </div>

      {/* Search */}
      <div style={{ maxWidth: 320 }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by assignee name..."
        />
      </div>

      {/* Tabs */}
      <Tabs
        items={TAB_ITEMS}
        active={activeTab}
        onChange={setActiveTab}
        variant="segmented"
      />

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

                {/* Stats grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 2px' }}>
                      Entries
                    </p>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                      {item.missingCount}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 2px' }}>
                      Hours
                    </p>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                      {fmt.hours(item.affectedHours)}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 2px' }}>
                      First date
                    </p>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text)', margin: 0 }}>
                      {fmt.date(item.firstDate)}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 2px' }}>
                      Latest date
                    </p>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text)', margin: 0 }}>
                      {fmt.date(item.latestDate)}
                    </p>
                  </div>
                </div>

                {/* Footer buttons */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={() => navigate(`/assignee-rates?userId=${item.userId}`)}
                  >
                    Add Rate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigate(`/time-entries?userId=${item.userId}&status=NO_RATE_FOUND`)
                    }
                  >
                    View Entries
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
