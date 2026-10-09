import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, RefreshCw, Save, Undo2 } from 'lucide-react';
import type { AppraisalView, EditableField, Recommendation, UpdateAppraisalBody } from '../api/appraisals';
import type { KpiResult, ScoredKpi } from '../api/people';
import { useAppraisal, useAppraisalMutations } from '../hooks/useAppraisals';
import { APPRAISAL_STATUS_LABEL, RECOMMENDATIONS, RECOMMENDATION_LABEL, STATUS_STEPS, td, th } from '../lib/appraisals';
import { bandTone, formatDate } from '../lib/people';
import { PageHeader } from '../components/ui/PageHeader';
import { PageSkeleton } from '../components/ui/PageSkeleton';
import { QueryError } from '../components/ui/QueryError';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { Pill } from '../components/ui/Pill';
import { useToast } from '../components/ui/Toast';
import { AppraisalStatusPill, RecommendationText, ScoreCell } from '../components/people/AppraisalBits';
import { HeaderActions, TextArea } from '../components/people/FormBits';

const KPI_ROWS: { key: ScoredKpi; label: string }[] = [
  { key: 'utilisation', label: 'Utilisation' },
  { key: 'chargeable', label: 'Chargeable' },
  { key: 'onTimeDelivery', label: 'On-time delivery' },
  { key: 'punctuality', label: 'Punctuality' },
];

const NEXT_LABEL: Record<string, string> = {
  SELF_REVIEW: 'Submit to lead review',
  LEAD_REVIEW: 'Send to calibration',
  CALIBRATION: 'Sign off & apply outcome',
};

function Stepper({ status }: { status: AppraisalView['status'] }) {
  const current = STATUS_STEPS.indexOf(status);
  return (
    <div role="list" aria-label="Appraisal progress" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
      {STATUS_STEPS.map((s, i) => {
        const done = i < current || status === 'SIGNED_OFF';
        const cur = i === current && status !== 'SIGNED_OFF';
        return (
          <span
            key={s}
            role="listitem"
            aria-current={cur ? 'step' : undefined}
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
            {APPRAISAL_STATUS_LABEL[s]}
          </span>
        );
      })}
    </div>
  );
}

function RatingPicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'inline-flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value === n;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(n)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              fontSize: 12.5,
              cursor: disabled ? 'default' : 'pointer',
              border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
              background: on ? 'var(--accent)' : 'transparent',
              color: on ? '#fff' : 'var(--text-muted)',
              opacity: disabled && !on ? 0.55 : 1,
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function kpiActual(k: KpiResult): string {
  if (k.value != null) return `${k.value}%`;
  return k.reason === 'not-linked' ? 'Not linked to ClickUp' : 'No data';
}

function kpiScoreTone(k: KpiResult) {
  return k.status === 'no-data' ? 'gray' : bandTone(k.status);
}

