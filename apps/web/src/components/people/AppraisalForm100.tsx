import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Download, FileText, LogOut, RefreshCw, Save, Undo2 } from 'lucide-react';
import {
  appraisalsApi,
  type AppraisalAction,
  type AppraisalView,
  type ApprovalDecision,
  type EditableField,
  type EffectiveDateMode,
  type UpdateAppraisalBody,
} from '../../api/appraisals';
import type { KpiResult, ScoredKpi } from '../../api/people';
import { useAppraisalMutations } from '../../hooks/useAppraisals';
import {
  ACTION_LABEL,
  ACTIONS,
  APPRAISAL_TYPE_LABEL,
  FORM_RATINGS,
  arrearsText,
  draftFormScore,
  effectivePreview,
  effectiveSentence,
  gradePolicy,
  incrementRange,
  monthsText,
  policyLine,
  statusLabel,
  takaText,
  td,
  th,
} from '../../lib/appraisals';
import { bandTone, dhakaToday, formatDate } from '../../lib/people';
import { PageHeader } from '../ui/PageHeader';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Pill } from '../ui/Pill';
import { useToast } from '../ui/Toast';
import { AppraisalStatusPill, GradeBadge, OutcomeCell, ScoreCell } from './AppraisalBits';
import { HeaderActions, TextArea } from './FormBits';
import { AppraisalDatesCard } from './AppraisalDates';
import { CHOICE_CARD_CSS, ChoiceCard } from './ChoiceCard';

/** Ticked recommendations that are applied from a date (confirmation date, promotion, new salary). */
const DATED_ACTIONS: AppraisalAction[] = ['CONFIRM', 'INCREMENT', 'PROMOTION'];

const KPI_ROWS: { key: ScoredKpi; label: string }[] = [
  { key: 'utilisation', label: 'Utilisation' },
  { key: 'chargeable', label: 'Chargeable' },
  { key: 'onTimeDelivery', label: 'On-time delivery' },
  { key: 'punctuality', label: 'Punctuality' },
];

const NEXT_LABEL: Partial<Record<AppraisalView['status'], string>> = {
  SELF_REVIEW: 'Submit to supervisor',
  LEAD_REVIEW: 'Send to department head',
  DEPT_HEAD_REVIEW: 'Send to HR',
  HR_REVIEW: 'Send for CTO/COO approval',
  FINAL_APPROVAL: 'Sign off',
};

