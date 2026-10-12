import type {
  AppraisalAction,
  AppraisalStatus,
  AppraisalType,
  Competency,
  CycleStatus,
  FormGrade,
  GradePolicy,
  Recommendation,
  ScoreView,
  ScoringMode,
} from '../api/appraisals';
import type { PillTone } from './people';

/** KPI_BLEND (legacy) steps. Use `stepsFor(mode)` for a specific cycle. */
export const STATUS_STEPS: AppraisalStatus[] = ['SELF_REVIEW', 'LEAD_REVIEW', 'CALIBRATION', 'SIGNED_OFF'];

/** FORM_100 steps: the paper form's signatures in order (mirrors the server). */
export const FORM_STEPS: AppraisalStatus[] = [
  'SELF_REVIEW',
  'LEAD_REVIEW',
  'DEPT_HEAD_REVIEW',
  'HR_REVIEW',
  'FINAL_APPROVAL',
  'SIGNED_OFF',
];

export function stepsFor(mode: ScoringMode): AppraisalStatus[] {
  return mode === 'FORM_100' ? FORM_STEPS : STATUS_STEPS;
}

export const APPRAISAL_STATUS_LABEL: Record<AppraisalStatus, string> = {
  SELF_REVIEW: 'Self review',
  LEAD_REVIEW: 'Lead review',
  CALIBRATION: 'Calibration',
  DEPT_HEAD_REVIEW: 'Department head',
  HR_REVIEW: 'HR review',
  FINAL_APPROVAL: 'CTO/COO approval',
  SIGNED_OFF: 'Signed off',
};

/** On the paper form the lead review is the supervisor's. */
export function statusLabel(s: AppraisalStatus, mode: ScoringMode): string {
  return mode === 'FORM_100' && s === 'LEAD_REVIEW' ? 'Supervisor review' : APPRAISAL_STATUS_LABEL[s];
}

export function appraisalStatusTone(s: AppraisalStatus): PillTone {
  switch (s) {
    case 'SIGNED_OFF':
      return 'green';
    case 'CALIBRATION':
    case 'FINAL_APPROVAL':
      return 'purple';
    case 'LEAD_REVIEW':
    case 'DEPT_HEAD_REVIEW':
    case 'HR_REVIEW':
      return 'blue';
    default:
      return 'gray';
  }
}

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = { DRAFT: 'Draft', OPEN: 'Open', CLOSED: 'Closed' };

export function cycleStatusTone(s: CycleStatus): PillTone {
  return s === 'OPEN' ? 'green' : s === 'CLOSED' ? 'gray' : 'amber';
}

export const APPRAISAL_TYPE_LABEL: Record<AppraisalType, string> = {
  HALF_YEARLY: 'Half yearly',
  CONFIRMATION: 'Confirmation',
  YEARLY: 'Yearly',
};

export const SCORING_MODE_LABEL: Record<ScoringMode, string> = {
  FORM_100: 'Paper form (100 marks, A–F)',
  KPI_BLEND: 'KPI blend (legacy, 0–5)',
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  PROMOTE: 'Promote',
  RAISE: 'Salary increase',
  NO_CHANGE: 'No change',
  IMPROVEMENT_PLAN: 'Improvement plan',
};

export const RECOMMENDATIONS: Recommendation[] = ['PROMOTE', 'RAISE', 'NO_CHANGE', 'IMPROVEMENT_PLAN'];

export const ACTION_LABEL: Record<AppraisalAction, string> = {
  CONFIRM: 'Confirm',
  INCREMENT: 'Increment',
  PROMOTION: 'Promotion',
  TERMINATION: 'Termination',
  DISMISSAL: 'Dismissal',
  TRAINING_TRANSFER: 'Training / Transfer',
};

export const ACTIONS: AppraisalAction[] = ['CONFIRM', 'INCREMENT', 'PROMOTION', 'TERMINATION', 'DISMISSAL', 'TRAINING_TRANSFER'];

/** The form's rating scale (mirrors FORM_RATINGS on the server). */
export const FORM_RATINGS: { value: number; label: string }[] = [
  { value: 10, label: 'Outstanding' },
  { value: 8, label: 'Good' },
  { value: 6, label: 'Fair' },
  { value: 4, label: 'Average' },
  { value: 2, label: 'Below Average' },
];