function mean(map: Record<string, number>): number | null {
  const v = Object.values(map);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Draft state seeded once from the saved view; the parent remounts it (via `key`) when the saved view changes. */
function AppraisalForm({ view }: { view: AppraisalView }) {
  const toast = useToast();
  const m = useAppraisalMutations(view.id);

  const [selfRatings, setSelfRatings] = useState(view.selfRatings);
  const [leadRatings, setLeadRatings] = useState(view.leadRatings);
  const [text, setText] = useState({
    selfComment: view.selfComment ?? '',
    leadComment: view.leadComment ?? '',
    strengths: view.strengths ?? '',
    improvements: view.improvements ?? '',
    goals: view.goals ?? '',
    calibrationNote: view.calibrationNote ?? '',
    newDesignation: view.newDesignation ?? '',
    calibratedScore: view.calibratedScore == null ? '' : String(view.calibratedScore),
  });
  const [recommendation, setRecommendation] = useState<Recommendation | null>(view.recommendation);
  const [formError, setFormError] = useState('');

  const can = (f: EditableField) => view.editableFields.includes(f);
  const signedOff = view.status === 'SIGNED_OFF';
  const cycleOpen = view.cycle.status === 'OPEN';

  /** Only the editable fields that differ from what is saved. */
  function changes(): UpdateAppraisalBody | { error: string } {
    const body: UpdateAppraisalBody = {};
    const sameMap = (a: Record<string, number>, b: Record<string, number>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
    if (can('selfRatings') && !sameMap(selfRatings, view.selfRatings)) body.selfRatings = selfRatings;
    if (can('leadRatings') && !sameMap(leadRatings, view.leadRatings)) body.leadRatings = leadRatings;
    for (const f of ['selfComment', 'leadComment', 'strengths', 'improvements', 'goals', 'calibrationNote', 'newDesignation'] as const) {
      if (can(f) && text[f].trim() !== (view[f] ?? '')) body[f] = text[f].trim() || null;
    }
    if (can('recommendation') && recommendation !== view.recommendation) body.recommendation = recommendation;
    if (can('calibratedScore')) {
      const raw = text.calibratedScore.trim();
      const next = raw === '' ? null : Number(raw);
      if (next !== null && (!Number.isFinite(next) || next < 0 || next > 5)) return { error: 'The calibrated score must be between 0 and 5.' };
      if (next !== view.calibratedScore) body.calibratedScore = next === null ? null : Math.round(next * 10) / 10;
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

  // Refreshing remounts the form with the server's view (its key includes
  // updatedAt), which would throw away unsaved edits — so save them first,
  // exactly as Advance does.
  async function onRefreshKpis() {
    if (!(await save())) return;
    try {
      await m.refreshKpis.mutateAsync();
    } catch {
      // surfaced through `error` above
    }
  }

  async function onAdvance() {
    if (view.status === 'CALIBRATION' && !window.confirm('Sign off this appraisal? It becomes read-only and the recommendation is applied to the employee’s record.')) return;
    if (!(await save())) return;
    try {
      await m.advance.mutateAsync();
      toast.success(view.status === 'CALIBRATION' ? 'Signed off' : 'Moved to the next step');
    } catch {
      /* the mutation error is shown inline */
    }
  }

  const selfAvg = mean(view.selfRatings);
  const score = view.score;

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
        badge={<AppraisalStatusPill status={view.status} />}
        description={`${view.employee.fullName} · ${view.employee.designation} · review period ${formatDate(view.cycle.periodStart)} – ${formatDate(view.cycle.periodEnd)}${view.reviewerName ? ` · reviewer ${view.reviewerName}` : ''}`}
        actions={
          !signedOff && cycleOpen ? (
            <HeaderActions>
              {view.canSendBack && (
                <Button icon={<Undo2 size={13} />} loading={m.sendBack.isPending} disabled={busy} onClick={() => m.sendBack.mutate()}>
                  Send back
                </Button>
              )}
              <Button icon={<Save size={13} />} loading={m.save.isPending} disabled={busy || !dirty} onClick={onSave}>
                Save
              </Button>
              <Button
                variant="accent"
                icon={<Check size={13} />}
                loading={m.advance.isPending}
                disabled={busy || (!dirty && blockers.length > 0)}
                onClick={onAdvance}
              >
                {NEXT_LABEL[view.status]}
              </Button>
            </HeaderActions>
          ) : undefined
        }
      />

      <Stepper status={view.status} />

      {error && (
        <div style={{ marginBottom: 12 }}>
          <Callout tone="error">{error}</Callout>
        </div>
      )}
      {!cycleOpen && (
        <div style={{ marginBottom: 12 }}>
          <Callout tone="warning">This cycle is {view.cycle.status.toLowerCase()}, so its appraisals are read-only. Reopen it from the Appraisals page to make changes.</Callout>
        </div>
      )}
      {signedOff && !view.outcomeApplied && (
        <div style={{ marginBottom: 12 }}>
          <Callout tone="warning">
            Signed off, but the recommendation hasn’t been written to the employee’s record yet.{' '}
            <Button size="sm" loading={m.advance.isPending} onClick={() => m.advance.mutate()}>
              Retry
            </Button>
          </Callout>
        </div>
      )}
      {!signedOff && cycleOpen && !dirty && blockers.length > 0 && view.status !== 'SELF_REVIEW' && (
        <div style={{ marginBottom: 12 }}>
          <Callout tone="info">To move on: {blockers.join(' · ')}.</Callout>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            title="Section A · KPI results"
            subtitle={
              view.kpiSnapshot
                ? `Computed ${formatDate(view.kpiSnapshot.computedAt.slice(0, 10))} for ${formatDate(view.kpiSnapshot.period.from)} – ${formatDate(view.kpiSnapshot.period.to)} · read-only`
                : 'Computed from tracked work and attendance when the appraisal enters lead review'
            }
            action={
              view.kpiSnapshot && !signedOff && cycleOpen ? (
                <Button size="sm" icon={<RefreshCw size={12} />} loading={m.refreshKpis.isPending} disabled={busy} onClick={onRefreshKpis}>
                  Refresh
                </Button>
              ) : undefined
            }
          >
            {view.kpiSnapshot ? (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>KPI</th>
                        <th style={th}>Target</th>
                        <th style={th}>Actual</th>
                        <th style={th}>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {KPI_ROWS.map(({ key, label }) => {
                        const k = view.kpiSnapshot!.kpis[key];
                        return (
                          <tr key={key}>
                            <td style={td}>{label}</td>
                            <td style={td}>{k.target}%</td>
                            <td style={{ ...td, color: k.value == null ? 'var(--text-muted)' : undefined }}>{kpiActual(k)}</td>
                            <td style={td}>
                              {k.score == null ? (
                                '—'
                              ) : (
                                <Pill tone={kpiScoreTone(k)} size="xs">
                                  {k.score}
                                </Pill>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
                  Overall KPI score {view.kpiSnapshot.overall.score ?? '—'}/100
                  {view.kpiSnapshot.overall.partial && ' · Partial: the employee isn’t linked to ClickUp, so the work KPIs are missing'}.
                </p>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No KPI snapshot yet.</p>
            )}
          </Card>

          <Card title="Section B · Competencies" subtitle="Rated 1–5. The score uses the lead’s ratings.">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Competency</th>
                    <th style={th}>Self</th>
                    <th style={th}>Lead</th>
                  </tr>
                </thead>
                <tbody>
                  {view.cycle.competencies.map((c) => (
                    <tr key={c.key}>
                      <td style={td}>{c.label}</td>
                      <td style={td}>
                        <RatingPicker
                          label={`Self rating: ${c.label}`}
                          value={selfRatings[c.key]}
                          disabled={!can('selfRatings') || busy}
                          onChange={(v) => setSelfRatings({ ...selfRatings, [c.key]: v })}
                        />
                      </td>
                      <td style={td}>
                        <RatingPicker
                          label={`Lead rating: ${c.label}`}
                          value={leadRatings[c.key]}
                          disabled={!can('leadRatings') || busy}
                          onChange={(v) => setLeadRatings({ ...leadRatings, [c.key]: v })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Section C · Comments & goals">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Employee’s self review comment">
                <TextArea value={text.selfComment} disabled={!can('selfComment') || busy} onChange={(e) => setText({ ...text, selfComment: e.target.value })} maxLength={5000} />
              </Field>
              <Field label="Lead’s comment">
                <TextArea value={text.leadComment} disabled={!can('leadComment') || busy} onChange={(e) => setText({ ...text, leadComment: e.target.value })} maxLength={5000} />
              </Field>
              <Field label="Strengths">
                <TextArea value={text.strengths} disabled={!can('strengths') || busy} onChange={(e) => setText({ ...text, strengths: e.target.value })} maxLength={5000} />
              </Field>
              <Field label="Areas to improve">
                <TextArea value={text.improvements} disabled={!can('improvements') || busy} onChange={(e) => setText({ ...text, improvements: e.target.value })} maxLength={5000} />
              </Field>
              <Field label="Goals for next period">
                <TextArea value={text.goals} disabled={!can('goals') || busy} onChange={(e) => setText({ ...text, goals: e.target.value })} maxLength={5000} />
              </Field>
            </div>
          </Card>

          <Card title="Section D · Recommendation" subtitle="Applied to the employee’s record when the appraisal is signed off.">
            <div role="group" aria-label="Recommendation" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {RECOMMENDATIONS.map((r) => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  variant={recommendation === r ? 'primary' : 'default'}
                  aria-pressed={recommendation === r}
                  disabled={!can('recommendation') || busy}
                  onClick={() => setRecommendation(recommendation === r ? null : r)}
                >
                  {RECOMMENDATION_LABEL[r]}
                </Button>
              ))}
            </div>
            {recommendation === 'PROMOTE' && (
              <Field label="New designation" required hint={`Currently ${view.employee.designation}. Promotion updates it at sign-off.`}>
                <Input
                  value={text.newDesignation}
                  disabled={!can('newDesignation') || busy}
                  maxLength={200}
                  placeholder="e.g. Senior Developer"
                  onChange={(e) => setText({ ...text, newDesignation: e.target.value })}
                />
              </Field>
            )}
          </Card>

          {(view.status === 'CALIBRATION' || signedOff) && (
            <Card title="Section E · Calibration" subtitle="Optional. A calibrated score replaces the computed one.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Calibration note">
                  <TextArea value={text.calibrationNote} disabled={!can('calibrationNote') || busy} onChange={(e) => setText({ ...text, calibrationNote: e.target.value })} maxLength={5000} />
                </Field>
                <Field label="Calibrated score (0–5)" hint={score.computed != null ? `Computed score is ${score.computed.toFixed(1)}. Leave empty to keep it.` : 'Leave empty to keep the computed score.'}>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={text.calibratedScore}
                    disabled={!can('calibratedScore') || busy}
                    onChange={(e) => setText({ ...text, calibratedScore: e.target.value })}
                    style={{ maxWidth: 140 }}
                  />
                </Field>
              </div>
            </Card>
          )}
        </div>

        <div style={{ flex: '0 1 320px', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Weighted score">
            {score.final == null ? (
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Nothing to score yet.</div>
            ) : (
              <>
                <div style={{ fontSize: 34, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                  {score.final.toFixed(1)}
                  <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--text-muted)' }}> / 5</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
                  {score.partial && (
                    <span title="The employee isn’t linked to ClickUp (or has no KPI data), so the KPI half rests on less data.">
                      <Pill tone="gray" size="xs">
                        Partial
                      </Pill>
                    </span>
                  )}
                  {score.calibrated && (
                    <Pill tone="purple" size="xs">
                      Calibrated{score.computed != null ? ` · computed ${score.computed.toFixed(1)}` : ''}
                    </Pill>
                  )}
                </div>
              </>
            )}
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              KPI {score.kpiWeight}% · Competencies {100 - score.kpiWeight}%
              {score.kpiPart != null && <div>KPI part {score.kpiPart.toFixed(2)} / 5</div>}
              {score.competencyPart != null && <div>Competency part {score.competencyPart.toFixed(2)} / 5</div>}
            </div>
            {!dirty ? null : <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 6 }}>Save to update the score.</div>}
          </Card>

          <Card title="Employee’s self review">
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {selfAvg == null ? 'No self ratings yet.' : `Self score ${selfAvg.toFixed(1)} / 5`}
              {view.selfComment && <div style={{ marginTop: 6, color: 'var(--text)' }}>“{view.selfComment}”</div>}
            </div>
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
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 13 }}
                  >
                    <span>{p.cycleName}</span>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: 'var(--text-muted)' }}>
                      <ScoreCell score={p.score} />
                      <RecommendationText value={p.recommendation} />
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

/** `/people/appraisals/:appraisalId`: the review form for one employee in one cycle. */
export function AppraisalFormPage() {
  const { appraisalId } = useParams<{ appraisalId: string }>();
  const query = useAppraisal(appraisalId);

  if (query.isLoading) return <PageSkeleton />;
  if (query.isError || !query.data) return <QueryError query={query} what="appraisal" />;

  // Remount on every saved change so the draft re-seeds from the server's view.
  return <AppraisalForm key={`${query.data.id}:${query.data.updatedAt}:${query.data.status}`} view={query.data} />;
}
