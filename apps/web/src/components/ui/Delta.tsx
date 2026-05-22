import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

interface DeltaProps {
  /** Current-period value. */
  current: number;
  /** Prior-period value. */
  prior: number;
  /** Suffix label, e.g. "30d" → renders "vs prior 30d". */
  rangeLabel: string;
  /**
   * Direction that means "good". Defaults to 'down' — for cost/hours, less
   * is treated as the positive case (green). Callers can flip this for
   * metrics where up is good (e.g. completed-task counts).
   */
  desirable?: 'up' | 'down';
}

// Values within ±2% render as neutral; avoids noise on tiny changes.
const NEUTRAL_THRESHOLD = 0.02;

export function Delta({ current, prior, rangeLabel, desirable = 'down' }: DeltaProps) {
  // No prior data — show "new" or neutral.
  if (prior === 0) {
    if (current === 0) return <Pill icon={<Minus size={11} strokeWidth={2} />} text="—" tone="neutral" suffix={rangeLabel} />;
    return <Pill icon={null} text="new" tone="neutral" suffix={rangeLabel} />;
  }

  const pct = (current - prior) / prior;
  const absPct = Math.abs(pct);

  if (absPct < NEUTRAL_THRESHOLD) {
    return <Pill icon={<Minus size={11} strokeWidth={2} />} text="—" tone="neutral" suffix={rangeLabel} />;
  }

  const isUp = pct > 0;
  const upIsDesirable = desirable === 'up';
  const tone: 'positive' | 'negative' = (isUp === upIsDesirable) ? 'positive' : 'negative';
  const icon = isUp ? <ArrowUp size={11} strokeWidth={2} /> : <ArrowDown size={11} strokeWidth={2} />;
  const text = `${(absPct * 100).toFixed(1)}%`;

  return <Pill icon={icon} text={text} tone={tone} suffix={rangeLabel} />;
}

const TONES: Record<'positive' | 'negative' | 'neutral', { fg: string; bg: string }> = {
  positive: { fg: 'var(--green)',      bg: 'var(--pill-green-bg)' },
  negative: { fg: 'var(--red)',        bg: 'var(--pill-red-bg)' },
  neutral:  { fg: 'var(--text-muted)', bg: 'transparent' },
};

function Pill({
  icon, text, tone, suffix,
}: {
  icon: React.ReactNode;
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
  suffix: string;
}) {
  const { fg, bg } = TONES[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          padding: '1px 5px',
          borderRadius: 4,
          background: bg,
          color: fg,
          fontWeight: 600,
        }}
      >
        {icon}
        {text}
      </span>
      <span>vs prior {suffix}</span>
    </span>
  );
}
