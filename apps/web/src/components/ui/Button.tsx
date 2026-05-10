import React from 'react';

type Variant = 'default' | 'primary' | 'accent' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantStyles: Record<Variant, string> = {
  default: 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]',
  primary: 'bg-[var(--text)] text-white border border-transparent hover:opacity-90',
  accent: 'bg-[var(--accent)] text-white border border-transparent hover:bg-[var(--accent-hover)]',
  ghost: 'bg-transparent border border-transparent text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]',
  danger: 'bg-[var(--red)] text-white border border-transparent hover:opacity-90',
  subtle: 'bg-[var(--muted-bg)] border border-transparent text-[var(--text-muted)] hover:bg-[var(--border)]',
};

const sizeStyles: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs rounded-[var(--radius-sm)] gap-1',
  md: 'px-3 py-1.5 text-sm rounded-[var(--radius)] gap-1.5',
  lg: 'px-4 py-2 text-sm rounded-[var(--radius)] gap-2',
};

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium transition-colors ${variantStyles[variant]} ${sizeStyles[size]} disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : icon}
      {children}
    </button>
  );
}