const TEXT_FIELDS = ['selfComment', 'leadComment', 'deptHeadComment', 'hrComment', 'trainingPlan', 'approvalComment', 'newDesignation'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

function Stepper({ view }: { view: AppraisalView }) {
  const mode = view.cycle.scoringMode;
  const current = view.steps.findIndex((s) => s.status === view.status);
  return (
    <div role="list" aria-label="Appraisal progress" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
      {view.steps.map((s, i) => {
        const done = i < current || view.status === 'SIGNED_OFF';
        const cur = i === current && view.status !== 'SIGNED_OFF';
        return (
          <span
            key={s.status}
            role="listitem"
            aria-current={cur ? 'step' : undefined}
            title={s.at ? `${s.byName ?? 'Recorded'} · ${formatDate(s.at.slice(0, 10))}` : undefined}
            style={{
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 12.5,
              border: `1px solid ${cur ? 'var(--accent)' : 'var(--border)'}`,
              background: cur ? 'var(--muted-bg)' : 'transparent',
              color: done ? 'var(--pill-green-text)' : cur ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: cur ? 600 : 400,
            }}
          >
            {done ? '✓ ' : cur ? '● ' : ''}
            {statusLabel(s.status, mode)}
            {s.byName && done && s.status !== 'SIGNED_OFF' ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {s.byName}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

/** The five labelled options of the form's rating scale. */
function FormRating({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {FORM_RATINGS.map((r) => {
        const on = value === r.value;
        return (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            title={`${r.label} (${r.value})`}
            // Clicking the selected option again clears it.
            onClick={() => onChange(on ? undefined : r.value)}
            style={{
              minWidth: 62,
              padding: '4px 6px',
              borderRadius: 6,
              fontSize: 11,
              lineHeight: 1.25,
              cursor: disabled ? 'default' : 'pointer',
              border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
              background: on ? 'var(--accent)' : 'transparent',
              color: on ? '#fff' : 'var(--text-muted)',
              opacity: disabled && !on ? 0.55 : 1,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>{r.value}</div>
            <div>{r.label}</div>
          </button>
        );
      })}
    </div>
  );
}

function ratingName(v: number | undefined): string {
  const r = FORM_RATINGS.find((x) => x.value === v);
  return r ? `${r.label} (${r.value})` : '—';
}

function kpiActual(k: KpiResult): string {
  if (k.value != null) return `${k.value}%`;
  return k.reason === 'not-linked' ? 'Not linked to ClickUp' : 'No data';
}

function HeaderGrid({ view }: { view: AppraisalView }) {
  const h = view.formHeader;
  if (!h) {
    return (
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
        The header is captured when the appraisal is launched and refreshed with the KPIs. Refresh the KPIs to capture it now.
      </p>
    );
  }
  const items: [string, string][] = [
    ['Name', h.name],
    ['Concern name', h.concernName ?? '—'],
    ['Designation', h.designation],
    ['Department', h.department ?? '—'],
    ['Date of joining', formatDate(h.joinDate)],
    ['Academic qualification', h.academicQualification ?? '—'],
    [`Experience in ${h.companyName || 'the company'}`, monthsText(h.experienceInCompanyMonths)],
    ['Total years of experience', monthsText(h.totalExperienceMonths)],
    ['Starting salary', takaText(h.startingSalary)],
    ['Present gross salary', takaText(h.grossSalary)],
    ['Last year increment amount', takaText(h.lastIncrementAmount)],
    ['Last promotion date', h.lastPromotionDate ? formatDate(h.lastPromotionDate) : '—'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '10px 18px' }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{k}</div>
          <div style={{ fontSize: 13.5, overflowWrap: 'anywhere' }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function Signature({ view, step }: { view: AppraisalView; step: AppraisalView['status'] }) {
  const s = view.steps.find((x) => x.status === step);
  if (!s?.at) return null;
  return (
    <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4, textAlign: 'right' }}>
      {s.byName ?? 'Recorded'} · {formatDate(s.at.slice(0, 10))}
    </div>
  );
}

/** Draft state seeded once from the saved view; the parent remounts it (via `key`) when the saved view changes. */
export function Form100Appraisal({ view }: { view: AppraisalView }) {
  const toast = useToast();
  const m = useAppraisalMutations(view.id);

  const [selfRatings, setSelfRatings] = useState(view.selfRatings);
  const [leadRatings, setLeadRatings] = useState(view.leadRatings);
  const [actions, setActions] = useState<AppraisalAction[]>(view.actions);
  const [incrementPercent, setIncrementPercent] = useState(view.incrementPercent == null ? '' : String(view.incrementPercent));
  const [decision, setDecision] = useState<ApprovalDecision | null>(view.approvalDecision);
  const [text, setText] = useState<Record<TextField, string>>(() => {
    const t = {} as Record<TextField, string>;
    for (const f of TEXT_FIELDS) t[f] = view[f] ?? '';
    return t;
  });
  const savedEffMode: EffectiveDateMode = view.effectiveDateMode ?? view.effective?.mode ?? 'APPROVAL_DATE';
  const [effMode, setEffMode] = useState<EffectiveDateMode>(savedEffMode);
  const [effCustom, setEffCustom] = useState(view.effectiveDateMode === 'CUSTOM' ? (view.effectiveDate ?? '') : '');
  const [formError, setFormError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const can = (f: EditableField) => view.editableFields.includes(f);
  const signedOff = view.status === 'SIGNED_OFF';
  const cycleOpen = view.cycle.status === 'OPEN';
  const keys = view.cycle.competencies.map((c) => c.key);
  const live = draftFormScore(leadRatings, keys);
  // After sign-off the frozen result is the answer.
  const total = signedOff ? view.score.final : live.total;
  const grade = signedOff ? view.score.grade : live.grade;
  const policy = grade ? gradePolicy(grade) : null;
  const separation = actions.includes('TERMINATION') || actions.includes('DISMISSAL');
  const dated = actions.some((a) => DATED_ACTIONS.includes(a));
  const today = dhakaToday();
  // Signed off: the frozen date. Before: what signing off today with this choice would use.
  const effective = signedOff
    ? view.effective
    : effectivePreview({ mode: effMode, customDate: effCustom, dueDate: view.dueDate, periodStart: view.periodStart, today, decision, actions });
  // The server's default when nothing is chosen: the due date once late (past the 3-day grace).
  const suggested: EffectiveDateMode = view.dueDate && view.timing?.status === 'OPEN_OVERDUE' ? 'DUE_DATE' : 'APPROVAL_DATE';

  function changes(): UpdateAppraisalBody | { error: string } {
    const body: UpdateAppraisalBody = {};
    const sameMap = (a: Record<string, number>, b: Record<string, number>) =>
      JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
    if (can('selfRatings') && !sameMap(selfRatings, view.selfRatings)) body.selfRatings = selfRatings;
    if (can('leadRatings') && !sameMap(leadRatings, view.leadRatings)) body.leadRatings = leadRatings;
    for (const f of TEXT_FIELDS) {
      if (can(f) && text[f].trim() !== (view[f] ?? '')) body[f] = text[f].trim() || null;
    }
    if (can('actions')) {
      const sorted = (x: AppraisalAction[]) => [...x].sort().join(',');
      if (sorted(actions) !== sorted(view.actions)) body.actions = ACTIONS.filter((a) => actions.includes(a));
    }
    if (can('incrementPercent')) {
      const raw = incrementPercent.trim();
      const next = raw === '' || !actions.includes('INCREMENT') ? null : Number(raw);
      if (next !== null && (!Number.isFinite(next) || next < 0 || next > 100)) return { error: 'The increment must be between 0 and 100%.' };
      const rounded = next === null ? null : Math.round(next * 100) / 100;
      if (rounded !== view.incrementPercent) body.incrementPercent = rounded;
    }
    if (can('approvalDecision') && decision !== view.approvalDecision) body.approvalDecision = decision;
    if (can('effectiveDateMode') && dated) {
      const customChanged = effMode === 'CUSTOM' && effCustom !== (view.effectiveDateMode === 'CUSTOM' ? (view.effectiveDate ?? '') : '');
      if (effMode !== savedEffMode || customChanged) {
        if (effMode === 'CUSTOM' && !effCustom) return { error: 'Choose the date the outcome takes effect from.' };
        if (effMode === 'CUSTOM' && effCustom < view.periodStart) return { error: 'The effective date cannot be before the review period starts.' };
        body.effectiveDateMode = effMode;
        body.effectiveDate = effMode === 'CUSTOM' ? effCustom : null;
      }
    }
    return body;
  }

  const diff = changes();
  const dirty = !('error' in diff) && Object.keys(diff).length > 0;
  const blockers = view.advanceBlockers;
  const busy = m.save.isPending || m.advance.isPending || m.sendBack.isPending || m.refreshKpis.isPending;
  const error = formError || [m.save, m.advance, m.sendBack, m.refreshKpis].map((x) => x.error as Error | null).find(Boolean)?.message || '';

  async function save(): Promise<boolean> {
    const c = changes();
    if ('error' in c) {
      setFormError(c.error);
      return false;
    }
    setFormError('');
    if (Object.keys(c).length === 0) return true;
    try {
      await m.save.mutateAsync(c);
      return true;
    } catch {
      return false;
    }
  }

  async function onSave() {
    if (await save()) toast.success('Saved');
  }

  /** Saves pending edits first (the page remounts on every save), then the adjusted dates. */
  async function saveDates(body: UpdateAppraisalBody): Promise<boolean> {
    if (!(await save())) return false;
    try {
      await m.save.mutateAsync(body);
      toast.success('Dates updated');
      return true;
    } catch {
      return false;
    }
  }

  async function onRefreshKpis() {
    if (!(await save())) return;
    try {
      await m.refreshKpis.mutateAsync();
    } catch {
      /* shown through `error` */
    }
  }

  async function onAdvance() {
    if (view.status === 'FINAL_APPROVAL') {
      const what =
        decision === 'APPROVED'
          ? 'It becomes read-only and the approved outcome (confirmation, promotion, increment) is applied to the employee’s record.'
          : 'It becomes read-only. Nothing is applied to the employee’s record because the appraisal was not approved.';
      if (!window.confirm(`Sign off this appraisal? ${what}`)) return;
    }
    if (!(await save())) return;
    try {
      await m.advance.mutateAsync();
      toast.success(view.status === 'FINAL_APPROVAL' ? 'Signed off' : 'Moved to the next step');
    } catch {
      /* shown inline */
    }
  }

  /** Saves pending edits first so the preview shows them, then downloads the PDF. */
  async function onDownload() {
    if (!signedOff && cycleOpen && !(await save())) return;
    setDownloading(true);
    try {
      const blob = await appraisalsApi.formPdfBlob(view.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Appraisal form - ${view.employee.fullName} - ${view.cycle.name}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setFormError((e as Error).message || 'Could not generate the PDF.');
    } finally {
      setDownloading(false);
    }
  }

  function toggleAction(a: AppraisalAction) {
    const on = actions.includes(a);
    const next = on ? actions.filter((x) => x !== a) : [...actions, a];
    setActions(next);
    // Prefill the increment from the grade's range the first time Increment is ticked.
    if (a === 'INCREMENT' && !on && incrementPercent.trim() === '' && policy) setIncrementPercent(String(policy.incrementMin));
  }

  const setT = (f: TextField) => (e: { target: { value: string } }) => setText({ ...text, [f]: e.target.value });
  const kpi = view.kpiSnapshot;

  return (
    <div>
      <PageHeader
        breadcrumb={
          <span>
            <Link to="/people/appraisals" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ArrowLeft size={12} /> Appraisals
            </Link>
            {' · '}
            {view.cycle.name}
          </span>
        }
        title={`Performance appraisal · ${view.cycle.name}`}
        badge={
          <>
            <AppraisalStatusPill status={view.status} mode="FORM_100" />
            <Pill tone="gray" size="xs">
              {APPRAISAL_TYPE_LABEL[view.cycle.type]}
            </Pill>
          </>
        }
        description={`${view.employee.fullName} · ${view.employee.designation} · review period ${formatDate(view.periodStart)} – ${formatDate(view.periodEnd)}${view.dueDate ? ` · due ${formatDate(view.dueDate)}` : ''}${view.reviewerName ? ` · supervisor ${view.reviewerName}` : ''}`}
        actions={
          <HeaderActions>
            <Button icon={<Download size={13} />} loading={downloading} disabled={busy} onClick={onDownload}>
              {signedOff ? 'Download form (PDF)' : 'Preview form (PDF)'}
            </Button>
            {!signedOff && cycleOpen && (
              <>
                {view.canSendBack && (
                  <Button icon={<Undo2 size={13} />} loading={m.sendBack.isPending} disabled={busy} onClick={() => m.sendBack.mutate()}>
                    Send back
                  </Button>
                )}
                <Button icon={<Save size={13} />} loading={m.save.isPending} disabled={busy || !dirty} onClick={onSave}>
                  Save
                </Button>
                <Button variant="accent" icon={<Check size={13} />} loading={m.advance.isPending} disabled={busy || (!dirty && blockers.length > 0)} onClick={onAdvance}>
                  {NEXT_LABEL[view.status]}
                </Button>
              </>
            )}
          </HeaderActions>
        }
      />

      <Stepper view={view} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {error && <Callout tone="error">{error}</Callout>}
        {!cycleOpen && (
          <Callout tone="warning">
            This cycle is {view.cycle.status.toLowerCase()}, so its appraisals are read-only. Reopen it from the Appraisals page to make changes.
          </Callout>
        )}
        {signedOff && !view.outcomeApplied && (
          <Callout tone="warning">
            Signed off, but the approved outcome hasn’t been written to the employee’s record yet.{' '}
            <Button size="sm" loading={m.advance.isPending} onClick={() => m.advance.mutate()}>
              Retry
            </Button>
          </Callout>
        )}
        {signedOff && view.outcomeApplied && !view.formDocumentId && (
          <Callout tone="neutral" icon={<FileText size={15} />}>
            The signed form hasn’t been filed to the employee’s documents (document storage may not be configured). You can still download it.{' '}
            <Button size="sm" loading={m.advance.isPending} onClick={() => m.advance.mutate()}>
              File it now
            </Button>
          </Callout>
        )}
        {signedOff && view.formDocumentId && (
          <Callout tone="success" icon={<FileText size={15} />}>
            The signed form is filed under the employee’s{' '}
            <Link to={`/people/${encodeURIComponent(view.employee.id)}?tab=documents`}>Documents (Appraisal)</Link>.
          </Callout>
        )}
        {signedOff && view.approvalDecision === 'APPROVED' && separation && (
          <Callout tone="warning" icon={<LogOut size={15} />}>
            The approved recommendation includes {actions.includes('DISMISSAL') ? 'dismissal' : 'termination'}. Separation is never automatic.{' '}
            <Link to={`/people/${encodeURIComponent(view.employee.id)}/exit`}>Start offboarding</Link>
          </Callout>
        )}
        {signedOff && view.approvalDecision === 'NOT_APPROVED' && (
          <Callout tone="neutral">Not approved by the CTO/COO: signed off with no change to the employee’s record.</Callout>
        )}
        {!signedOff && cycleOpen && !dirty && blockers.length > 0 && view.status !== 'SELF_REVIEW' && (
          <Callout tone="info">To move on: {blockers.join(' · ')}.</Callout>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            title="Employee"
            subtitle={view.formHeader ? `As captured ${formatDate(view.formHeader.capturedAt.slice(0, 10))}${signedOff ? ' · frozen at sign-off' : ''}` : undefined}
          >
            <HeaderGrid view={view} />
          </Card>

          <Card
            title="Performance criteria"
            subtitle={`Rated by the supervisor: ${FORM_RATINGS.map((r) => `${r.label} ${r.value}`).join(' · ')}.${view.cycle.competencies.length !== 10 ? ` ${view.cycle.competencies.length} criteria, so the total is normalised to 100.` : ''}`}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Criterion</th>
                    <th style={th}>{can('selfRatings') ? 'Self rating' : 'Supervisor rating'}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.cycle.competencies.map((c, i) => (
                    <tr key={c.key}>
                      <td style={{ ...td, verticalAlign: 'top', minWidth: 240 }}>
                        <div style={{ fontWeight: 600 }}>
                          {i + 1}. {c.label}
                        </div>
                        {c.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>{c.description}</div>}
                      </td>
                      <td style={{ ...td, verticalAlign: 'top' }}>
                        {can('selfRatings') ? (
                          <FormRating
                            label={`Self rating: ${c.label}`}
                            value={selfRatings[c.key]}
                            disabled={busy}
                            onChange={(v) => {
                              const next = { ...selfRatings };
                              if (v === undefined) delete next[c.key];
                              else next[c.key] = v;
                              setSelfRatings(next);
                            }}
                          />
                        ) : (
                          <>
                            <FormRating
                              label={`Supervisor rating: ${c.label}`}
                              value={leadRatings[c.key]}
                              disabled={!can('leadRatings') || busy}
                              onChange={(v) => {
                                const next = { ...leadRatings };
                                if (v === undefined) delete next[c.key];
                                else next[c.key] = v;
                                setLeadRatings(next);
                              }}
                            />
                            {view.selfRatings[c.key] != null && (
                              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>Self: {ratingName(view.selfRatings[c.key])}</div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Recommendations by supervisor / department head" subtitle="Applied to the employee’s record only if the CTO/COO approves.">
            <div role="group" aria-label="Recommendations" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
              {ACTIONS.map((a) => (
                <label key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: can('actions') && !busy ? 'pointer' : 'default' }}>
                  <input type="checkbox" checked={actions.includes(a)} disabled={!can('actions') || busy} onChange={() => toggleAction(a)} />
                  {ACTION_LABEL[a]}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {actions.includes('INCREMENT') && (
                <Field
                  label="Proposed increment (%)"
                  required
                  hint={policy ? `Grade ${policy.grade} range: ${incrementRange(policy)}.` : 'Prefilled from the grade’s range once every criterion is rated.'}
                >
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={incrementPercent}
                    disabled={!can('incrementPercent') || busy}
                    onChange={(e) => setIncrementPercent(e.target.value)}
                    style={{ maxWidth: 140 }}
                  />
                </Field>
              )}
              {actions.includes('PROMOTION') && (
                <Field label="New designation" required hint={`Currently ${view.employee.designation}. Applied at sign-off if approved.`}>
                  <Input
                    value={text.newDesignation}
                    disabled={!can('newDesignation') || busy}
                    maxLength={200}
                    placeholder="e.g. Manager"
                    onChange={setT('newDesignation')}
                  />
                </Field>
              )}
              {separation && (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  Termination and dismissal are never automatic: once signed off, start offboarding from the employee page.
                </div>
              )}
              <Field label="Training need / development plan (if any)">
                <TextArea value={text.trainingPlan} disabled={!can('trainingPlan') || busy} onChange={setT('trainingPlan')} maxLength={5000} />
              </Field>
            </div>
          </Card>

          <Card title="Comments">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Employee’s self review comment">
                <TextArea value={text.selfComment} disabled={!can('selfComment') || busy} onChange={setT('selfComment')} maxLength={5000} />
              </Field>
              <div>
                <Field label="Supervisor’s comments" hint="Specifically mention salary raise and promotion, if any.">
                  <TextArea value={text.leadComment} disabled={!can('leadComment') || busy} onChange={setT('leadComment')} maxLength={5000} />
                </Field>
                <Signature view={view} step="LEAD_REVIEW" />
              </div>
              <div>
                <Field label="Department head comments">
                  <TextArea value={text.deptHeadComment} disabled={!can('deptHeadComment') || busy} onChange={setT('deptHeadComment')} maxLength={5000} />
                </Field>
                <Signature view={view} step="DEPT_HEAD_REVIEW" />
              </div>
              <div>
                <Field label="HR department comments">
                  <TextArea value={text.hrComment} disabled={!can('hrComment') || busy} onChange={setT('hrComment')} maxLength={5000} />
                </Field>
                <Signature view={view} step="HR_REVIEW" />
              </div>
            </div>
          </Card>

          <Card title="Approval & comments by CTO/COO">
            <div role="radiogroup" aria-label="Approval decision" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['APPROVED', 'NOT_APPROVED'] as ApprovalDecision[]).map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={decision === d}
                  variant={decision === d ? (d === 'APPROVED' ? 'success' : 'danger') : 'default'}
                  disabled={!can('approvalDecision') || busy}
                  onClick={() => setDecision(decision === d ? null : d)}
                >
                  {d === 'APPROVED' ? 'Approved' : 'Not approved'}
                </Button>
              ))}
            </div>
            {dated && (view.status === 'FINAL_APPROVAL' || signedOff) && (
              <div style={{ marginBottom: 14 }}>
                <style>{CHOICE_CARD_CSS}</style>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Effective from</div>
                {!signedOff && (
                  <div role="radiogroup" aria-label="Effective from" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 8 }}>
                    <ChoiceCard
                      name="effective-from"
                      checked={effMode === 'DUE_DATE'}
                      title="The due date (backdated)"
                      badge={suggested === 'DUE_DATE' ? 'Suggested' : undefined}
                      hint={view.dueDate ? `From ${formatDate(view.dueDate)}, when the appraisal was due.` : 'This appraisal has no due date.'}
                      disabled={!can('effectiveDateMode') || busy || !view.dueDate}
                      onSelect={() => setEffMode('DUE_DATE')}
                    />
                    <ChoiceCard
                      name="effective-from"
                      checked={effMode === 'APPROVAL_DATE'}
                      title="The approval date"
                      badge={suggested === 'APPROVAL_DATE' ? 'Suggested' : undefined}
                      hint="From the day it is signed off."
                      disabled={!can('effectiveDateMode') || busy}
                      onSelect={() => setEffMode('APPROVAL_DATE')}
                    />
                    <ChoiceCard
                      name="effective-from"
                      checked={effMode === 'CUSTOM'}
                      title="Another date"
                      hint="Not before the review period starts."
                      disabled={!can('effectiveDateMode') || busy}
                      onSelect={() => setEffMode('CUSTOM')}
                    />
                  </div>
                )}
                {!signedOff && effMode === 'CUSTOM' && (
                  <div style={{ marginTop: 8, maxWidth: 200 }}>
                    <Field label="Effective date" required>
                      <Input type="date" min={view.periodStart} value={effCustom} disabled={!can('effectiveDate') || busy} onChange={(e) => setEffCustom(e.target.value)} />
                    </Field>
                  </div>
                )}
                {effective && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8 }}>
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{effectiveSentence(effective)}</span>
                    {!signedOff && effective.date === today && ' (if signed off today)'}
                    {decision === 'APPROVED' && arrearsText(effective.arrearsMonths) && <div>{arrearsText(effective.arrearsMonths)}</div>}
                  </div>
                )}
              </div>
            )}
            <Field label="Comments">
              <TextArea value={text.approvalComment} disabled={!can('approvalComment') || busy} onChange={setT('approvalComment')} maxLength={5000} />
            </Field>
            <Signature view={view} step="FINAL_APPROVAL" />
          </Card>
        </div>

        <div style={{ flex: '0 1 320px', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AppraisalDatesCard view={view} busy={busy} onSave={saveDates} />

          <Card title="Total marks">
            {total == null ? (
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Nothing rated yet.</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 34, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                  {total}
                  <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--text-muted)' }}> / 100</span>
                </div>
                <GradeBadge grade={grade} size="sm" />
              </div>
            )}
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6 }}>
              {!signedOff && live.rated < keys.length && `${live.rated} of ${keys.length} criteria rated; the grade appears once all are rated.`}
              {policy && (
                <>
                  <div style={{ color: 'var(--text)', fontWeight: 500 }}>{policyLine(policy)}</div>
                  <div>{policy.proposal}.</div>
                </>
              )}
            </div>
            {dirty && !signedOff && <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 6 }}>Unsaved changes are included above; save to keep them.</div>}
          </Card>

          <Card
            title="KPI score (reference)"
            subtitle="Not part of the 100 marks."
            action={
              kpi && !signedOff && cycleOpen ? (
                <Button size="sm" icon={<RefreshCw size={12} />} loading={m.refreshKpis.isPending} disabled={busy} onClick={onRefreshKpis}>
                  Refresh
                </Button>
              ) : undefined
            }
          >
            {kpi ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {kpi.overall.score ?? '—'}
                  <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}> / 100</span>
                  {kpi.overall.partial && (
                    <span style={{ marginLeft: 8 }} title="Not linked to ClickUp: the work KPIs are missing.">
                      <Pill tone="gray" size="xs">
                        Partial
                      </Pill>
                    </span>
                  )}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                  <tbody>
                    {KPI_ROWS.map(({ key, label }) => {
                      const k = kpi.kpis[key];
                      return (
                        <tr key={key}>
                          <td style={{ ...td, padding: '6px 4px' }}>{label}</td>
                          <td style={{ ...td, padding: '6px 4px', color: k.value == null ? 'var(--text-muted)' : undefined }}>{kpiActual(k)}</td>
                          <td style={{ ...td, padding: '6px 4px' }}>
                            {k.score == null ? '—' : (
                              <Pill tone={k.status === 'no-data' ? 'gray' : bandTone(k.status)} size="xs">
                                {k.score}
                              </Pill>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 6 }}>
                  {formatDate(kpi.period.from)} – {formatDate(kpi.period.to)}, computed {formatDate(kpi.computedAt.slice(0, 10))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Computed from tracked work and attendance when the appraisal reaches the supervisor.</div>
            )}
          </Card>

          <Card title="Previous appraisals">
            {view.previous.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No other appraisals for {view.employee.fullName}.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {view.previous.map((p) => (
                  <Link
                    key={p.id}
                    to={`/people/appraisals/${p.id}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '7px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 13 }}
                  >
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>{p.cycleName}</span>
                      <ScoreCell score={p.score} />
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      <OutcomeCell mode={p.scoringMode} recommendation={p.recommendation} actions={p.actions} decision={p.approvalDecision} designation={p.newDesignation} />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
