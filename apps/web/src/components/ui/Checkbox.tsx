import { Check, Minus } from 'lucide-react';

/**
 * The box itself, with no interaction and no semantics: filled accent with a
 * white mark when on/mixed, a strong-bordered empty box when off.
 *
 * Split out from `Checkbox` because the two live in different kinds of host.
 * `Checkbox` IS the control; this one sits *inside* a control that already
 * carries the role and the click — a table row's select button, a
 * `role="option"` row in a listbox — where a second roled element would be
 * invalid markup. Always `aria-hidden`: the host announces the state.
 */
export function CheckboxGlyph({ state }: { state: 'on' | 'off' | 'mixed' }) {
  const filled = state !== 'off';
  return (
    <span
      aria-hidden
      style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        // Transparent, not `--surface`: the box inherits whatever its host row
        // is tinted with. It used to live only on surface-coloured table cells,
        // where the two were indistinguishable — but a highlighted listbox row
        // is `--hover`, and an opaque box would punch a hole in it.
        background: filled ? 'var(--accent)' : 'transparent',
        border: filled ? '1px solid var(--accent)' : '1.5px solid var(--border-strong)',
        boxShadow: filled ? '0 1px 2px rgba(123, 104, 238, 0.45)' : undefined,
        transition: 'background 120ms, border-color 120ms',
      }}
    >
      {state === 'on' && <Check size={11} strokeWidth={3.5} color="#fff" />}
      {state === 'mixed' && <Minus size={11} strokeWidth={3.5} color="#fff" />}
    </span>
  );
}

/** Square tri-state checkbox used in table selection columns. Renders a button
 *  rather than an <input> so the indeterminate state is expressible without a
 *  ref, and stops propagation so ticking a row never opens its drawer. */
export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      style={{
        width: 17,
        height: 17,
        borderRadius: 5,
        flexShrink: 0,
        padding: 0,
        border: `1.5px solid ${checked || indeterminate ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: checked || indeterminate ? 'var(--accent)' : 'transparent',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        cursor: 'pointer',
        transition: 'all 100ms',
      }}
    >
      {checked && <Check size={12} strokeWidth={3} />}
      {indeterminate && !checked && <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1 }} />}
    </button>
  );
}
