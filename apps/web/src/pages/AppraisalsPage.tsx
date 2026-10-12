import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Pencil, Plus, Rocket, Trash2 } from 'lucide-react';
import type { AppraisalListRow, AppraisalType, Competency, CycleView, LaunchResult, PeriodBasis, ScoringMode } from '../api/appraisals';
import { useCreateCycle, useCycleAppraisals, useCycles, useDueAppraisals, useLaunchCycle, useUpdateCycle } from '../hooks/useAppraisals';
import { useEmployees } from '../hooks/usePeople';
import {
  APPRAISAL_TYPE_LABEL,
  dateRangeText,
  dayMonth,
  DEFAULT_COMPETENCIES,
  dueWindowPresets,
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

const TYPE_CHOICES: { value: AppraisalType; hint: string; joinHint: string }[] = [
  { value: 'HALF_YEARLY', hint: 'January–June or July–December', joinHint: 'Every 6 months from the join date' },
  { value: 'YEARLY', hint: 'The full calendar year', joinHint: 'On each join anniversary' },
  { value: 'CONFIRMATION', hint: 'At the end of probation', joinHint: '6 months after joining' },
];

/** The value after it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Live "who is due" under the dates of a join-date cycle: "3 employees due — Jahid (15 Oct), …". */
function DuePreview({ type, from, to }: { type: AppraisalType; from: string; to: string }) {
  const key = useDebounced(`${type}|${from}|${to}`, 350);
  const [dType, dFrom, dTo] = key.split('|') as [AppraisalType, string, string];
  const valid = !!dFrom && !!dTo && dFrom <= dTo;
  const due = useDueAppraisals(valid ? { type: dType, from: dFrom, to: dTo } : null);
  const settling = key !== `${type}|${from}|${to}`;

  const box = {
    marginTop: 10, padding: '9px 12px', borderRadius: 'var(--radius)', fontSize: 12.5, lineHeight: 1.5,
    border: '1px solid var(--border-soft)', background: 'var(--surface-alt)', color: 'var(--text-muted)',
  } as const;
  if (!valid) return null;
  if (due.isLoading || settling) return <div style={box} aria-live="polite">Checking who is due…</div>;
  if (due.isError || !due.data) return <div style={{ ...box, color: 'var(--red)' }} role="alert">Couldn’t check who is due: {(due.error as Error | null)?.message ?? 'unknown error'}</div>;
  if (due.data.length === 0) return <div style={box} aria-live="polite">Nobody is due in this window.</div>;
  const shown = due.data.slice(0, 8);
  return (
    <div style={box} aria-live="polite">
      <b style={{ color: 'var(--text)', fontWeight: 600 }}>{plural(due.data.length, 'employee')} due</b>
      {' — '}
      {shown.map((d) => `${d.fullName} (${dayMonth(d.dueDate)})`).join(', ')}
      {due.data.length > shown.length && `, and ${due.data.length - shown.length} more`}
    </div>
  );
}

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

/** "Due 1–31 Oct 2026 · counted from join dates", or the calendar review period. */
function cyclePeriodText(c: CycleView): string {
  return c.periodBasis === 'JOIN_DATE'
    ? `Due ${dateRangeText(c.periodStart, c.periodEnd)} · counted from join dates`
    : `${formatDate(c.periodStart)} – ${formatDate(c.periodEnd)}`;
}

const sectionTitle = { fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 } as const;

function CreateCycleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CycleView) => void }) {
  const create = useCreateCycle();
  const today = dhakaToday();
  const presets = periodPresets(today);
  const windows = dueWindowPresets(today);
  const [basis, setBasis] = useState<PeriodBasis>('JOIN_DATE');
  const [preset, setPreset] = useState<string | null>(windows[0].key);
  const [name, setName] = useState(windows[0].name);
  const [periodStart, setPeriodStart] = useState(windows[0].start);
  const [periodEnd, setPeriodEnd] = useState(windows[0].end);
  const [type, setType] = useState<AppraisalType>('HALF_YEARLY');
  const [mode, setMode] = useState<ScoringMode>('FORM_100');
  const [kpiWeight, setKpiWeight] = useState('70');
  const [competencies, setCompetencies] = useState<Competency[]>(FORM_CRITERIA.map((c) => ({ ...c })));
  const [editing, setEditing] = useState<number | null>(null);
  const [formError, setFormError] = useState('');
  const form = mode === 'FORM_100';
  const defaults = form ? FORM_CRITERIA : DEFAULT_COMPETENCIES;
  const changed = JSON.stringify(competencies.map((c) => [c.label, c.description ?? ''])) !== JSON.stringify(defaults.map((c) => [c.label, c.description ?? '']));
  const months = monthsBetween(periodStart, periodEnd);
  const byJoin = basis === 'JOIN_DATE';
  const chips = byJoin
    ? windows.map((w) => ({ key: w.key, label: w.label, apply: () => pickWindow(w) }))
    : presets.map((p) => ({ key: p.label, label: p.label, apply: () => pick(p) }));

  function pick(p: (typeof presets)[number]) {
    setPreset(p.label);
    setName(p.name);
    setType(p.type);
    setPeriodStart(p.start);
    setPeriodEnd(p.end);
  }

  function pickWindow(w: (typeof windows)[number]) {
    setPreset(w.key);
    setName(w.name);
    setPeriodStart(w.start);
    setPeriodEnd(w.end);
  }

  function switchBasis(next: PeriodBasis) {
    if (next === basis) return;
    setBasis(next);
    // Each basis starts from its own first quick pick; the type stays unless a calendar pick sets it.
    if (next === 'JOIN_DATE') pickWindow(windows[0]);
    else pick(presets[0]);
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
    if (!periodStart || !periodEnd || periodStart > periodEnd)
      return setFormError(byJoin ? 'The window must start on or before it ends.' : 'The review period must start on or before it ends.');
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
        periodBasis: basis,
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
      subtitle="Set up who is appraised and the form. Nobody is appraised until you launch it."
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
          <div style={sectionTitle}>How appraisals are counted</div>
          <div role="radiogroup" aria-label="How appraisals are counted" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 8 }}>
            <ChoiceCard
              name="cycle-basis" checked={byJoin} title="Counted from each employee’s join date" badge="Recommended"
              hint="Everyone on their own schedule: confirmation 6 months after joining, then every 6 or 12 months. Each appraisal reviews the months before its due date."
              onSelect={() => switchBasis('JOIN_DATE')}
            />
            <ChoiceCard
              name="cycle-basis" checked={!byJoin} title="Calendar period"
              hint="Everyone is reviewed over the same dates, such as January–June."
              onSelect={() => switchBasis('CALENDAR')}
            />
          </div>
        </section>

        <section>
          <div style={sectionTitle}>{byJoin ? 'Appraisals due between' : 'Review period'}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }} role="group" aria-label="Quick picks">
            {chips.map((p) => {
              const on = preset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  className="cy-chip"
                  aria-pressed={on}
                  onClick={p.apply}
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
            <Field label="To" required hint={!byJoin && months ? `${months} month${months === 1 ? '' : 's'}` : undefined}>
              <Input type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setPreset(null); }} />
            </Field>
          </div>
          {byJoin && <DuePreview type={type} from={periodStart} to={periodEnd} />}
        </section>

        <section>
          <div style={sectionTitle}>Appraisal type</div>
          <div role="radiogroup" aria-label="Appraisal type" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 8 }}>
            {TYPE_CHOICES.map((t) => (
              <ChoiceCard
                key={t.value} name="cycle-type" checked={type === t.value}
                title={APPRAISAL_TYPE_LABEL[t.value]} hint={byJoin ? t.joinHint : t.hint}
                // A calendar quick pick sets the type, so changing it there leaves the pick; a due window does not.
                onSelect={() => { setType(t.value); if (!byJoin) setPreset(null); }}
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

/** "12 appraisals created, 1 already existed; 2 not due yet (Rumi, Tania)". */
function launchSummary(r: LaunchResult): string {
  const parts = [`${plural(r.created, 'appraisal')} created`];
  if (r.skipped) parts.push(`${r.skipped} already existed`);
  const notDue = r.notDue ?? [];
  const tail = notDue.length
    ? `; left out ${notDue.length}: ${notDue
        .map((n) => (n.reason === 'EXITED' ? `${n.employeeName} (exited)` : `${n.employeeName} (first due ${n.firstDueDate ? formatDate(n.firstDueDate) : 'later'})`))
        .join(', ')}`
    : '';
  return parts.join(', ') + tail;
}

function LaunchModal({ cycle, onClose }: { cycle: CycleView; onClose: () => void }) {
  return cycle.periodBasis === 'JOIN_DATE' ? <JoinDateLaunchModal cycle={cycle} onClose={onClose} /> : <CalendarLaunchModal cycle={cycle} onClose={onClose} />;
}

function CalendarLaunchModal({ cycle, onClose }: { cycle: CycleView; onClose: () => void }) {
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
        toast.success(launchSummary(r));
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

/**
 * Launch for a join-date cycle: everyone due in the window is listed with their due date and
 * review period, preselected (except anyone already in the cycle). Others can be added; the server
 * gives each their latest due date by the window's end and reports anyone not due yet.
 */
function JoinDateLaunchModal({ cycle, onClose }: { cycle: CycleView; onClose: () => void }) {
  const toast = useToast();
  const launch = useLaunchCycle(cycle.id);
  const employees = useEmployees({});
  const existing = useCycleAppraisals(cycle.id);
  const due = useDueAppraisals({ type: cycle.type, from: cycle.periodStart, to: cycle.periodEnd });
  // Everyone due is selected unless unticked; tracking the unticked (not the ticked) means a
  // refetch of the due list never wipes an edit, and needs no effect to seed the selection.
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set());
  const [extra, setExtra] = useState<string[]>([]);

  const already = useMemo(() => new Set((existing.data ?? []).map((a) => a.employeeId)), [existing.data]);
  const dueRows = useMemo(() => due.data ?? [], [due.data]);
  const dueIds = useMemo(() => new Set(dueRows.map((d) => d.employeeId)), [dueRows]);

  const selected = new Set(
    existing.data ? dueRows.filter((d) => !already.has(d.employeeId) && !unticked.has(d.employeeId)).map((d) => d.employeeId) : [],
  );
  const others = (employees.data ?? []).filter((e) => e.status !== 'EXITED' && !dueIds.has(e.id) && !already.has(e.id));
  const options = others.map((e) => ({ value: e.id, label: `${e.fullName} · ${e.designation}` }));
  const ids = [...selected, ...extra];

  function toggle(id: string) {
    const next = new Set(unticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setUnticked(next);
  }

  function submit() {
    if (ids.length === 0) return;
    launch.mutate(ids, {
      onSuccess: (r) => {
        toast.success(launchSummary(r));
        onClose();
      },
    });
  }

  const loading = due.isLoading || existing.isLoading;
  return (
    <Modal
      onClose={onClose}
      title={`Launch ${cycle.name}`}
      subtitle={`${APPRAISAL_TYPE_LABEL[cycle.type]} appraisals due ${dateRangeText(cycle.periodStart, cycle.periodEnd)}, counted from each join date. Each starts at the self review.`}
      width={620}
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
          <Button type="submit" variant="accent" loading={launch.isPending} disabled={ids.length === 0} icon={<Rocket size={13} />}>
            {ids.length > 0 ? `Launch for ${ids.length}` : 'Select someone to launch'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section>
          <div style={sectionTitle}>
            Due in this window
            {due.data && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {due.data.length}</span>}
          </div>
          {loading ? (
            <TableSkeleton rows={3} />
          ) : due.isError ? (
            <QueryError query={due} what="who is due" />
          ) : dueRows.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '10px 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', background: 'var(--surface-alt)' }}>
              Nobody is due in this window. You can still add someone below; they get their latest due date before {formatDate(cycle.periodEnd)}.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', maxHeight: 300, overflowY: 'auto' }}>
              {dueRows.map((d, i) => {
                const inCycle = already.has(d.employeeId);
                const on = selected.has(d.employeeId);
                return (
                  <li key={d.employeeId} style={{ borderTop: i === 0 ? undefined : '1px solid var(--border-soft)' }}>
                    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 12px', cursor: inCycle ? 'default' : 'pointer', opacity: inCycle ? 0.6 : 1 }}>
                      <input type="checkbox" checked={on && !inCycle} disabled={inCycle} onChange={() => toggle(d.employeeId)} style={{ marginTop: 3 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{d.fullName}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                          {d.designation}
                          {inCycle && ' · already in this cycle'}
                        </span>
                      </span>
                      <span style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>Due {formatDate(d.dueDate)}</span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>Reviews {dateRangeText(d.periodStart, d.periodEnd)}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <Field
          label="Add others"
          hint={`Each gets their latest ${APPRAISAL_TYPE_LABEL[cycle.type].toLowerCase()} due date on or before ${formatDate(cycle.periodEnd)} (a late appraisal). Anyone not due yet is left out and listed after launch.`}
        >
          <MultiSelect options={options} value={extra} onChange={setExtra} allLabel="Nobody else" ariaLabel="Other employees to include" />
        </Field>
      </div>
    </Modal>
  );
}

function CycleDetail({ cycle }: { cycle: CycleView }) {
  const toast = useToast();
  const appraisals = useCycleAppraisals(cycle.id);
  const update = useUpdateCycle(cycle.id);
  const [launching, setLaunching] = useState(false);

  const byJoin = cycle.periodBasis === 'JOIN_DATE';

  const setStatus = (status: 'OPEN' | 'CLOSED') =>
    update.mutate({ status }, { onSuccess: () => toast.success(status === 'CLOSED' ? 'Cycle closed' : 'Cycle reopened') });

  return (
    <Card
      title={cycle.name}
      subtitle={`${APPRAISAL_TYPE_LABEL[cycle.type]} · ${cyclePeriodText(cycle)} · ${
        cycle.scoringMode === 'FORM_100'
          ? `paper form, ${cycle.competencies.length} criteria, 100 marks`
          : `KPIs ${cycle.kpiWeight}% · competencies ${100 - cycle.kpiWeight}% (legacy)`
      }`}
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
          body={
            cycle.status === 'CLOSED'
              ? 'Reopen the cycle to launch it.'
              : byJoin
                ? 'Launch the cycle to create an appraisal for everyone due in this window.'
                : 'Launch the cycle to create one appraisal per employee.'
          }
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Employee</th>
                {byJoin && <th style={th}>Due</th>}
                {byJoin && <th style={th}>Review period</th>}
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
                  {byJoin && <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{a.dueDate ? formatDate(a.dueDate) : '—'}</td>}
                  {byJoin && <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{dateRangeText(a.periodStart, a.periodEnd)}</td>}
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
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{cyclePeriodText(c)}</div>
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