/** The evaluation-metrics table (mirrors GRADE_TABLE on the server), highest band first. */
export const GRADE_TABLE: GradePolicy[] = [
  { grade: 'A', minMarks: 91, maxMarks: 100, promotion: true, incrementMin: 15, incrementMax: 15, training: false, transfer: false, termination: false, proposal: 'Proposed for promotion (eligible if the next position is vacant)' },
  { grade: 'B', minMarks: 81, maxMarks: 90, promotion: false, incrementMin: 13, incrementMax: 14, training: false, transfer: false, termination: false, proposal: 'Proposed for service confirmation' },
  { grade: 'C', minMarks: 71, maxMarks: 80, promotion: false, incrementMin: 11, incrementMax: 12, training: false, transfer: false, termination: false, proposal: 'Proposed for service confirmation' },
  { grade: 'D', minMarks: 61, maxMarks: 70, promotion: false, incrementMin: 9, incrementMax: 10, training: true, transfer: false, termination: false, proposal: 'Proposed for service confirmation' },
  { grade: 'E', minMarks: 51, maxMarks: 60, promotion: false, incrementMin: 7, incrementMax: 8, training: true, transfer: true, termination: false, proposal: 'Proposed for increment with a training plan (extension of probation)' },
  { grade: 'F', minMarks: 0, maxMarks: 50, promotion: false, incrementMin: 0, incrementMax: 0, training: false, transfer: true, termination: true, proposal: 'Proposed for possible transfer with a development plan, or separation' },
];

/** Live total of a draft, exactly as the server computes it: `sum / (10 x n) x 100`, 1 dp; unrated count as 0. */
export function draftFormScore(ratings: Record<string, number>, keys: string[]): { total: number | null; rated: number; grade: FormGrade | null } {
  const vals = keys.map((k) => ratings[k]).filter((v): v is number => typeof v === 'number' && [2, 4, 6, 8, 10].includes(v));
  if (vals.length === 0 || keys.length === 0) return { total: null, rated: 0, grade: null };
  const total = Math.round((vals.reduce((a, b) => a + b, 0) / (10 * keys.length)) * 100 * 10) / 10;
  return { total, rated: vals.length, grade: vals.length === keys.length ? gradeFor(total) : null };
}

export function gradeFor(total: number): FormGrade {
  for (const r of GRADE_TABLE) if (total >= r.minMarks) return r.grade;
  return 'F';
}

export function gradePolicy(g: FormGrade): GradePolicy {
  return GRADE_TABLE.find((r) => r.grade === g) as GradePolicy;
}

export function incrementRange(p: GradePolicy): string {
  if (p.incrementMax === 0) return '0%';
  return p.incrementMin === p.incrementMax ? `${p.incrementMin}%` : `${p.incrementMin}–${p.incrementMax}%`;
}

/** "Proposed: increment 13–14%, service confirmation". */
export function policyLine(p: GradePolicy): string {
  const parts: string[] = [];
  if (p.promotion) parts.push('promotion');
  parts.push(p.incrementMax === 0 ? 'no increment' : `increment ${incrementRange(p)}`);
  if (p.grade === 'B' || p.grade === 'C' || p.grade === 'D') parts.push('service confirmation');
  if (p.training) parts.push('training');
  if (p.transfer) parts.push('transfer');
  if (p.termination) parts.push('termination');
  return `Proposed: ${parts.join(', ')}`;
}

export function gradeTone(g: FormGrade): PillTone {
  return g === 'A' || g === 'B' ? 'green' : g === 'C' ? 'blue' : g === 'D' ? 'amber' : 'red';
}

/** "4.2 / 5", "82 / 100 · B", or an em dash when there is nothing to score. */
export function scoreText(s: ScoreView): string {
  if (s.final == null) return '—';
  if (s.mode === 'FORM_100') return `${s.final} / 100${s.grade ? ` · ${s.grade}` : ''}`;
  return `${s.final.toFixed(1)} / 5${s.partial ? ' · Partial' : ''}`;
}

/** The default competencies a new legacy cycle starts with (mirrors the server defaults). */
export const DEFAULT_COMPETENCIES: Competency[] = [
  { key: 'technical_skill', label: 'Technical skill' },
  { key: 'communication', label: 'Communication & collaboration' },
  { key: 'ownership', label: 'Ownership & initiative' },
  { key: 'mentoring', label: 'Mentoring' },
];

