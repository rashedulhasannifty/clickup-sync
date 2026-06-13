import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, CircleCheck } from 'lucide-react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Optional leading icon inside the trigger (design canvas pattern). */
  icon?: ReactNode;
  /** Stretch trigger to parent width (forms / modals). */
  fullWidth?: boolean;
  /** Accessible name for screen readers when there's no visible <label>. */
  ariaLabel?: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder,
  className = '',
  size = 'md',
  disabled,
  icon,
  fullWidth,
  ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const h = size === 'sm' ? 28 : 32;
  const fs = size === 'sm' ? 12 : 13;
  const padL = icon ? (size === 'sm' ? 30 : 32) : 10;

  return (
    <div
      ref={ref}
      className={className}
      style={{ position: 'relative', display: fullWidth ? 'flex' : 'inline-flex', width: fullWidth ? '100%' : undefined, minWidth: fullWidth ? 0 : 80 }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: h,
          padding: `0 28px 0 ${padL}px`,
          fontSize: fs,
          fontWeight: 500,
          background: 'var(--surface)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 7,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          fontFamily: 'inherit',
          outline: 'none',
          whiteSpace: 'nowrap',
          position: 'relative',
          minWidth: fullWidth ? 0 : 80,
          width: fullWidth ? '100%' : undefined,
          transition: 'border-color 120ms',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
      >
        {icon && (
          <span style={{ display: 'flex', color: 'var(--text-muted)', marginRight: -2 }}>{icon}</span>
        )}
        <span
          style={{
            flex: 1,
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: selected ? 'var(--text)' : 'var(--text-muted)',
          }}
        >
          {selected ? selected.label : placeholder ?? '—'}
        </span>
        <span
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            display: 'flex',
            pointerEvents: 'none',
          }}
        >
          <ChevronDown size={14} strokeWidth={2} />
        </span>
      </button>
      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 40,
            minWidth: '100%',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                width: '100%',
                padding: '6px 8px',
                fontSize: 13,
                fontWeight: 500,
                background: opt.value === value ? 'var(--hover)' : 'transparent',
                color: 'var(--text)',
                border: 0,
                borderRadius: 5,
                cursor: 'pointer',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              {opt.label}
              {opt.value === value && <CircleCheck size={14} style={{ flexShrink: 0, color: 'var(--accent)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
