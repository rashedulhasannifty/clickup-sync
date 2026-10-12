import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Plus, RefreshCw, Search, UserPlus, Users } from 'lucide-react';
import type { DirectoryRow, EmployeeStatusValue } from '../api/people';
import {
  useCreateEmployee,
  useEmployees,
  useImportFromUsers,
  useSyncAttendance,
  useTodayAttendance,
} from '../hooks/usePeople';
import { useTeams } from '../hooks/useTeams';
import { formatDate, formatTenure } from '../lib/people';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Pill';
import { DataTable, type Column } from '../components/ui/DataTable';
import { useToast } from '../components/ui/Toast';
import { EmployeeFormModal } from '../components/people/EmployeeFormModal';
import { HeaderActions } from '../components/people/FormBits';
import {
  DemoDataBadge,
  EmployeeStatusPill,
  LinkedIndicators,
  ScoreBandPill,
  TodayStatePill,
} from '../components/people/PeoplePills';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'INTERN', label: 'Intern' },
  { value: 'PROBATION', label: 'Probation' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'NOTICE', label: 'Notice period' },
  { value: 'EXITED', label: 'Exited' },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const COLUMNS: Column<DirectoryRow>[] = [
  {
    key: 'fullName',
    header: 'Employee',
    width: 250,
    render: (r) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0, maxWidth: '100%' }}>
        <Avatar name={r.fullName} size="md" />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.fullName}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</span>
        </span>
      </span>
    ),
  },
  { key: 'designation', header: 'Designation', width: 170, render: (r) => r.designation },
  {
    key: 'teamName',
    header: 'Team',
    width: 150,
    render: (r) => r.teamName ?? <span style={{ color: 'var(--text-faint)' }}>—</span>,
  },
  {
    key: 'joinDate',
    header: 'Joined',
    width: 170,
    render: (r) => (
      <span>
        {formatDate(r.joinDate)}{' '}
        <small style={{ color: 'var(--text-muted)' }}>· {formatTenure(r.tenureMonths)}</small>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: 170,
    render: (r) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <EmployeeStatusPill status={r.status} />
        {/* Only while incomplete, and not for leavers (their checklist is read-only). */}
        {r.status !== 'EXITED' && r.onboarding && r.onboarding.resolved < r.onboarding.total && (
          <span title="Joining checklist: items done or not applicable, of the total">
            <Pill tone="amber" size="xs">
              Onboarding {r.onboarding.resolved}/{r.onboarding.total}
            </Pill>
          </span>
        )}
      </span>
    ),
  },
  { key: 'today', header: 'Today', width: 100, sortable: false, render: (r) => <TodayStatePill state={r.today} /> },
  { key: 'score', header: 'Score (90d)', width: 150, render: (r) => <ScoreBandPill score={r.score} band={r.band} partial={r.partial} /> },
  { key: 'linked', header: 'Linked', width: 170, sortable: false, render: (r) => <LinkedIndicators linked={r.linked} /> },
];

