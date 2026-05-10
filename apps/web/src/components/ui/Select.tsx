interface SelectOption { value: string; label: string; }

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Select({ options, value, onChange, placeholder, className = '' }: SelectProps) {
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }} className={className}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          height: 32,
          paddingLeft: 10,
          paddingRight: 24,
          fontSize: 13,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 7,
          color: 'var(--text)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          outline: 'none',
          transition: 'border-color 120ms',
        }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <svg
        style={{ position: 'absolute', right: 6, pointerEvents: 'none', color: 'var(--text-muted)' }}
        width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}
