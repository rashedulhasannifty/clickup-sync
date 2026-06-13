import React from 'react';

type Variant = 'default' | 'primary' | 'accent' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'iconSm';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const SIZES: Record<Size, React.CSSProperties> = {
  sm:     { padding: '5px 9px',   fontSize: 12, gap: 5, height: 28 },
  md:     { padding: '7px 12px',  fontSize: 13, gap: 6, height: 32 },
  lg:     { padding: '9px 16px',  fontSize: 13, gap: 6, height: 36 },
  icon:   { padding: 0, width: 32, height: 32, justifyContent: 'center' },
  iconSm: { padding: 0, width: 28, height: 28, justifyContent: 'center' },
};

const VARIANTS: Record<Variant, { bg: string; color: string; border: string }> = {
  default: { bg: 'var(--surface)', color: 'var(--text)',    border: 'var(--border)' },
  primary: { bg: 'var(--text)',    color: 'var(--surface)', border: 'transparent'   },
  accent:  { bg: 'var(--accent)',  color: '#fff',           border: 'transparent'   },
  ghost:   { bg: 'transparent',   color: 'var(--text)',     border: 'transparent'   },
  danger:  { bg: 'transparent',   color: 'var(--red)',      border: 'var(--border)' },
  subtle:  { bg: 'var(--muted-bg)', color: 'var(--text)',   border: 'transparent'   },
};

/** Hover backgrounds aligned with `design/project/components.jsx` Button. */
const HOVER_BG: Record<Variant, string> = {
  default: 'var(--hover)',
  primary: 'var(--text)',
  accent: 'var(--accent-hover)',
  ghost: 'var(--hover)',
  danger: 'rgb(239 68 68 / 0.08)',
  subtle: 'var(--hover)',
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
  onMouseEnter: userMouseEnter,
  onMouseLeave: userMouseLeave,
  ...props
}: ButtonProps) {
  const s = SIZES[size] ?? SIZES.md;
  const v = VARIANTS[variant] ?? VARIANTS.default;
  const hoverBg = HOVER_BG[variant];

  return (
    <button
      {...props}
      disabled={disabled || loading}
      onMouseEnter={(e) => {
        userMouseEnter?.(e);
        if (disabled || loading) return;
        (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
      }}
      onMouseLeave={(e) => {
        userMouseLeave?.(e);
        (e.currentTarget as HTMLButtonElement).style.background = v.bg;
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: 'inherit',
        fontWeight: 500,
        borderRadius: 7,
        border: `1px solid ${v.border}`,
        background: v.bg,
        color: v.color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 100ms, border-color 100ms, opacity 100ms',
        whiteSpace: 'nowrap',
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
