import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus, Rocket, Trash2 } from 'lucide-react';
import type { AppraisalListRow, Competency, CycleView } from '../api/appraisals';
import { useCreateCycle, useCycleAppraisals, useCycles, useLaunchCycle, useUpdateCycle } from '../hooks/useAppraisals';
import { useEmployees } from '../hooks/usePeople';
import { APPRAISAL_STATUS_LABEL, DEFAULT_COMPETENCIES, STATUS_STEPS, td, th } from '../lib/appraisals';
import { dhakaToday, formatDate } from '../lib/people';
import { PageHeader } from '../components/ui/PageHeader';
import { PageSkeleton } from '../components/ui/PageSkeleton';
import { QueryError } from '../components/ui/QueryError';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { MultiSelect } from '../components/ui/MultiSelect';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { useToast } from '../components/ui/Toast';
import { AppraisalStatusPill, CycleStatusPill, RecommendationText, ScoreCell } from '../components/people/AppraisalBits';
import { FormRow, HeaderActions } from '../components/people/FormBits';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

/** Competency keys must be unique and `[a-z0-9_]`; a new label gets a key derived from it. */
function withKeys(list: { key: string; label: string }[]): Competency[] {
  const seen = new Set<string>();
  return list.map((c, i) => {
    let key = c.key || slug(c.label) || `competency_${i + 1}`;
    while (seen.has(key)) key = `${key}_${i + 1}`;
    seen.add(key);
    return { key, label: c.label.trim() };
  });
}

function CreateCycleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CycleView) => void }) {
  const create = useCreateCycle();
  const year = dhakaToday().slice(0, 4);
  const [name, setName] = useState(`${year} review`);
  const [periodStart, setPeriodStart] = useState(`${year}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(`${year}-12-31`);
  const [kpiWeight, setKpiWeight] = useState('70');
  const [competencies, setCompetencies] = useState(DEFAULT_COMPETENCIES.map((c) => ({ ...c })));
  const [formError, setFormError] = useState('');

  function submit() {
    const weight = Number(kpiWeight);
    if (!name.trim()) return setFormError('Name the cycle.');
    if (!periodStart || !periodEnd || periodStart > periodEnd) return setFormError('The period must start on or before it ends.');
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) return setFormError('KPI weight must be a whole number from 0 to 100.');
    const filled = competencies.filter((c) => c.label.trim());
    if (filled.length === 0) return setFormError('Add at least one competency.');
    setFormError('');
    create.mutate(
      { name: name.trim(), periodStart, periodEnd, kpiWeight: weight, competencies: withKeys(filled) },
      { onSuccess: onCreated },
    );
  }

  const message = formError || (create.error ? (create.error as Error).message : '');
  return (
    <Modal
      onClose={onClose}
      title="New appraisal cycle"
      subtitle="Created as a draft; launching it creates the appraisals."
      width={560}
      onSubmit={submit}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {message && (
            <span role="alert" style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }}>
              {message}
            </span>
          )}
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" loading={create.isPending} icon={<Check size={13} strokeWidth={2} />}>
            Create cycle
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <FormRow>
          <Field label="Period start" required>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </Field>
          <Field label="Period end" required>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>
        </FormRow>
        <Field
          label="KPI weight (%)"
          required
          hint={`KPIs count for ${kpiWeight || 0}% of the score, competencies for the other ${100 - (Number(kpiWeight) || 0)}%.`}
        >
          <Input type="number" min={0} max={100} value={kpiWeight} onChange={(e) => setKpiWeight(e.target.value)} />
        </Field>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Competencies (rated 1–5 by the lead)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {competencies.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                {/* Input's own wrapper doesn't grow in a flex row; without this the label is cut off. */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Input
                    aria-label={`Competency ${i + 1}`}
                    value={c.label}
                    maxLength={120}
                    onChange={(e) => setCompetencies(competencies.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  aria-label={`Remove competency ${i + 1}`}
                  onClick={() => setCompetencies(competencies.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <Button
              type="button"
              size="sm"
              icon={<Plus size={13} />}
              disabled={competencies.length >= 12}
              onClick={() => setCompetencies([...competencies, { key: '', label: '' }])}
            >
              Add competency
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function LaunchModal({ cycle, onClose }: { cycle: CycleView; onClose: () => void }) {
  const toast = useToast();
  const launch = useLaunchCycle(cycle.id);
  const employees = useEmployees({});
  const [selected, setSelected] = useState<string[]>([]);

  const eligible = useMemo(
    () => (employees.data ?? []).filter((e) => e.status !== 'EXITED'),
    [employees.data],
  );
  const options = eligible.map((e) => ({ value: e.id, label: `${e.fullName} · ${e.designation}` }));

  function submit() {
    launch.mutate(selected.length > 0 ? selected : undefined, {
      onSuccess: (r) => {
        toast.success(
          `${r.created} appraisal${r.created === 1 ? '' : 's'} created${r.skipped ? `, ${r.skipped} already existed` : ''}`,
        );
        onClose();
      },
    });
  }

  return (
    <Modal
      onClose={onClose}
      title={`Launch ${cycle.name}`}
      subtitle="Creates one appraisal per employee, starting at the self review."
      width={520}
      onSubmit={submit}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {launch.error && (
            <span role="alert" style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }}>
              {(launch.error as Error).message}
            </span>
          )}
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" loading={launch.isPending} icon={<Rocket size={13} />}>
            {selected.length > 0 ? `Launch for ${selected.length}` : 'Launch for everyone'}
          </Button>
        </div>
      }
    >
      <Field
        label="Employees"
        hint="Leave empty to include everyone who hasn't exited and joined on or before the period end. Employees who already have an appraisal in this cycle are skipped."
      >
        <MultiSelect
          options={options}
          value={selected}
          onChange={setSelected}
          allLabel="All eligible employees"
          ariaLabel="Employees to include"
        />
      </Field>
    </Modal>
  );
}

function CycleDetail({ cycle }: { cycle: CycleView }) {
  const toast = useToast();
  const appraisals = useCycleAppraisals(cycle.id);
  const update = useUpdateCycle(cycle.id);
  const [launching, setLaunching] = useState(false);

  const setStatus = (status: 'OPEN' | 'CLOSED') =>
    update.mutate({ status }, { onSuccess: () => toast.success(status === 'CLOSED' ? 'Cycle closed' : 'Cycle reopened') });

  return (
    <Card
      title={cycle.name}
      subtitle={`${formatDate(cycle.periodStart)} – ${formatDate(cycle.periodEnd)} · KPIs ${cycle.kpiWeight}% · competencies ${100 - cycle.kpiWeight}%`}
      action={
        <HeaderActions>
          <CycleStatusPill status={cycle.status} />
          {cycle.status !== 'CLOSED' && (
            <Button size="sm" variant="accent" icon={<Rocket size={13} />} onClick={() => setLaunching(true)}>
              Launch
            </Button>
          )}
          {cycle.status === 'OPEN' && (
            <Button size="sm" loading={update.isPending} onClick={() => setStatus('CLOSED')}>
              Close cycle
            </Button>
          )}
          {cycle.status === 'CLOSED' && (
            <Button size="sm" loading={update.isPending} onClick={() => setStatus('OPEN')}>
              Reopen
            </Button>
          )}
        </HeaderActions>
      }
    >
      {update.error && (
        <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>
          {(update.error as Error).message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {STATUS_STEPS.map((s) => (
          <div
            key={s}
            style={{ flex: '1 1 110px', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--muted-bg)' }}
          >
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{APPRAISAL_STATUS_LABEL[s]}</div>
            <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {cycle.counts[s]}
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}> / {cycle.counts.total}</span>
            </div>
          </div>
        ))}
      </div>

      {appraisals.isLoading ? (
        <TableSkeleton rows={5} />
      ) : appraisals.isError || !appraisals.data ? (
        <QueryError query={appraisals} what="appraisals" />
      ) : appraisals.data.length === 0 ? (
        <EmptyState
          title="No appraisals in this cycle"
          body={cycle.status === 'CLOSED' ? 'Reopen the cycle to launch it.' : 'Launch the cycle to create one appraisal per employee.'}
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Employee</th>
                <th style={th}>Team</th>
                <th style={th}>Reviewer</th>
                <th style={th}>Status</th>
                <th style={th}>Score</th>
                <th style={th}>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {appraisals.data.map((a: AppraisalListRow) => (
                <tr key={a.id}>
                  <td style={td}>
                    <Link to={`/people/appraisals/${a.id}`} style={{ fontWeight: 500 }}>
                      {a.employeeName}
                    </Link>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{a.designation}</div>
                  </td>
                  <td style={td}>{a.teamName ?? '—'}</td>
                  <td style={td}>{a.reviewerName ?? '—'}</td>
                  <td style={td}>
                    <AppraisalStatusPill status={a.status} />
                  </td>
                  <td style={td}>
                    <ScoreCell score={a.score} />
                  </td>
                  <td style={td}>
                    <RecommendationText value={a.recommendation} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {launching && <LaunchModal cycle={cycle} onClose={() => setLaunching(false)} />}
    </Card>
  );
}

/** `/people/appraisals`: cycles, create and launch, and the selected cycle's progress and appraisals. */
export function AppraisalsPage() {
  const cycles = useCycles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (cycles.isLoading) return <PageSkeleton />;
  if (cycles.isError || !cycles.data) return <QueryError query={cycles} what="appraisal cycles" />;

  const list = cycles.data;
  const selected = list.find((c) => c.id === selectedId) ?? list[0] ?? null;

  return (
    <div>
      <PageHeader
        title="Appraisals"
        description="Cycles run self review, lead review, calibration and sign-off. KPIs are computed from tracked work and attendance, never typed."
        actions={
          <Button variant="accent" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New cycle
          </Button>
        }
      />

      {list.length === 0 ? (
        <Card>
          <EmptyState
            title="No appraisal cycles yet"
            body="Create a cycle for a review period, then launch it to start an appraisal for each employee."
            action={
              <Button variant="accent" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                New cycle
              </Button>
            }
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 1 280px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map((c) => {
              const active = selected?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--muted-bg)' : 'var(--surface)',
                    color: 'var(--text)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name}</span>
                    <CycleStatusPill status={c.status} />
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    {formatDate(c.periodStart)} – {formatDate(c.periodEnd)}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {c.counts.SIGNED_OFF} of {c.counts.total} signed off
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ flex: '1 1 520px', minWidth: 0 }}>{selected && <CycleDetail key={selected.id} cycle={selected} />}</div>
        </div>
      )}

      {creating && (
        <CreateCycleModal
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setSelectedId(c.id);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
