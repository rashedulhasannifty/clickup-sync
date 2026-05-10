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
        className={`w-full bg-[var(--surface)] border ${error ? 'border-[var(--red)]' : 'border-[var(--border)]'} rounded-[var(--radius)] ${icon ? 'pl-8' : 'pl-3'} pr-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors ${className}`}
      />
      {error && <p className="mt-1 text-xs text-[var(--red)]">{error}</p>}
    </div>
  );
}
