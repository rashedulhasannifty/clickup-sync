import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Pencil, Plus, Rocket, Trash2 } from 'lucide-react';
import type { AppraisalListRow, AppraisalType, Competency, CycleView, ScoringMode } from '../api/appraisals';
import { useCreateCycle, useCycleAppraisals, useCycles, useLaunchCycle, useUpdateCycle } from '../hooks/useAppraisals';
import { useEmployees } from '../hooks/usePeople';
import {
  APPRAISAL_TYPE_LABEL,
  DEFAULT_COMPETENCIES,
  FORM_CRITERIA,
  FORM_RATINGS,
  statusLabel,
  stepsFor,
  td,
  th,
} from '../lib/appraisals';
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
import { AppraisalStatusPill, CycleStatusPill, OutcomeCell, ScoreCell } from '../components/people/AppraisalBits';
import { HeaderActions, TextArea } from '../components/people/FormBits';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

/** Competency keys must be unique and `[a-z0-9_]`; a new label gets a key derived from it. */
function withKeys(list: Competency[]): Competency[] {
  const seen = new Set<string>();
  return list.map((c, i) => {
    let key = c.key || slug(c.label) || `competency_${i + 1}`;
    while (seen.has(key)) key = `${key}_${i + 1}`;
    seen.add(key);
    const description = c.description?.trim();
    return description ? { key, label: c.label.trim(), description } : { key, label: c.label.trim() };
  });
}

/** One choice in a group of cards (radio semantics), with a one-line explanation under its name. */
function ChoiceCard({
  name, checked, title, hint, badge, onSelect,
}: {
  name: string;
  checked: boolean;
  title: string;
  hint: string;
  badge?: string;
  onSelect: () => void;
}) {
  return (
    <label
      className="cy-choice"
      style={{
        position: 'relative', display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
        padding: '11px 12px', borderRadius: 'var(--radius)',
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
        background: checked ? 'var(--selected-bg)' : 'var(--surface)',
        boxShadow: checked ? '0 0 0 3px var(--accent-soft)' : undefined,
        transition: 'border-color 120ms, background 120ms',
      }}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
      <span
        aria-hidden
        style={{
          marginTop: 2, width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
          border: checked ? '5px solid var(--accent)' : '1.5px solid var(--border-strong)', background: 'var(--surface)',
          transition: 'border 120ms',
        }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {title}
          {badge && (
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--accent-strong)', background: 'var(--accent-soft)', borderRadius: 999, padding: '1px 7px' }}>
              {badge}
            </span>
          )}
        </span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>{hint}</span>
      </span>
    </label>
  );
}

const TYPE_CHOICES: { value: AppraisalType; hint: string }[] = [
  { value: 'HALF_YEARLY', hint: 'January–June or July–December' },
  { value: 'YEARLY', hint: 'The full calendar year' },
  { value: 'CONFIRMATION', hint: 'At the end of probation' },
];

/** Quick picks: one click fills the name, type and dates. Built from today's date in Dhaka. */
function periodPresets(today: string) {
  const year = Number(today.slice(0, 4));
  const firstHalf = Number(today.slice(5, 7)) <= 6;
  const half = (y: number, h: 1 | 2) => ({
    label: `H${h} ${y}`,
    name: `H${h} ${y} half-yearly review`,
    type: 'HALF_YEARLY' as AppraisalType,
    start: h === 1 ? `${y}-01-01` : `${y}-07-01`,
    end: h === 1 ? `${y}-06-30` : `${y}-12-31`,
  });
  const full = (y: number) => ({ label: `Full year ${y}`, name: `${y} yearly review`, type: 'YEARLY' as AppraisalType, start: `${y}-01-01`, end: `${y}-12-31` });
  return firstHalf
    ? [half(year, 1), half(year - 1, 2), full(year - 1)]
    : [half(year, 2), half(year, 1), full(year)];
}

function monthsBetween(start: string, end: string): number | null {
  if (!start || !end || start > end) return null;
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  return (ye - ys) * 12 + (me - ms) + (de >= ds - 1 ? 1 : 0);
}

const sectionTitle = { fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 } as const;

function CreateCycleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CycleView) => void }) {
  const create = useCreateCycle();
  const presets = periodPresets(dhakaToday());
  const [preset, setPreset] = useState<string | null>(presets[0].label);
  const [name, setName] = useState(presets[0].name);
  const [periodStart, setPeriodStart] = useState(presets[0].start);
  const [periodEnd, setPeriodEnd] = useState(presets[0].end);
  const [type, setType] = useState<AppraisalType>(presets[0].type);
  const [mode, setMode] = useState<ScoringMode>('FORM_100');
  const [kpiWeight, setKpiWeight] = useState('70');
  const [competencies, setCompetencies] = useState<Competency[]>(FORM_CRITERIA.map((c) => ({ ...c })));
  const [editing, setEditing] = useState<number | null>(null);
  const [formError, setFormError] = useState('');
  const form = mode === 'FORM_100';
  const defaults = form ? FORM_CRITERIA : DEFAULT_COMPETENCIES;
  const changed = JSON.stringify(competencies.map((c) => [c.label, c.description ?? ''])) !== JSON.stringify(defaults.map((c) => [c.label, c.description ?? '']));
  const months = monthsBetween(periodStart, periodEnd);

  function pick(p: (typeof presets)[number]) {
    setPreset(p.label);
    setName(p.name);
    setType(p.type);
    setPeriodStart(p.start);
    setPeriodEnd(p.end);
  }

  function switchMode(next: ScoringMode) {
    if (next === mode) return;
    setMode(next);
    setEditing(null);
    // Each mode starts from its own defaults; the criteria are editable from there.
    setCompetencies((next === 'FORM_100' ? FORM_CRITERIA : DEFAULT_COMPETENCIES).map((c) => ({ ...c })));
  }

  const setAt = (i: number, patch: Partial<Competency>) => setCompetencies(competencies.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function submit() {
    const weight = Number(kpiWeight);
    if (!name.trim()) return setFormError('Give the cycle a name.');
    if (!periodStart || !periodEnd || periodStart > periodEnd) return setFormError('The review period must start on or before it ends.');
    if (!form && (!Number.isInteger(weight) || weight < 0 || weight > 100)) return setFormError('KPI weight must be a whole number from 0 to 100.');
    const filled = competencies.filter((c) => c.label.trim());
    if (filled.length === 0) return setFormError(form ? 'Add at least one criterion.' : 'Add at least one competency.');
    setFormError('');
    create.mutate(
      {
        name: name.trim(),
        periodStart,
        periodEnd,
        type,
        scoringMode: mode,
        ...(form ? {} : { kpiWeight: weight }),
        competencies: withKeys(filled),
      },
      { onSuccess: onCreated },
    );
  }

  const message = formError || (create.error ? (create.error as Error).message : '');
  const noun = form ? 'criterion' : 'competency';
  return (
    <Modal
      onClose={onClose}
      title="New appraisal cycle"
      subtitle="Set up the review period and the form. Nobody is appraised until you launch it."
      width={720}
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
      <style>{`
        .cy-choice:hover { border-color: var(--border-strong); }
        .cy-choice:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
        .cy-chip:hover { border-color: var(--accent) !important; }
        .cy-chip:focus-visible, .cy-crit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .cy-crit:hover { background: var(--hover) !important; }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <section>
          <div style={sectionTitle}>Review period</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }} role="group" aria-label="Quick picks">
            {presets.map((p) => {
              const on = preset === p.label;
              return (
                <button
                  key={p.label}
                  type="button"
                  className="cy-chip"
                  aria-pressed={on}
                  onClick={() => pick(p)}
                  style={{
                    all: 'unset', cursor: 'pointer', fontSize: 12.5, fontWeight: 500, padding: '5px 12px', borderRadius: 999,
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                    background: on ? 'var(--accent-soft)' : 'var(--surface)',
                    color: on ? 'var(--accent-strong)' : 'var(--text)',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 12 }}>
            <Field label="Name" required>
              <Input value={name} onChange={(e) => { setName(e.target.value); setPreset(null); }} maxLength={120} />
            </Field>
            <Field label="From" required>
              <Input type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setPreset(null); }} />
            </Field>
            <Field label="To" required hint={months ? `${months} month${months === 1 ? '' : 's'}` : undefined}>
              <Input type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setPreset(null); }} />
            </Field>
          </div>
        </section>

        <section>
          <div style={sectionTitle}>Appraisal type</div>
          <div role="radiogroup" aria-label="Appraisal type" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 8 }}>
            {TYPE_CHOICES.map((t) => (
              <ChoiceCard
                key={t.value} name="cycle-type" checked={type === t.value}
                title={APPRAISAL_TYPE_LABEL[t.value]} hint={t.hint}
                onSelect={() => { setType(t.value); setPreset(null); }}
              />
            ))}
          </div>
        </section>

        <section>
          <div style={sectionTitle}>How it’s scored</div>
          <div role="radiogroup" aria-label="Scoring" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 8 }}>
            <ChoiceCard
              name="cycle-mode" checked={form} title="Company appraisal form" badge="Recommended"
              hint="Supervisor rates each criterion out of 10. Total out of 100 with grade A–F; KPIs shown alongside."
              onSelect={() => switchMode('FORM_100')}
            />
            <ChoiceCard
              name="cycle-mode" checked={!form} title="KPI blend"
              hint="Older method: KPIs blended with 1–5 competency ratings into a score out of 5."
              onSelect={() => switchMode('KPI_BLEND')}
            />
          </div>
          {!form && (
            <div style={{ marginTop: 12, maxWidth: 260 }}>
              <Field label="KPI weight (%)" required hint={`KPIs ${kpiWeight || 0}%, competencies ${100 - (Number(kpiWeight) || 0)}%`}>
                <Input type="number" min={0} max={100} value={kpiWeight} onChange={(e) => setKpiWeight(e.target.value)} />
              </Field>
            </div>
          )}
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <div style={{ ...sectionTitle, marginBottom: 0 }}>
              {form ? 'Criteria' : 'Competencies'}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {competencies.length}</span>
            </div>
            {changed && (
              <Button type="button" size="sm" variant="ghost" onClick={() => { setCompetencies(defaults.map((c) => ({ ...c }))); setEditing(null); }}>
                {form ? 'Restore company criteria' : 'Restore defaults'}
              </Button>
            )}
          </div>
          {form ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Rated
              {FORM_RATINGS.map((r) => (
                <span key={r.value} style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '1px 8px', background: 'var(--surface-alt)' }}>
                  {r.label} <b style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{r.value}</b>
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Rated 1–5 by the lead.</div>
          )}

          <ol style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {competencies.map((c, i) => {
              const open = editing === i || !c.label.trim();
              return (
                <li key={i} style={{ borderTop: i === 0 ? undefined : '1px solid var(--border-soft)' }}>
                  {open ? (
                    <div style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--surface-alt)' }}>
                      <span style={{ width: 20, paddingTop: 7, fontSize: 12, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Input
                          autoFocus={editing === i}
                          aria-label={`${noun} ${i + 1} name`}
                          placeholder={form ? 'Criterion name, e.g. Teamwork' : 'Competency name'}
                          value={c.label}
                          maxLength={120}
                          onChange={(e) => setAt(i, { label: e.target.value })}
                        />
                        {form && (
                          <TextArea
                            aria-label={`Criterion ${i + 1} description`}
                            value={c.description ?? ''}
                            maxLength={1000}
                            rows={3}
                            placeholder="What the supervisor should look for"
                            onChange={(e) => setAt(i, { description: e.target.value })}
                          />
                        )}
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <Button type="button" size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => { setCompetencies(competencies.filter((_, j) => j !== i)); setEditing(null); }}>
                            Remove
                          </Button>
                          {c.label.trim() && (
                            <Button type="button" size="sm" onClick={() => setEditing(null)}>
                              Done
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="cy-crit"
                      onClick={() => setEditing(i)}
                      title={`Edit ${c.label}`}
                      style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', width: '100%', display: 'flex', gap: 10, padding: '9px 12px' }}
                    >
                      <span style={{ width: 20, fontSize: 12, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0, paddingTop: 1 }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{c.label}</span>
                        {c.description && (
                          <span style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                            {c.description}
                          </span>
                        )}
                      </span>
                      <Pencil size={13} style={{ color: 'var(--text-faint)', flexShrink: 0, marginTop: 3 }} aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <Button
              type="button"
              size="sm"
              icon={<Plus size={13} />}
              disabled={competencies.length >= 12}
              onClick={() => { setCompetencies([...competencies, { key: '', label: '' }]); setEditing(competencies.length); }}
            >
              {form ? 'Add criterion' : 'Add competency'}
            </Button>
            {form && competencies.length !== 10 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                With {competencies.length} criteria the total is scaled to 100.
              </span>
            )}
          </div>
        </section>
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
      subtitle={
        cycle.scoringMode === 'FORM_100'
          ? `${APPRAISAL_TYPE_LABEL[cycle.type]} · ${formatDate(cycle.periodStart)} – ${formatDate(cycle.periodEnd)} · paper form, ${cycle.competencies.length} criteria, 100 marks`
          : `${APPRAISAL_TYPE_LABEL[cycle.type]} · ${formatDate(cycle.periodStart)} – ${formatDate(cycle.periodEnd)} · KPIs ${cycle.kpiWeight}% · competencies ${100 - cycle.kpiWeight}% (legacy)`
      }
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
        {stepsFor(cycle.scoringMode).map((s) => (
          <div
            key={s}
            style={{ flex: '1 1 110px', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--muted-bg)' }}
          >
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{statusLabel(s, cycle.scoringMode)}</div>
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
                <th style={th}>{cycle.scoringMode === 'FORM_100' ? 'Marks / grade' : 'Score'}</th>
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
                    <AppraisalStatusPill status={a.status} mode={a.scoringMode} />
                  </td>
                  <td style={td}>
                    <ScoreCell score={a.score} />
                  </td>
                  <td style={td}>
                    <OutcomeCell mode={a.scoringMode} recommendation={a.recommendation} actions={a.actions} decision={a.approvalDecision} />
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
        description="Cycles follow the paper appraisal form: self review, supervisor, department head, HR, then CTO/COO approval. The form’s 100 marks and grade are the result; KPIs, computed from tracked work and attendance, are shown beside it as a reference."
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
