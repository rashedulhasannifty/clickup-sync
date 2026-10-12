import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { EXIT_TYPE_LABEL, type ExitListFilter, type ExitListRow } from '../api/exits';
import { useExits } from '../hooks/useExits';
import { dhakaToday, formatDate } from '../lib/people';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { Select } from '../components/ui/Select';
import { ExitStatusPill } from '../components/people/ExitStatusPill';
import { Avatar } from '../components/ui/Avatar';
import { DataTable, type Column } from '../components/ui/DataTable';

const FILTERS: { value: ExitListFilter | 'all'; label: string }[] = [
  { value: 'active', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

/** "12 days left", "last day today" or "ended"; only meaningful while the exit is in progress. */
function lastDayHint(row: ExitListRow): string | null {
  if (row.status === 'COMPLETED' || row.status === 'CANCELLED') return null;
  const days = Math.round(
    (Date.parse(`${row.lastWorkingDay}T00:00:00Z`) - Date.parse(`${dhakaToday()}T00:00:00Z`)) / 86_400_000,
  );
  if (days > 1) return `${days} days left`;
  if (days === 1) return '1 day left';
  if (days === 0) return 'last day today';
  return 'past last day';
}

const COLUMNS: Column<ExitListRow>[] = [
  {
    key: 'employeeName',
    header: 'Employee',
    width: 250,
    render: (r) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0, maxWidth: '100%' }}>
        <Avatar name={r.employeeName} size="md" />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.employeeName}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {r.designation}
            {r.teamName ? ` · ${r.teamName}` : ''}
          </span>
        </span>
      </span>
    ),
  },
  { key: 'type', header: 'Type', width: 130, render: (r) => EXIT_TYPE_LABEL[r.type] },
  { key: 'status', header: 'Status', width: 140, render: (r) => <ExitStatusPill status={r.status} /> },
  { key: 'noticeDate', header: 'Notice given', width: 130, render: (r) => formatDate(r.noticeDate) },
  {
    key: 'lastWorkingDay',
    header: 'Last working day',
    width: 190,
    render: (r) => {
      const hint = lastDayHint(r);
      return (
        <span>
          {formatDate(r.lastWorkingDay)}
          {hint && <small style={{ color: 'var(--text-muted)' }}> · {hint}</small>}
        </span>
      );
    },
  },
  {
    key: 'clearance',
    header: 'Clearance',
    width: 110,
    sortable: false,
    render: (r) => (
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {r.clearanceResolved} / {r.clearanceTotal}
      </span>
    ),
  },
];

/** Offboardings in progress and recent exits. A row opens that employee's offboarding page. */
export function ExitsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ExitListFilter | 'all'>('active');
  const exits = useExits(filter === 'all' ? undefined : filter);
  const rows = exits.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Exits"
        description={
          exits.data
            ? `${rows.length} ${rows.length === 1 ? 'offboarding' : 'offboardings'} · ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()}`
            : 'Offboardings in progress and recent exits.'
        }
      />
      <QueryError query={exits} what="exits" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <Select
          ariaLabel="Filter exits"
          options={FILTERS}
          value={filter}
          onChange={(v) => setFilter(v as ExitListFilter | 'all')}
        />
      </div>
      <DataTable<ExitListRow>
        layout="design"
        stickyFirstColumn
        rowKey="id"
        columns={COLUMNS}
        data={rows}
        loading={exits.isLoading}
        onRowClick={(r) => navigate(`/people/${r.employeeId}/exit`)}
        emptyIcon={<LogOut size={20} strokeWidth={1.5} />}
        emptyTitle={filter === 'active' ? 'No offboardings in progress' : 'No exits to show'}
        emptyBody="Start one from an employee's page with “Start offboarding”."
      />
    </div>
  );
}
