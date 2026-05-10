import React from 'react';

export function Field({ label, hint, error, required, children }: { label?: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-xs font-medium text-[var(--text-muted)]">
          {label}{required && <span className="text-[var(--red)] ml-0.5">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-[var(--text-faint)]">{hint}</p>}
      {error && <p className="text-xs text-[var(--red)]">{error}</p>}
    </div>
  );
}
