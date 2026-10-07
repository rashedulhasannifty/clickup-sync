import type { AppraisalStatus, CycleStatus, Recommendation, ScoreView } from '../api/appraisals';
import type { PillTone } from './people';

export const STATUS_STEPS: AppraisalStatus[] = ['SELF_REVIEW', 'LEAD_REVIEW', 'CALIBRATION', 'SIGNED_OFF'];

export const APPRAISAL_STATUS_LABEL: Record<AppraisalStatus, string> = {
  SELF_REVIEW: 'Self review',
  LEAD_REVIEW: 'Lead review',
  CALIBRATION: 'Calibration',
  SIGNED_OFF: 'Signed off',
};

export function appraisalStatusTone(s: AppraisalStatus): PillTone {
  return s === 'SIGNED_OFF' ? 'green' : s === 'CALIBRATION' ? 'purple' : s === 'LEAD_REVIEW' ? 'blue' : 'gray';
}

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = { DRAFT: 'Draft', OPEN: 'Open', CLOSED: 'Closed' };

export function cycleStatusTone(s: CycleStatus): PillTone {
  return s === 'OPEN' ? 'green' : s === 'CLOSED' ? 'gray' : 'amber';
}

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  PROMOTE: 'Promote',
  RAISE: 'Salary increase',
  NO_CHANGE: 'No change',
  IMPROVEMENT_PLAN: 'Improvement plan',
};

export const RECOMMENDATIONS: Recommendation[] = ['PROMOTE', 'RAISE', 'NO_CHANGE', 'IMPROVEMENT_PLAN'];

/** "4.2 / 5", "4.2 / 5 · Partial", or an em dash when there is nothing to score. */
export function scoreText(s: ScoreView): string {
  if (s.final == null) return '—';
  return `${s.final.toFixed(1)} / 5${s.partial ? ' · Partial' : ''}`;
}

/** The default competencies a new cycle starts with (mirrors the server defaults). */
export const DEFAULT_COMPETENCIES = [
  { key: 'technical_skill', label: 'Technical skill' },
  { key: 'communication', label: 'Communication & collaboration' },
  { key: 'ownership', label: 'Ownership & initiative' },
  { key: 'mentoring', label: 'Mentoring' },
];

/** Table cell styles shared by the appraisal tables. */
export const th = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 11.5,
  fontWeight: 600,
  color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-soft)',
  whiteSpace: 'nowrap',
} as const;

export const td = {
  padding: '9px 10px',
  fontSize: 13,
  borderBottom: '1px solid var(--border-soft)',
  verticalAlign: 'middle',
} as const;
