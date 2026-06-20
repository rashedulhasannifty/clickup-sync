import React, { useId } from 'react';
import { useFieldContext } from './Field';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  error?: string;
}

export function Input({ icon, error, className = '', id, ...props }: InputProps) {
  const field = useFieldContext();
  const ownErrorId = useId();
  const inputId = id ?? field?.fieldId;
  // Combine the surrounding Field's hint/error description with this input's own
  // inline error (if any) so screen readers announce whatever messaging exists.
  const describedBy = [props['aria-describedby'], field?.descriptionId, error ? ownErrorId : undefined]
    .filter(Boolean)
    .join(' ') || undefined;
  return (
    <div className="relative">
      {icon && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none">{icon}</span>}
      <input
        {...props}
        id={inputId}
        aria-invalid={error || field?.invalid ? true : undefined}
        aria-describedby={describedBy}
        className={`input-3d w-full bg-[var(--surface)] border ${error ? 'border-[var(--red)]' : 'border-[var(--border)]'} text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors ${className}`}
        style={{
          height: 32,
          fontSize: 13,
          borderRadius: 7,
          fontFamily: 'inherit',
          // Padding is set inline, not via Tailwind pl-*/pr-* utilities: the
          // unlayered `* { padding: 0 }` reset in index.css outranks Tailwind's
          // layered utilities in the v4 cascade and would zero them out,
          // overlapping the icon with the placeholder.
          paddingLeft: icon ? 32 : 12,
          paddingRight: 12,
          ...props.style,
        }}
      />
      {error && <p id={ownErrorId} role="alert" className="mt-1 text-xs text-[var(--red)]">{error}</p>}
    </div>
  );
}
