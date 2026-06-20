import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, CircleCheck } from 'lucide-react';
import { useFieldContext } from './Field';

interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
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
  /** Which edge the dropdown menu aligns to. Use 'right' when the trigger sits
   *  at the right edge of its container (e.g. a card's action slot) so the menu
   *  grows inward instead of overflowing the page. Defaults to 'left'. */
  menuAlign?: 'left' | 'right';
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
  menuAlign = 'left',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const field = useFieldContext();
  const listboxId = useId();
  const triggerId = field?.fieldId;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // When the menu opens, seed the active (highlighted) option to the current
  // value so keyboard users land on a sensible starting point.
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    } else {
      setActiveIndex(-1);
    }
  }, [open, value, options]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const selected = options.find((o) => o.value === value);

  function commit(idx: number) {
    const opt = options[idx];
    if (opt) {
      onChange(opt.value);
      setOpen(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }
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
        id={triggerId}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={field?.descriptionId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        // Ignore keyboard-synthesized clicks (detail === 0) — Enter/Space are
        // fully handled in onKeyDown. Otherwise Space (whose click fires on
        // keyup, after our keydown already toggled) would toggle a second time.
        onClick={(e) => { if (e.detail !== 0) !disabled && setOpen((o) => !o); }}
        onKeyDown={onKeyDown}
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
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            color: selected ? 'var(--text)' : 'var(--text-muted)',
          }}
        >
          {selected?.icon}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected ? selected.label : placeholder ?? '—'}</span>
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
          ref={listRef}
          id={listboxId}
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            ...(menuAlign === 'right' ? { right: 0 } : { left: 0 }),
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
          {options.map((opt, idx) => (
            <button
              key={opt.value}
              id={`${listboxId}-opt-${idx}`}
              role="option"
              aria-selected={opt.value === value}
              type="button"
              tabIndex={-1}
              onMouseEnter={() => setActiveIndex(idx)}
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
                background: idx === activeIndex ? 'var(--hover)' : opt.value === value ? 'var(--accent-soft)' : 'transparent',
                color: 'var(--text)',
                border: 0,
                borderRadius: 5,
                cursor: 'pointer',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                {opt.icon}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
              </span>
              {opt.value === value && <CircleCheck size={14} style={{ flexShrink: 0, color: 'var(--accent)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
