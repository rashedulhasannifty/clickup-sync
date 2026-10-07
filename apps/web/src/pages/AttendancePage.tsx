import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, CalendarDays, RefreshCw, X } from 'lucide-react';
import type { LeaveRecordView, LeaveStatusValue, TodayRow } from '../api/people';
import { useDecideLeave, useLeaves, useSyncAttendance, useTodayAttendance } from '../hooks/usePeople';
import {
  formatClock,
  formatDate,
  formatDays,
  formatMinutes,
  formatShortDate,
  LEAVE_STATUS_LABEL,
} from '../lib/people';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { MetricCard } from '../components/ui/MetricCard';
import { Select } from '../components/ui/Select';
import { DataTable, type Column } from '../components/ui/DataTable';
import { useToast } from '../components/ui/Toast';
import { HeaderActions } from '../components/people/FormBits';
import { DemoDataBadge, LeaveStatusPill, LeaveTypePill, TodayStatePill } from '../components/people/PeoplePills';

const STATUS_FILTER = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: '', label: 'All statuses' },
];

const DOOR_COLUMNS: Column<TodayRow>[] = [
  {
    key: 'fullName',
    header: 'Employee',
    width: 220,
    render: (r) => (
      <Link to={`/people/${r.employeeId}`} style={{ color: 'var(--text)', fontWeight: 600, textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
        {r.fullName}
      </Link>
    ),
  },
  { key: 'teamName', header: 'Team', width: 150, render: (r) => r.teamName ?? '—' },
  { key: 'firstIn', header: 'First in', width: 90, render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatClock(r.firstIn)}</span> },
  { key: 'lastOut', header: 'Last out', width: 90, render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatClock(r.lastOut)}</span> },
  {
    key: 'minutesInOffice',
    header: 'In office',
    width: 100,
    render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMinutes(r.minutesInOffice)}</span>,
  },
  {
    key: 'state',
    header: 'Status',
    width: 140,
    render: (r) => (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <TodayStatePill state={r.state} />
        {r.inOffice && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>in office</span>}
      </span>
    ),
  },
];

/** A titled block above a table. The table brings its own border, so no Card around it. */
function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{title}</h2>
          {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0', maxWidth: 520 }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function dateRange(l: LeaveRecordView): string {
  return l.startDate === l.endDate
    ? formatDate(l.startDate)
    : `${formatShortDate(l.startDate)} – ${formatDate(l.endDate)}`;
}

