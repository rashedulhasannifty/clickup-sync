/** Hover and focus rules for `ChoiceCard`; render once per surface that uses the cards. */
export const CHOICE_CARD_CSS = `
  .cy-choice:hover { border-color: var(--border-strong); }
  .cy-choice:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
`;

/** One choice in a group of cards (radio semantics), with a one-line explanation under its name. */
export function ChoiceCard({
  name, checked, title, hint, badge, disabled, onSelect,
}: {
  name: string;
  checked: boolean;
  title: string;
  hint: string;
  badge?: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className="cy-choice"
      style={{
        position: 'relative', display: 'flex', gap: 10, alignItems: 'flex-start', cursor: disabled ? 'default' : 'pointer',
        padding: '11px 12px', borderRadius: 'var(--radius)',
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
        background: checked ? 'var(--selected-bg)' : 'var(--surface)',
        boxShadow: checked ? '0 0 0 3px var(--accent-soft)' : undefined,
        opacity: disabled && !checked ? 0.6 : 1,
        transition: 'border-color 120ms, background 120ms',
      }}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
      <span
        aria-hidden
        style={{
          marginTop: 2, width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
          border: checked ? '5px solid var(--accent)' : '1.5px solid var(--border-strong)', background: 'var(--surface)',
          transition: 'border 120ms',
        }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {title}
          {badge && (
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--accent-strong)', background: 'var(--accent-soft)', borderRadius: 999, padding: '1px 7px' }}>
              {badge}
            </span>
          )}
        </span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>{hint}</span>
      </span>
    </label>
  );
}