export function EmployeesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [teamId, setTeamId] = useState('');
  const [adding, setAdding] = useState(false);
  const q = useDebounced(search.trim(), 250);

  const employees = useEmployees({
    search: q || undefined,
    status: (status || undefined) as EmployeeStatusValue | undefined,
    teamId: teamId || undefined,
  });
  const teams = useTeams();
  const today = useTodayAttendance();
  const create = useCreateEmployee();
  const importUsers = useImportFromUsers();
  const sync = useSyncAttendance();

  const rows = employees.data ?? [];
  const teamOptions = useMemo(
    () => (teams.data ?? []).map((t) => ({ value: t.id, label: t.name })),
    [teams.data],
  );
  // Candidate managers come from the unfiltered directory; the filtered list
  // would hide people the search happens not to match.
  const allEmployees = useEmployees({});
  const managerOptions = useMemo(
    () =>
      (allEmployees.data ?? [])
        .filter((e) => e.status !== 'EXITED')
        .map((e) => ({ value: e.id, label: `${e.fullName} · ${e.designation}` })),
    [allEmployees.data],
  );

  const onLeave = rows.filter((r) => r.today === 'leave').length;
  const inNotice = rows.filter((r) => r.status === 'NOTICE').length;
  const permanent = rows.filter((r) => r.status === 'ACTIVE').length;
  const probation = rows.filter((r) => r.status === 'PROBATION').length;
  const interns = rows.filter((r) => r.status === 'INTERN').length;
  // "Active" is the status word for permanent staff, so the breakdown names each stage.
  const description = employees.data
    ? [
        `${rows.length} ${rows.length === 1 ? 'employee' : 'employees'}`,
        `${permanent} permanent`,
        probation ? `${probation} on probation` : null,
        interns ? `${interns} ${interns === 1 ? 'intern' : 'interns'}` : null,
        `${onLeave} on leave today`,
        `${inNotice} in notice period`,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Employee records, today’s attendance and 90-day scores.';

  const filtered = !!(q || status || teamId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Employees"
        description={description}
        badge={<DemoDataBadge source={today.data?.attendanceSource} />}
        actions={
          <HeaderActions>
            {today.data?.canSync && (
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
            )}
            <Button
              size="md"
              variant="subtle"
              icon={<UserPlus size={13} />}
              loading={importUsers.isPending}
              onClick={() =>
                importUsers.mutate(undefined, {
                  onSuccess: (r) =>
                    toast.success(
                      r.created === 0 && r.linked === 0
                        ? 'Nothing to import: every active user already has an employee record.'
                        : `Imported ${r.created} new ${r.created === 1 ? 'employee' : 'employees'}; linked ${r.linked} existing to a login.`,
                    ),
                  onError: (e) => toast.error(`Import failed. ${(e as Error).message}`),
                })
              }
            >
              Import from users
            </Button>
            <Button size="md" variant="subtle" icon={<History size={13} />} onClick={() => navigate('/people/past-records')}>
              Import past records
            </Button>
            <Button size="md" variant="accent" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
              Add employee
            </Button>
          </HeaderActions>
        }
      />

      <QueryError query={employees} what="employees" />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <Input
            icon={<Search size={14} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, code or designation"
            aria-label="Search employees"
          />
        </div>
        <Select ariaLabel="Filter by status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        <Select
          ariaLabel="Filter by team"
          options={[{ value: '', label: 'All teams' }, ...teamOptions]}
          value={teamId}
          onChange={setTeamId}
        />
      </div>

      <DataTable<DirectoryRow>
        layout="design"
        stickyFirstColumn
        rowKey="id"
        columns={COLUMNS}
        data={rows}
        loading={employees.isLoading}
        onRowClick={(r) => navigate(`/people/${r.id}`)}
        emptyIcon={<Users size={20} strokeWidth={1.5} />}
        emptyTitle={filtered ? 'No employees match' : 'No employees yet'}
        emptyBody={
          filtered
            ? 'Try a different search or clear the filters.'
            : 'Add an employee, or import one for each user who has no record yet.'
        }
        emptyAction={
          filtered ? undefined : (
            <Button variant="accent" icon={<Plus size={12} />} onClick={() => setAdding(true)}>
              Add employee
            </Button>
          )
        }
      />

      {adding && (
        <EmployeeFormModal
          teams={teamOptions}
          managers={managerOptions}
          pending={create.isPending}
          error={create.isError ? (create.error as Error).message : null}
          onClose={() => {
            setAdding(false);
            create.reset();
          }}
          onCreate={(body) =>
            create.mutate(body, {
              onSuccess: (e) => {
                setAdding(false);
                toast.success(`${e.fullName} added.`);
                navigate(`/people/${e.id}`);
              },
            })
          }
        />
      )}
    </div>
  );
}
