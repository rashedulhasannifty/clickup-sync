import React, { useState } from 'react';
import { Eye, EyeOff, Workflow, type LucideIcon } from 'lucide-react';

const inputBase =
  'w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] ' +
  'h-11 pl-10 pr-3 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] ' +
  'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] ' +
  'transition-colors';

/** Page wrapper + branded card + header. Keeps all auth screens consistent. */
export function AuthShell({
  title,
  subtitle,
  icon: Icon = Workflow,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--page-bg)' }}
    >
      <div className="w-full max-w-[400px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-8 sm:p-10 shadow-lg">
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl mb-4 flex items-center justify-center shadow-sm"
            style={{ background: 'var(--accent-grad)' }}
          >
            <Icon size={26} strokeWidth={2} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-[var(--text)] text-center">{title}</h1>
          {subtitle && (
            <p className="text-sm text-[var(--text-muted)] mt-1.5 text-center">{subtitle}</p>
          )}
        </div>
        {children}
        {footer && <div className="mt-7 text-center">{footer}</div>}
      </div>
    </div>
  );
}

/** Labeled text input with a leading icon. */
export function AuthField({
  label,
  icon: Icon,
  hint,
  ...input
}: {
  label: string;
  icon: LucideIcon;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">{label}</label>
      <div className="relative">
        <Icon
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none"
        />
        <input {...input} className={inputBase} />
      </div>
      {hint && <p className="text-xs text-[var(--text-faint)] mt-1.5">{hint}</p>}
    </div>
  );
}

/** Password input with a leading icon and a show/hide toggle. */
export function PasswordField({
  label,
  icon: Icon,
  hint,
  ...input
}: {
  label: string;
  icon: LucideIcon;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">{label}</label>
      <div className="relative">
        <Icon
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none"
        />
        <input {...input} type={show ? 'text' : 'password'} className={`${inputBase} !pr-10`} />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {hint && <p className="text-xs text-[var(--text-faint)] mt-1.5">{hint}</p>}
    </div>
  );
}

/** Full-width primary submit button used across the auth screens. */
export function AuthButton({
  loading,
  children,
  ...rest
}: { loading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={loading || rest.disabled}
      className="w-full h-11 mt-1 text-sm font-semibold text-white rounded-[var(--radius)] transition-all hover:opacity-95 active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100"
      style={{ background: 'var(--accent)' }}
    >
      {children}
    </button>
  );
}

/** Inline error row with consistent styling. */
export function AuthError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-[var(--red)] -mt-1">{message}</p>;
}
