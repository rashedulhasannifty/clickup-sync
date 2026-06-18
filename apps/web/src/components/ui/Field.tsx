import React, { createContext, useContext, useId } from 'react';

interface FieldContextValue {
  /** Stable id for the field's control, wired to the <label htmlFor>. */
  fieldId: string;
  /** Id of the hint/error element, for the control's aria-describedby. */
  descriptionId?: string;
  /** Whether the field is in an error state. */
  invalid?: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Read the surrounding <Field> so a control can self-wire id/aria-describedby. */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

export function Field({ label, hint, error, required, children }: { label?: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode }) {
  const fieldId = useId();
  const descriptionId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldContext.Provider value={{ fieldId, descriptionId, invalid: !!error }}>
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={fieldId} className="text-xs font-medium text-[var(--text-muted)]">
            {label}{required && <span className="text-[var(--red)] ml-0.5">*</span>}
          </label>
        )}
        {children}
        {hint && !error && <p id={`${fieldId}-hint`} className="text-xs text-[var(--text-faint)]">{hint}</p>}
        {error && <p id={`${fieldId}-error`} role="alert" className="text-xs text-[var(--red)]">{error}</p>}
      </div>
    </FieldContext.Provider>
  );
}
