import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, History, Pencil, UserX } from 'lucide-react';
import type { EmployeeSummary, ScoredKpi } from '../api/people';
import {
  useAddEmploymentEvent,
  useEmployees,
  useEmployeeSummary,
  useUpdateEmployee,
} from '../hooks/usePeople';
import { useTeams } from '../hooks/useTeams';
import { usePastRecordMutations } from '../hooks/usePastRecords';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  BAND_LABEL,
  bandColor,
  formatDate,
  formatMonth,
  formatShortDate,
  formatTenure,
  lifecycleText,
} from '../lib/people';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { PageSkeleton } from '../components/ui/PageSkeleton';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Pill } from '../components/ui/Pill';
import { Avatar } from '../components/ui/Avatar';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';
import { LineChart } from '../components/charts/LineChart';
import { AddEventModal } from '../components/people/AddEventModal';
import { AttendanceStrip } from '../components/people/AttendanceStrip';
import { CareerTimeline } from '../components/people/CareerTimeline';
import { EmployeeDocumentsTab } from '../components/people/EmployeeDocumentsTab';
import { EmployeeAppraisalsTab } from '../components/people/EmployeeAppraisalsTab';
import { EmployeeOnboardingTab } from '../components/people/EmployeeOnboardingTab';
import { StartOffboardingButton } from '../components/people/StartOffboardingButton';
import { EmployeeFormModal } from '../components/people/EmployeeFormModal';
import { PastRecordModal, type PastRecordTarget } from '../components/people/PastRecordModal';
import { Modal } from '../components/ui/Modal';
import { APPRAISAL_TYPE_PHRASE, monthsText, takaText } from '../lib/appraisals';
import { HeaderActions } from '../components/people/FormBits';
import { KpiTile } from '../components/people/KpiTile';
import { LeaveBalanceCard } from '../components/people/LeaveBalanceCard';
import { DemoDataBadge, EmployeeStatusPill, LinkedIndicators } from '../components/people/PeoplePills';

type TabValue = 'overview' | 'onboarding' | 'documents' | 'appraisals';
const TABS: TabValue[] = ['overview', 'onboarding', 'documents', 'appraisals'];

function Chip({ children, title, tone }: { children: ReactNode; title?: string; tone?: 'amber' }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 12,
        color: tone === 'amber' ? 'var(--amber)' : 'var(--text-muted)',
        background: 'var(--muted-bg)',
        borderRadius: 6,
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

const KPI_NAME: Record<ScoredKpi, string> = {
  utilisation: 'utilisation',
  chargeable: 'chargeable',
  onTimeDelivery: 'on-time delivery',
  punctuality: 'punctuality',
};

/** The big overall number in the header, coloured by its band — or marked Partial. */
function OverallScore({ summary }: { summary: EmployeeSummary }) {
  const { score, band, partial, basedOn } = summary.overall;
  return (
    <div style={{ textAlign: 'right', minWidth: 130 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Overall score · 90 days
      </div>
      {score == null ? (
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-muted)', marginTop: 4 }}>No data</div>
      ) : (
        <>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {score}
            <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>/100</span>
          </div>
          {partial ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 220, marginLeft: 'auto' }}>
              <span style={{ fontWeight: 600 }}>Partial</span> — based on {basedOn.map((k) => KPI_NAME[k]).join(', ')} only.
              Link ClickUp to include work KPIs.
            </div>
          ) : (
            <div style={{ fontSize: 12, fontWeight: 600, color: bandColor(band) }}>{BAND_LABEL[band]}</div>
          )}
        </>
      )}
    </div>
  );
}

