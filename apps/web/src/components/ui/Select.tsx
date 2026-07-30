import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, CircleCheck, Search } from 'lucide-react';
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
  /** Which way the menu opens. Use 'top' (drop-up) when the trigger sits at the
   *  bottom of an `overflow:hidden` container (e.g. a table footer) so the menu
   *  opens over the content above instead of being clipped below. Defaults to
   *  'bottom'. */
  menuPlacement?: 'bottom' | 'top';
  /** Show an in-menu type-to-filter box. Single-select still; matches the
   *  MultiSelect search UX. Defaults to false so existing selects are unchanged. */
  searchable?: boolean;
  /** Placeholder for the search box (searchable only). Defaults to 'Search…'. */
  searchPlaceholder?: string;
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
  menuPlacement = 'bottom',
  searchable = false,
  searchPlaceholder = 'Search…',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const field = useFieldContext();
  const listboxId = useId();
  const triggerId = field?.fieldId;

  // The visible (and keyboard-navigable) option set. When searchable, filter by
  // label; otherwise it's just `options`, so non-searchable behavior is identical.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!searchable || !q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [searchable, query, options]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Reset the filter each time the menu closes so the next open starts fresh.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // Drop focus into the search box on open so typing narrows immediately.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  // When the menu opens, seed the active (highlighted) option to the current
  // value so keyboard users land on a sensible starting point.
  useEffect(() => {
    if (open) {
      const idx = filtered.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    } else {
      setActiveIndex(-1);
    }
    // Intentionally not depending on `filtered`: reseeding here on every
    // keystroke would fight the clamp effect below. Filtering handles that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  // Keep the highlighted index valid as the filtered list shrinks/grows.
  useEffect(() => {
    if (!open) return;
    setActiveIndex((i) => (filtered.length === 0 ? -1 : Math.min(Math.max(i, 0), filtered.length - 1)));
  }, [open, filtered.length]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const selected = options.find((o) => o.value === value);

  function commit(idx: number) {
    const opt = filtered[idx];
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
    const inSearch = e.target === searchRef.current;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        // In the search box, Home/End move the text cursor — leave them alone.
        if (inSearch) break;
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        if (inSearch) break;
        e.preventDefault();
        setActiveIndex(filtered.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        commit(activeIndex);
        break;
      case ' ':
        // Space is a literal character while typing in the search box.
        if (inSearch) break;
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
        className="btn-3d"
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
          ['--b-edge' as string]: 'var(--border-strong)',
          ['--b-glow' as string]: 'var(--btn-neutral-glow)',
          ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
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
          borderRadius: 9,
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
          style={{
            position: 'absolute',
            ...(menuPlacement === 'top'
              ? { bottom: 'calc(100% + 4px)' }
              : { top: 'calc(100% + 4px)' }),
            ...(menuAlign === 'right' ? { right: 0 } : { left: 0 }),
            zIndex: 40,
            minWidth: '100%',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 300,
          }}
        >
          {searchable && (
            <div style={{ position: 'relative', padding: 4, flexShrink: 0 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', display: 'flex', pointerEvents: 'none' }}>
                <Search size={12} strokeWidth={1.75} />
              </span>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                aria-label={ariaLabel ? `${ariaLabel} — filter` : 'Filter options'}
                role="combobox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-activedescendant={activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
                aria-autocomplete="list"
                style={{
                  width: '100%',
                  height: 28,
                  padding: '0 8px 0 26px',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  color: 'var(--text)',
                  background: 'var(--muted-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            style={{ flex: 1, overflowY: 'auto', minHeight: 0, maxHeight: 260 }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)' }}>No matches</div>
            ) : (
              filtered.map((opt, idx) => (
                <button
                  key={opt.value}
                  className="row-3d"
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
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
