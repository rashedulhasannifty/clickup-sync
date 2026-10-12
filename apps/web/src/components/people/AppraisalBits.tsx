import type {
  AppraisalAction,
  AppraisalStatus,
  AppraisalTiming,
  ApprovalDecision,
  CycleStatus,
  FormGrade,
  Recommendation,
  ScoreView,
  ScoringMode,
} from '../../api/appraisals';
import {
  ACTION_LABEL,
  ACTIONS,
  CYCLE_STATUS_LABEL,
  RECOMMENDATION_LABEL,
  appraisalStatusTone,
  cycleStatusTone,
  gradeTone,
  statusLabel,
  timingLabel,
  timingTone,
} from '../../lib/appraisals';
import { Pill } from '../ui/Pill';

export function AppraisalStatusPill({ status, mode = 'KPI_BLEND' }: { status: AppraisalStatus; mode?: ScoringMode }) {
  return (
    <Pill tone={appraisalStatusTone(status)} size="xs">
      {statusLabel(status, mode)}
    </Pill>
  );
}

export function CycleStatusPill({ status }: { status: CycleStatus }) {
  return (
    <Pill tone={cycleStatusTone(status)} size="xs">
      {CYCLE_STATUS_LABEL[status]}
    </Pill>
  );
}

export function GradeBadge({ grade, size = 'xs' }: { grade: FormGrade | null; size?: 'xs' | 'sm' }) {
  if (!grade) return null;
  return (
    <Pill tone={gradeTone(grade)} size={size}>
      Grade {grade}
    </Pill>
  );
}

export function RecommendationText({ value, designation }: { value: Recommendation | null; designation?: string | null }) {
  if (!value) return <span style={{ color: 'var(--text-faint)' }}>—</span>;
  return (
    <span>
      {RECOMMENDATION_LABEL[value]}
      {value === 'PROMOTE' && designation ? ` → ${designation}` : ''}
    </span>
  );
}

/** FORM_100 recommendations ("Confirm, Increment"), plus the CTO/COO decision once made. */
export function ActionsText({
  actions,
  decision,
  designation,
}: {
  actions: AppraisalAction[];
  decision?: ApprovalDecision | null;
  designation?: string | null;
}) {
  if (actions.length === 0 && !decision) return <span style={{ color: 'var(--text-faint)' }}>—</span>;
  const text = ACTIONS.filter((a) => actions.includes(a))
    .map((a) => (a === 'PROMOTION' && designation ? `Promotion → ${designation}` : ACTION_LABEL[a]))
    .join(', ');
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>{text || '—'}</span>
      {decision && (
        <Pill tone={decision === 'APPROVED' ? 'green' : 'red'} size="xs">
          {decision === 'APPROVED' ? 'Approved' : 'Not approved'}
        </Pill>
      )}
    </span>
  );
}

/** The outcome column of a list: legacy recommendation or the form's recommendations. */
export function OutcomeCell(props: {
  mode: ScoringMode;
  recommendation: Recommendation | null;
  actions: AppraisalAction[];
  decision: ApprovalDecision | null;
  designation?: string | null;
}) {
  return props.mode === 'FORM_100' ? (
    <ActionsText actions={props.actions} decision={props.decision} designation={props.designation} />
  ) : (
    <RecommendationText value={props.recommendation} designation={props.designation} />
  );
}

/**
 * KPI_BLEND: "4.2 / 5", with "Partial" when the KPI half is missing and "Calibrated" when a person overrode it.
 * FORM_100: "82 / 100" and the grade badge.
 */
export function ScoreCell({ score }: { score: ScoreView }) {
  if (score.final == null) return <span style={{ color: 'var(--text-faint)' }}>—</span>;
  if (score.mode === 'FORM_100') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{score.final}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>/ 100</span>
        {score.grade ? (
          <GradeBadge grade={score.grade} />
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            {score.ratedCount} of {score.criteriaCount} rated
          </span>
        )}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{score.final.toFixed(1)}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>/ 5</span>
      {score.partial && (
        <span title="The KPI half is missing or the employee isn't linked to ClickUp, so this score rests on less data.">
          <Pill tone="gray" size="xs">
            Partial
          </Pill>
        </span>
      )}
      {score.calibrated && (
        <Pill tone="purple" size="xs">
          Calibrated
        </Pill>
      )}
    </span>
  );
}

/** On time / early / late against the appraisal's own due date. Nothing for a calendar cycle. */
export function TimingChip({ timing }: { timing: AppraisalTiming | null }) {
  if (!timing) return null;
  return (
    <Pill tone={timingTone(timing)} size="xs">
      {timingLabel(timing)}
    </Pill>
  );
}
