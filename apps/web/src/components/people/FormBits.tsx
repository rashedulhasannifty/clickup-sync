import type { ReactNode, TextareaHTMLAttributes } from 'react';

/** Multi-line input for the People modals (the UI kit has no Textarea). */
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      {...props}
      className="input-3d"
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 10px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--input-bg, var(--surface))',
        color: 'var(--text)',
        fontSize: 13,
        fontFamily: 'inherit',
        resize: 'vertical',
        outline: 'none',
        ...props.style,
      }}
    />
  );
}

/** Columns that fall to one on narrow screens (a modal is as narrow as the viewport). */
export function FormRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 10 }}>
      {children}
    </div>
  );
}
