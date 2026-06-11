import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  error?: string;
}

export function Input({ icon, error, className = '', ...props }: InputProps) {
  return (
    <div className="relative">
      {icon && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none">{icon}</span>}
      <input
        {...props}
        className={`w-full bg-[var(--surface)] border ${error ? 'border-[var(--red)]' : 'border-[var(--border)]'} text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors ${className}`}
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
      {error && <p className="mt-1 text-xs text-[var(--red)]">{error}</p>}
    </div>
  );
}
