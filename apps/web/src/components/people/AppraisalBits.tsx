import type { AppraisalStatus, CycleStatus, Recommendation, ScoreView } from '../../api/appraisals';
import {
  APPRAISAL_STATUS_LABEL,
  CYCLE_STATUS_LABEL,
  RECOMMENDATION_LABEL,
  appraisalStatusTone,
  cycleStatusTone,
} from '../../lib/appraisals';
import { Pill } from '../ui/Pill';

export function AppraisalStatusPill({ status }: { status: AppraisalStatus }) {
  return (
    <Pill tone={appraisalStatusTone(status)} size="xs">
      {APPRAISAL_STATUS_LABEL[status]}
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

export function RecommendationText({ value, designation }: { value: Recommendation | null; designation?: string | null }) {
  if (!value) return <span style={{ color: 'var(--text-faint)' }}>—</span>;
  return (
    <span>
      {RECOMMENDATION_LABEL[value]}
      {value === 'PROMOTE' && designation ? ` → ${designation}` : ''}
    </span>
  );
}

/** "4.2 / 5", with "Partial" when the KPI half is missing or incomplete and "Calibrated" when a person overrode it. */
export function ScoreCell({ score }: { score: ScoreView }) {
  if (score.final == null) return <span style={{ color: 'var(--text-faint)' }}>—</span>;
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