/** The paper form's 10 criteria, descriptions verbatim (mirrors FORM_CRITERIA on the server). */
export const FORM_CRITERIA: Competency[] = [
  {
    key: 'job_knowledge',
    label: 'Job Knowledge',
    description:
      "Possess adequate knowledge for performing the job effectively & efficiently. It measures one's mastery of the concepts needed to perform certain work. Job knowledge is a complex concept that includes elements of both ability (capacity to learn) and seniority (opportunity to learn).",
  },
  {
    key: 'customer_orientation',
    label: 'Customer Orientation',
    description:
      'Is focused on identifying and meeting customer needs. Acts to establish a successful long-term business partnership with internal and external customers.',
  },
  {
    key: 'decision_making',
    label: 'Decision Making',
    description:
      'Makes timely and appropriate choices based on accurate analysis and experience. Uses sound judgment even in conditions of uncertainty. Anticipates the impact of decisions and plans on how to manage risk.',
  },
  {
    key: 'planning_organizing',
    label: 'Planning and Organizing',
    description:
      'Set clear and realistic goals and objectives. Establishes a course of action and a sequence of steps to ensure that objectives are efficiently achieved. Structured with good personal organization. Schedules time effectively and use efficient work methods and tools.',
  },
  {
    key: 'building_leading_teams',
    label: 'Building and Leading Teams',
    description:
      'Knows the needs (strengths & weaknesses) of the team member. Encourages effective cooperation among team members and between teams. Inspires team spirit and the commitment to achieve high standards of performance.',
  },
  {
    key: 'developing_people',
    label: 'Developing People',
    description:
      "Facilitates the development of others through personal involvement in coaching & mentoring. Creates an environment that fosters learning, growth and development to improve an individual's capability to achieve the business object.",
  },
  {
    key: 'communication',
    label: 'Communication',
    description:
      'Provides both verbal and written information in a timely, clear and concise manner. Expresses ideas effectively, adjusting style, tools and mode to the needs of others. Listens attentively, and summarizes or asks questions to clarify information when needed.',
  },
  {
    key: 'influencing',
    label: 'Influencing',
    description:
      "Persuades others with the value of an approach or idea. Gains spontaneous commitment and support of others in achieving the company's strategic goals.",
  },
  {
    key: 'commitment_to_excel',
    label: 'Commitment to Excel',
    description:
      'Challenges self and others to exceed standards and achieve extraordinary results, striving for the best in a similar group.',
  },
  {
    key: 'integrity',
    label: 'Integrity',
    description:
      'Strict adherence to moral code, reflected in transparent honesty and complete harmony in what one thinks, says, and does. Displays extremely high standards of ethical conduct and can coach and counsel others on the impact of violating these.',
  },
];

/** "3 yrs 4 mos". */
export function monthsText(m: number | null): string {
  if (m == null) return '—';
  const y = Math.floor(m / 12);
  const r = m % 12;
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} yr${y === 1 ? '' : 's'}`);
  if (r > 0 || y === 0) parts.push(`${r} mo${r === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** "BDT 85,000". */
export function takaText(n: number | null): string {
  return n == null ? '—' : `BDT ${n.toLocaleString('en-US')}`;
}

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const parts = (ymd: string) => ({ y: Number(ymd.slice(0, 4)), m0: Number(ymd.slice(5, 7)) - 1, d: Number(ymd.slice(8, 10)) });

/** `15 Oct` from a `YYYY-MM-DD` date. */
export function dayMonth(ymd: string): string {
  const p = parts(ymd);
  return `${p.d} ${MONTHS[p.m0]}`;
}

/**
 * A compact inclusive range: `1–31 Oct 2026`, `15 Apr – 14 Oct 2026`,
 * `15 Oct 2025 – 14 Apr 2026`.
 */
export function dateRangeText(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m0]} ${a.y} – ${b.d} ${MONTHS[b.m0]} ${b.y}`;
  if (a.m0 !== b.m0) return `${a.d} ${MONTHS[a.m0]} – ${b.d} ${MONTHS[b.m0]} ${b.y}`;
  return a.d === b.d ? `${a.d} ${MONTHS[a.m0]} ${a.y}` : `${a.d}–${b.d} ${MONTHS[b.m0]} ${b.y}`;
}

const ymd = (y: number, m0: number, d: number) => `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDayOf = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export type WindowPreset = { key: string; label: string; name: string; start: string; end: string };

/**
 * Quick picks for a join-date cycle's "due between" window, from today's Dhaka
 * date: this month, next month and this quarter. Each also names the cycle.
 */
export function dueWindowPresets(today: string): WindowPreset[] {
  const { y, m0 } = parts(today);
  const month = (yy: number, mm0: number, key: string, label: string): WindowPreset => ({
    key,
    label,
    name: `${MONTHS_LONG[mm0]} ${yy} appraisals`,
    start: ymd(yy, mm0, 1),
    end: ymd(yy, mm0, lastDayOf(yy, mm0)),
  });
  const nextY = m0 === 11 ? y + 1 : y;
  const nextM0 = (m0 + 1) % 12;
  const q = Math.floor(m0 / 3);
  const qStart = q * 3;
  return [
    month(y, m0, 'this-month', `This month (${MONTHS_LONG[m0]} ${y})`),
    month(nextY, nextM0, 'next-month', `Next month (${MONTHS_LONG[nextM0]})`),
    {
      key: 'this-quarter',
      label: `This quarter (Q${q + 1})`,
      name: `Q${q + 1} ${y} appraisals`,
      start: ymd(y, qStart, 1),
      end: ymd(y, qStart + 2, lastDayOf(y, qStart + 2)),
    },
  ];
}

/** "Half-yearly", "Confirmation", "Yearly" as a phrase: "Half-yearly due 15 Oct 2026". */
export const APPRAISAL_TYPE_PHRASE: Record<AppraisalType, string> = {
  HALF_YEARLY: 'Half-yearly',
  CONFIRMATION: 'Confirmation',
  YEARLY: 'Yearly',
};
