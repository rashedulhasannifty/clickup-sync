export function Switch({ checked, onChange, disabled, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; ariaLabel?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`switch-3d relative inline-flex w-9 h-5 rounded-full transition-colors focus:outline-none disabled:opacity-50 ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'}`}
    >
      <span className={`inline-block w-4 h-4 bg-white rounded-full shadow transition-transform mt-0.5 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}