function TrendCard({ summary }: { summary: EmployeeSummary }) {
  const points = summary.trend.filter((t) => t.overall != null);
  const data = points.map((t) => ({ label: formatMonth(t.month), key: t.month, value: t.overall as number }));
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>Overall score by month</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Last 6 months · 0–100, equal-weighted across the KPIs that have data</div>
      {data.length < 2 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0' }}>
          Not enough history to draw a trend yet. It needs at least two months with KPI data.
        </div>
      ) : (
        <LineChart
          data={data}
          height={150}
          formatMax={(v) => String(Math.round(v))}
          renderTooltip={(d) => {
            const t = summary.trend.find((x) => x.month === d.key);
            return (
              <>
                <div style={{ fontWeight: 600 }}>{d.label}</div>
                <div style={{ color: 'var(--text-muted)' }}>Overall {d.value}</div>
                {t && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                    {[
                      t.utilisation != null ? `Util ${t.utilisation}%` : null,
                      t.chargeable != null ? `Charge ${t.chargeable}%` : null,
                      t.onTimeDelivery != null ? `On-time ${t.onTimeDelivery}%` : null,
                      t.punctuality != null ? `Punct ${t.punctuality}%` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
              </>
            );
          }}
        />
      )}
      {data.length < summary.trend.length && data.length >= 2 && (
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
          Months with no KPI data are skipped.
        </div>
      )}
    </div>
  );
}

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const narrow = useMediaQuery('(max-width: 900px)');
  const requestedTab = params.get('tab') as TabValue | null;
  const tab: TabValue = requestedTab && TABS.includes(requestedTab) ? requestedTab : 'overview';
  const [editing, setEditing] = useState(false);
  const [addingEvent, setAddingEvent] = useState(false);
  // undefined: closed; null: adding a new past record; else the record being edited.
  const [pastTarget, setPastTarget] = useState<PastRecordTarget | undefined>(undefined);
  const [deletingPast, setDeletingPast] = useState<{ recordId: string; label: string } | null>(null);

  const summaryQuery = useEmployeeSummary(id);
  const teams = useTeams();
  const directory = useEmployees({});
  const update = useUpdateEmployee(id ?? '');
  const addEvent = useAddEmploymentEvent(id ?? '');
  const past = usePastRecordMutations(id ?? '');

  const teamOptions = useMemo(
    () => (teams.data ?? []).map((t) => ({ value: t.id, label: t.name })),
    [teams.data],
  );
  const managerOptions = useMemo(
    () =>
      (directory.data ?? [])
        .filter((e) => e.status !== 'EXITED')
        .map((e) => ({ value: e.id, label: `${e.fullName} · ${e.designation}` })),
    [directory.data],
  );

  const backLink = (
    <Link to="/people" style={{ color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <ArrowLeft size={13} /> Employees
    </Link>
  );

  if (summaryQuery.isLoading) return <PageSkeleton />;

  if (summaryQuery.isError || !summaryQuery.data) {
    const status = (summaryQuery.error as { response?: { status?: number } } | null)?.response?.status;
    if (status === 404) {
      return (
        <div>
          <PageHeader title="Employee not found" breadcrumb={backLink} />
          <Card>
            <EmptyState
              icon={<UserX size={20} strokeWidth={1.5} />}
              title="No such employee"
              body="This record may have been removed, or the link is wrong."
              action={
                <Link to="/people">
                  <Button variant="accent">Back to employees</Button>
                </Link>
              }
            />
          </Card>
        </div>
      );
    }
    return (
      <div>
        <PageHeader title="Employee" breadcrumb={backLink} />
        <QueryError query={summaryQuery} what="this employee" />
      </div>
    );
  }

  const summary = summaryQuery.data;
  const e = summary.employee;
  // A former employee's record is read-only: the API refuses every write, so don't offer them.
  const readOnly = e.status === 'EXITED';
  const lifecycle = lifecycleText(e);
  const sub = [e.designation, e.teamName, e.managerName ? `reports to ${e.managerName}` : null].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        breadcrumb={backLink}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <Avatar name={e.fullName} size={44} />
            <span style={{ overflowWrap: 'anywhere' }}>{e.fullName}</span>
          </span>
        }
        badge={
          <>
            <EmployeeStatusPill status={e.status} />
            <DemoDataBadge source={summary.attendanceSource} />
          </>
        }
        description={sub}
        actions={
          <HeaderActions>
            <StartOffboardingButton employeeId={e.id} status={e.status} />
            {!readOnly && (
              <>
                <Button size="md" variant="subtle" icon={<Pencil size={13} />} onClick={() => setEditing(true)}>
                  Edit profile
                </Button>
                <Button size="md" variant="accent" icon={<CalendarPlus size={13} />} onClick={() => setAddingEvent(true)}>
                  Add event
                </Button>
              </>
            )}
          </HeaderActions>
        }
      />

      {readOnly && (
        <Callout tone="neutral" icon={<UserX size={15} />}>
          <strong>Former employee — read-only.</strong>{' '}
          {e.exitDate ? `Exited ${formatDate(e.exitDate)}. ` : ''}
          The profile, timeline, onboarding checklist and documents can be viewed but not changed.
        </Callout>
      )}

      {/* Identity strip + overall score */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
            <Chip>
              Joined {formatDate(e.joinDate)} · {formatTenure(e.tenureMonths)}
            </Chip>
            {lifecycle && <Chip>{lifecycle}</Chip>}
            {e.nextAppraisal && (
              <Chip
                tone={e.nextAppraisal.overdue ? 'amber' : undefined}
                title={`Reviews ${formatDate(e.nextAppraisal.periodStart)} – ${formatDate(e.nextAppraisal.periodEnd)}, ${e.nextAppraisal.type === 'INTERNSHIP' ? 'due at the end of the internship' : 'counted from the probation start'}`}
              >
                Next appraisal: {APPRAISAL_TYPE_PHRASE[e.nextAppraisal.type]} {e.nextAppraisal.overdue ? 'overdue since' : 'due'} {formatDate(e.nextAppraisal.dueDate)}
              </Chip>
            )}
            {e.exitDate && <Chip>Exit {formatDate(e.exitDate)}</Chip>}
            {e.confirmationDate && e.status !== 'ACTIVE' && <Chip>Confirmed {formatDate(e.confirmationDate)}</Chip>}
            {e.grade && <Chip>Grade {e.grade}</Chip>}
            {e.department && <Chip>{e.department}</Chip>}
            {e.employeeCode && <Chip>#{e.employeeCode}</Chip>}
            <Chip>{e.email}</Chip>
            <LinkedIndicators linked={e.linked} />
          </div>
          <OverallScore summary={summary} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 10 }}>
          KPI period {formatShortDate(summary.period.from)} – {formatDate(summary.period.to)} (Dhaka time). Tiles show each KPI against its target.
        </div>
      </Card>

      <Tabs
        variant="underline"
        ariaLabel="Employee sections"
        value={tab}
        onChange={(v) => {
          const next = new URLSearchParams(params);
          if (v === 'overview') next.delete('tab');
          else next.set('tab', v);
          setParams(next, { replace: true });
        }}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'onboarding', label: 'Onboarding' },
          { value: 'documents', label: 'Documents' },
          { value: 'appraisals', label: 'Appraisals' },
        ]}
      />

      {tab === 'onboarding' ? (
        <EmployeeOnboardingTab employeeId={e.id} readOnly={readOnly} />
      ) : tab === 'documents' ? (
        <EmployeeDocumentsTab employeeId={e.id} readOnly={readOnly} />
      ) : tab === 'appraisals' ? (
        <EmployeeAppraisalsTab
          employeeId={e.id}
          onEditPast={readOnly ? undefined : (a) => setPastTarget({ kind: 'appraisal', appraisal: a })}
          onDeletePast={readOnly ? undefined : (a) => setDeletingPast({ recordId: a.id, label: `the ${formatDate(a.conductedOn)} paper appraisal` })}
        />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 12 }}>
            <KpiTile
              label="Utilisation"
              source="ClickUp"
              kpi={summary.kpis.utilisation}
              unit="hours"
              detail={(n, d) => `${n} logged of ${d} available`}
            />
            <KpiTile
              label="Chargeable"
              source="ClickUp"
              kpi={summary.kpis.chargeable}
              unit="hours"
              detail={(n, d) => `${n} chargeable of ${d} tracked`}
            />
            <KpiTile
              label="On-time delivery"
              source="ClickUp"
              kpi={summary.kpis.onTimeDelivery}
              unit="tasks"
              detail={(n, d) => `${n} of ${d} tasks closed by their due date`}
            />
            <KpiTile
              label="Punctuality"
              source="Office"
              kpi={summary.kpis.punctuality}
              unit="days"
              detail={(n, d) => `${n} of ${d} office days on time`}
            />
            <LeaveBalanceCard balance={summary.leaveBalance} />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(0, 1.6fr) minmax(0, 1fr)',
              gap: 12,
              alignItems: 'start',
            }}
          >
            <Card>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <TrendCard summary={summary} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                    Attendance · last {summary.attendance.length || 30} working days
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                    Hover a day for the in and out times, sessions and notes.{' '}
                    {e.shiftName ? `Shift: ${e.shiftName}; late means first entry after its start plus grace.` : 'Late means first entry after 09:30.'}
                    {e.attendanceId ? ` Stellar ID ${e.attendanceId}.` : ' No Stellar ID set, so door-system imports skip this person.'}
                  </div>
                  <AttendanceStrip days={summary.attendance} />
                </div>
              </div>
            </Card>

            <Card
              title="Career timeline"
              action={
                readOnly ? undefined : (
                  <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="ghost" icon={<History size={12} />} onClick={() => setPastTarget(null)}>
                      Add past record
                    </Button>
                    <Button size="sm" variant="ghost" icon={<CalendarPlus size={12} />} onClick={() => setAddingEvent(true)}>
                      Add event
                    </Button>
                  </span>
                )
              }
            >
              <CareerTimeline
                events={summary.events}
                onEdit={readOnly ? undefined : (ev) => setPastTarget({ kind: 'event', event: ev })}
                onDelete={readOnly ? undefined : (ev) => setDeletingPast({ recordId: `event:${ev.id}`, label: `this ${formatDate(ev.effectiveDate)} record` })}
              />
            </Card>
          </div>

          <Card
            title="Appraisal form details"
            subtitle="Shown in the header of the appraisal form. Salaries are visible to Owners and Admins only."
            action={
              readOnly ? undefined : (
                <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )
            }
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '10px 18px' }}>
              {(
                [
                  [
                    'Probation start',
                    e.status === 'INTERN' ? `Not yet (intern until ${formatDate(e.internshipEndDate)})` : formatDate(e.probationStartDate ?? e.joinDate),
                  ],
                  ['Concern name', e.concernName ?? '—'],
                  ['Academic qualification', e.academicQualification ?? '—'],
                  ['Experience before joining', monthsText(e.experienceBeforeJoiningMonths)],
                  [
                    'Total experience',
                    e.experienceBeforeJoiningMonths == null ? '—' : monthsText(e.experienceBeforeJoiningMonths + e.tenureMonths),
                  ],
                  ['Starting salary', takaText(e.startingSalary)],
                  ['Present gross salary', takaText(e.grossSalary)],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{k}</div>
                  <div style={{ fontSize: 13.5, overflowWrap: 'anywhere' }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>

          {summary.attendanceSource === 'none' && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <Pill tone="gray" size="xs">
                No attendance source
              </Pill>{' '}
              Punctuality and the attendance strip stay empty until an attendance provider is configured.
            </div>
          )}
        </>
      )}

      {editing && !readOnly && (
        <EmployeeFormModal
          employee={e}
          teams={teamOptions}
          managers={managerOptions}
          pending={update.isPending}
          error={update.isError ? (update.error as Error).message : null}
          onClose={() => {
            setEditing(false);
            update.reset();
          }}
          onUpdate={(body) =>
            update.mutate(body, {
              onSuccess: () => {
                setEditing(false);
                toast.success('Profile updated.');
              },
            })
          }
        />
      )}
      {pastTarget !== undefined && !readOnly && (
        <PastRecordModal
          employee={e}
          teams={teamOptions}
          target={pastTarget}
          pending={past.add.isPending || past.update.isPending}
          error={
            past.add.isError ? (past.add.error as Error).message : past.update.isError ? (past.update.error as Error).message : null
          }
          onClose={() => {
            setPastTarget(undefined);
            past.add.reset();
            past.update.reset();
          }}
          onSubmit={(body) => {
            const done = {
              onSuccess: () => {
                setPastTarget(undefined);
                toast.success(pastTarget ? 'Past record updated.' : 'Past record added. The profile follows the whole history.');
              },
            };
            if (pastTarget === null) past.add.mutate(body, done);
            else
              past.update.mutate(
                { recordId: pastTarget.kind === 'event' ? `event:${pastTarget.event.id}` : pastTarget.appraisal.id, body },
                done,
              );
          }}
        />
      )}
      {deletingPast && !readOnly && (
        <Modal
          onClose={() => {
            setDeletingPast(null);
            past.remove.reset();
          }}
          title="Delete this past record?"
          width={440}
          footer={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              {past.remove.isError && (
                <span role="alert" style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }}>
                  {(past.remove.error as Error).message}
                </span>
              )}
              <Button variant="ghost" onClick={() => setDeletingPast(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={past.remove.isPending}
                onClick={() =>
                  past.remove.mutate(deletingPast.recordId, {
                    onSuccess: () => {
                      setDeletingPast(null);
                      toast.success('Past record deleted.');
                    },
                  })
                }
              >
                Delete
              </Button>
            </div>
          }
        >
          <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            Delete {deletingPast.label}? The employee’s status, designation, team and gross salary are worked out again
            from the rest of their history. Records the system made itself are not affected.
          </p>
        </Modal>
      )}
      {addingEvent && !readOnly && (
        <AddEventModal
          employee={e}
          teams={teamOptions}
          pending={addEvent.isPending}
          error={addEvent.isError ? (addEvent.error as Error).message : null}
          onClose={() => {
            setAddingEvent(false);
            addEvent.reset();
          }}
          onSubmit={(body) =>
            addEvent.mutate(body, {
              onSuccess: () => {
                setAddingEvent(false);
                toast.success('Event added to the timeline.');
              },
            })
          }
        />
      )}
    </div>
  );
}
