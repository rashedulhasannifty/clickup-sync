import React from 'react';

type Variant = 'default' | 'primary' | 'accent' | 'ghost' | 'danger' | 'success' | 'caution' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'iconSm';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

// 3D pressable buttons need a little vertical room for the raised edge and the
// hover-lift, so each size is a touch taller than the old flat heights.
const SIZES: Record<Size, React.CSSProperties> = {
  sm:     { padding: '6px 11px',  fontSize: 12, gap: 6, height: 30 },
  md:     { padding: '8px 14px',  fontSize: 13, gap: 7, height: 34 },
  lg:     { padding: '10px 18px', fontSize: 13, gap: 7, height: 38 },
  icon:   { padding: 0, width: 34, height: 34, justifyContent: 'center' },
  iconSm: { padding: 0, width: 30, height: 30, justifyContent: 'center' },
};

// Each variant maps to a solid (or surface) face, a darker bottom "edge" the
// face sits on, and two glow strengths (rest / hover). Solid intents are theme-
// independent on purpose — bold red/green/amber/accent read on both themes. The
// theme-adaptive faces (primary/default/subtle) pull their edge + glow from CSS
// tokens so they invert with the theme.
interface V {
  bg: string;
  color: string;
  border: string;
  edge: string;
  glow: string;
  glowStrong: string;
  /** Optional hover background (neutral variants only); solids just lift. */
  hover?: string;
}

const VARIANTS: Record<Variant, V> = {
  default: {
    bg: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)',
    edge: 'var(--border-strong)', glow: 'var(--btn-neutral-glow)', glowStrong: 'var(--btn-neutral-glow-strong)',
    hover: 'var(--btn-neutral-hover)',
  },
  primary: {
    bg: 'var(--text)', color: 'var(--surface)', border: '1px solid transparent',
    edge: 'var(--btn-primary-edge)', glow: 'rgba(15,23,42,.34)', glowStrong: 'rgba(15,23,42,.48)',
  },
  accent: {
    bg: 'var(--accent)', color: '#fff', border: '1px solid transparent',
    edge: 'var(--accent-strong)', glow: 'rgba(123,104,238,.32)', glowStrong: 'rgba(123,104,238,.46)',
  },
  ghost: {
    // Transparent face has nothing to raise — it stays flat but still presses
    // (translateY on :active) and tints on hover.
    bg: 'transparent', color: 'var(--text)', border: '1px solid transparent',
    edge: 'transparent', glow: 'transparent', glowStrong: 'transparent',
    hover: 'var(--btn-neutral-hover)',
  },
  danger: {
    bg: '#ef4444', color: '#fff', border: '1px solid transparent',
    edge: '#c33333', glow: 'rgba(239,68,68,.3)', glowStrong: 'rgba(239,68,68,.46)',
  },
  success: {
    bg: '#10b981', color: '#fff', border: '1px solid transparent',
    edge: '#0a8f63', glow: 'rgba(16,185,129,.3)', glowStrong: 'rgba(16,185,129,.46)',
  },
  caution: {
    bg: '#f59e0b', color: '#fff', border: '1px solid transparent',
    edge: '#c47d08', glow: 'rgba(245,158,11,.3)', glowStrong: 'rgba(245,158,11,.46)',
  },
  subtle: {
    bg: 'var(--muted-bg)', color: 'var(--text)', border: '1px solid transparent',
    edge: 'var(--border-strong)', glow: 'rgba(15,23,42,.10)', glowStrong: 'rgba(15,23,42,.18)',
    hover: 'var(--btn-subtle-hover)',
  },
};

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  children,
  disabled,
  style,
  className,
  onMouseEnter: userMouseEnter,
  onMouseLeave: userMouseLeave,
  ...props
}: ButtonProps) {
  const s = SIZES[size] ?? SIZES.md;
  const v = VARIANTS[variant] ?? VARIANTS.default;
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      disabled={isDisabled}
      className={['btn-3d', className].filter(Boolean).join(' ')}
      // Neutral variants tint on hover (solids just lift via the .btn-3d class).
      onMouseEnter={(e) => {
        userMouseEnter?.(e);
        if (isDisabled || !v.hover) return;
        (e.currentTarget as HTMLButtonElement).style.background = v.hover;
      }}
      onMouseLeave={(e) => {
        userMouseLeave?.(e);
        if (!v.hover) return;
        (e.currentTarget as HTMLButtonElement).style.background = v.bg;
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: 'inherit',
        fontWeight: 600,
        borderRadius: 9,
        border: v.border,
        background: v.bg,
        color: v.color,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        // Per-button 3D colors consumed by the .btn-3d class.
        ['--b-edge' as string]: v.edge,
        ['--b-glow' as string]: v.glow,
        ['--b-glow-strong' as string]: v.glowStrong,
        ...s,
        ...style,
      }}
    >
      {loading
        ? <span className="cc-spin" style={{ width: 13, height: 13, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: 999, display: 'inline-block' }} />
        : icon}
      {children}
      {iconRight}
    </button>
  );
}