export function AttendancePage() {
  const toast = useToast();
  const [status, setStatus] = useState<string>('PENDING');
  const today = useTodayAttendance();
  const leaves = useLeaves({ status: (status || undefined) as LeaveStatusValue | undefined });
  const decide = useDecideLeave();
  const sync = useSyncAttendance();

  const t = today.data;
  const counts = t?.counts;
  const pendingId = decide.isPending ? decide.variables?.id : undefined;

  const leaveColumns: Column<LeaveRecordView>[] = [
    {
      key: 'employeeName',
      header: 'Employee',
      width: 200,
      render: (r) => (
        <Link to={`/people/${r.employeeId}`} style={{ color: 'var(--text)', fontWeight: 600, textDecoration: 'none' }}>
          {r.employeeName}
        </Link>
      ),
    },
    { key: 'type', header: 'Type', width: 90, render: (r) => <LeaveTypePill type={r.type} /> },
    { key: 'startDate', header: 'Dates', width: 190, render: (r) => dateRange(r) },
    { key: 'days', header: 'Days', width: 80, align: 'right', render: (r) => formatDays(r.days) },
    {
      key: 'reason',
      header: 'Reason',
      width: 200,
      sortable: false,
      render: (r) => <span title={r.reason ?? undefined} style={{ color: r.reason ? 'var(--text)' : 'var(--text-faint)' }}>{r.reason ?? '—'}</span>,
    },
    { key: 'status', header: 'Status', width: 100, render: (r) => <LeaveStatusPill status={r.status} /> },
    {
      key: 'actions',
      header: '',
      width: 190,
      sortable: false,
      render: (r) =>
        r.status === 'PENDING' ? (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <Button
              size="sm"
              variant="accent"
              icon={<Check size={12} />}
              loading={pendingId === r.id && decide.variables?.status === 'APPROVED'}
              disabled={decide.isPending}
              onClick={(e) => {
                e.stopPropagation();
                decide.mutate(
                  { id: r.id, status: 'APPROVED' },
                  {
                    onSuccess: () => toast.success(`Approved ${r.employeeName}’s leave.`),
                    onError: (err) => toast.error(`Couldn’t approve. ${(err as Error).message}`),
                  },
                );
              }}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="default"
              icon={<X size={12} />}
              loading={pendingId === r.id && decide.variables?.status === 'REJECTED'}
              disabled={decide.isPending}
              onClick={(e) => {
                e.stopPropagation();
                if (!window.confirm(`Reject ${r.employeeName}’s ${dateRange(r)} leave request? This can’t be undone.`)) return;
                decide.mutate(
                  { id: r.id, status: 'REJECTED' },
                  {
                    onSuccess: () => toast.success(`Rejected ${r.employeeName}’s leave.`),
                    onError: (err) => toast.error(`Couldn’t reject. ${(err as Error).message}`),
                  },
                );
              }}
            >
              Reject
            </Button>
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{LEAVE_STATUS_LABEL[r.status]}</span>
        ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Attendance & leave"
        description={
          t
            ? `Today, ${formatDate(t.date)} (Dhaka time). Late means first entry after 09:30.`
            : 'Today’s door log and leave requests.'
        }
        badge={<DemoDataBadge source={t?.attendanceSource} />}
        actions={
          <HeaderActions>
            <Button
              size="md"
              variant="subtle"
              icon={<RefreshCw size={13} />}
              loading={sync.isPending}
              onClick={() =>
                sync.mutate(undefined, {
                  onSuccess: (r) =>
                    toast.success(`Attendance sync queued for the last ${r.lookbackDays} days. Data refreshes shortly.`),
                  onError: (e) => toast.error(`Couldn’t queue the sync. ${(e as Error).message}`),
                })
              }
            >
              Sync attendance
            </Button>
          </HeaderActions>
        }
      />

      <QueryError queries={[today, leaves]} what="attendance" />

      {t && !t.workingDay ? (
        <Callout tone="neutral" icon={<CalendarDays size={14} />}>
          Today is not a working day (the office runs Monday to Friday), so there is no door log. Leave requests are below.
        </Callout>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 12 }}>
          <MetricCard label="In office now" value={counts?.inOffice ?? '—'} sublabel={counts ? `of ${counts.total} expected` : undefined} loading={today.isLoading} />
          <MetricCard label="Late today" value={counts?.late ?? '—'} sublabel="after 09:30" loading={today.isLoading} />
          <MetricCard label="On leave today" value={counts?.onLeave ?? '—'} loading={today.isLoading} />
          <MetricCard label="Not in yet" value={counts?.notIn ?? '—'} sublabel="no entry, no leave" loading={today.isLoading} />
          <MetricCard label="Pending requests" value={counts?.pendingRequests ?? '—'} sublabel="awaiting approval" loading={today.isLoading} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          // Stacked at every width: side by side, each table scrolled sideways and
          // hid its last column — Approve/Reject on the leave table.
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 12,
          alignItems: 'start',
        }}
      >
        <Section title="Today · door log" subtitle={t ? formatDate(t.date) : undefined}>
          <DataTable<TodayRow>
            layout="design"
            rowKey="employeeId"
            columns={DOOR_COLUMNS}
            data={t?.rows ?? []}
            loading={today.isLoading}
            emptyTitle={t && !t.workingDay ? 'Day off' : 'No door entries yet'}
            emptyBody={
              t && !t.workingDay
                ? 'Nobody is expected in on a weekend.'
                : 'Entries appear as people badge in, or after an attendance sync.'
            }
            emptyIcon={<CalendarDays size={20} strokeWidth={1.5} />}
          />
        </Section>

        <Section
          title="Leave requests"
          subtitle="Approving removes those days from available hours, so utilisation isn’t penalised for leave."
          action={<Select ariaLabel="Filter leave by status" options={STATUS_FILTER} value={status} onChange={setStatus} menuAlign="right" />}
        >
          <DataTable<LeaveRecordView>
            layout="design"
            rowKey="id"
            columns={leaveColumns}
            data={leaves.data ?? []}
            loading={leaves.isLoading}
            emptyTitle={status === 'PENDING' ? 'No pending requests' : 'No leave records'}
            emptyBody={
              status === 'PENDING' ? 'Nothing is waiting for approval.' : 'No leave matches this filter.'
            }
            emptyIcon={<CalendarDays size={20} strokeWidth={1.5} />}
          />
        </Section>
      </div>
    </div>
  );
}
