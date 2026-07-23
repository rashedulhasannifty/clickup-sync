import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search, Square, SquareCheck } from 'lucide-react';

interface MultiSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Trigger label when nothing is selected, e.g. "Any client". An empty
   *  selection means "no constraint", so there is no empty sentinel option. */
  allLabel: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Accessible name for screen readers when there's no visible <label>. */
  ariaLabel?: string;
  /** Which edge the dropdown menu aligns to. Defaults to 'left'. */
  menuAlign?: 'left' | 'right';
  /** Which way the menu opens. Defaults to 'bottom'. */
  menuPlacement?: 'bottom' | 'top';
  /** In-menu type-to-filter box. Defaults to true — List and Assignee can run
   *  to dozens of options. */
  searchable?: boolean;
}

/**
 * Multi-select dropdown for the Tasks / Time Entries filter bars.
 *
 * Deliberately NOT an extension of `Select`: that component's model is
 * commit-and-close on a scalar value, while this one stays open, toggles
 * membership, and needs a different trigger label and a search box. It copies
 * `Select`'s trigger *styling* (btn-3d, heights, radius, focus border swap) so
 * the two are indistinguishable sitting side by side in the same filter bar.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  allLabel,
  className = '',
  size = 'md',
  disabled,
  ariaLabel,
  menuAlign = 'left',
  menuPlacement = 'bottom',
  searchable = true,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedSet = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Each time the menu opens, clear the previous search and drop focus into the
  // search box so typing narrows the list immediately.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('');
      setActiveIndex(0);
      if (searchable) searchRef.current?.focus();
    } else {
      setActiveIndex(-1);
    }
  }, [open, searchable]);

  // Typing shrinks the list — clamp the highlight so it never points past the end.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex((i) => (filtered.length === 0 ? -1 : Math.min(i < 0 ? 0 : i, filtered.length - 1)));
  }, [filtered.length]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function toggle(optValue: string) {
    onChange(selectedSet.has(optValue) ? value.filter((v) => v !== optValue) : [...value, optValue]);
  }

  // Attached to the wrapper, not the trigger: once the menu is open focus lives
  // in the search input, so the arrow keys have to be caught as they bubble.
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
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
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
        setActiveIndex(filtered.length - 1);
        break;
      case ' ':
        // Space is a literal character while the search box has focus. Only
        // treat it as "toggle the highlighted option" from the trigger itself.
        if (e.target === searchRef.current) break;
        e.preventDefault();
        if (filtered[activeIndex]) toggle(filtered[activeIndex].value);
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[activeIndex]) toggle(filtered[activeIndex].value);
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

  // Trigger label: "Any client" → "Acme" → "Acme +2". The count fallback covers
  // a selected value that is no longer in `options` (e.g. a list from a space
  // the topbar has since switched away from).
  const firstSelected = options.find((o) => selectedSet.has(o.value));
  const triggerLabel =
    value.length === 0
      ? allLabel
      : !firstSelected
        ? `${value.length} selected`
        : value.length === 1
          ? firstSelected.label
          : `${firstSelected.label} +${value.length - 1}`;
  const hasSelection = value.length > 0;

  const h = size === 'sm' ? 28 : 32;
  const fs = size === 'sm' ? 12 : 13;

  return (
    <div
      ref={ref}
      className={className}
      onKeyDown={onKeyDown}
      style={{ position: 'relative', display: 'inline-flex', minWidth: 80 }}
    >
      <button
        type="button"
        className="btn-3d"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        // Ignore keyboard-synthesized clicks (detail === 0) — Enter/Space are
        // fully handled in onKeyDown, and letting the click through would
        // immediately toggle the menu a second time.
        onClick={(e) => { if (e.detail !== 0) !disabled && setOpen((o) => !o); }}
        style={{
          ['--b-edge' as string]: 'var(--border-strong)',
          ['--b-glow' as string]: 'var(--btn-neutral-glow)',
          ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: h,
          padding: '0 28px 0 10px',
          fontSize: fs,
          fontWeight: 500,
          background: 'var(--surface)',
          color: 'var(--text)',
          // An active filter is visible without opening the menu.
          border: `1px solid ${hasSelection ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 9,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          fontFamily: 'inherit',
          outline: 'none',
          whiteSpace: 'nowrap',
          position: 'relative',
          minWidth: 80,
          transition: 'border-color 120ms',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = hasSelection ? 'var(--accent)' : 'var(--border)'; }}
      >
        <span
          style={{
            flex: 1,
            textAlign: 'left',
            overflow: 'hidden',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            color: hasSelection ? 'var(--text)' : 'var(--text-muted)',
          }}
        >
          {value.length === 1 && firstSelected?.icon}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{triggerLabel}</span>
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
            ...(menuPlacement === 'top' ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
            ...(menuAlign === 'right' ? { right: 0 } : { left: 0 }),
            zIndex: 40,
            minWidth: 220,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 320,
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
                placeholder="Search…"
                aria-label="Filter options"
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
            aria-multiselectable="true"
            style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)' }}>No matches</div>
            ) : (
              filtered.map((opt, idx) => {
                const checked = selectedSet.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    className="row-3d"
                    id={`${listboxId}-opt-${idx}`}
                    role="option"
                    aria-selected={checked}
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIndex(idx)}
                    // Note: no setOpen(false) — the menu stays open so several
                    // options can be ticked in one visit.
                    onClick={() => toggle(opt.value)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: 13,
                      fontWeight: 500,
                      background: idx === activeIndex ? 'var(--hover)' : 'transparent',
                      color: 'var(--text)',
                      border: 0,
                      borderRadius: 5,
                      cursor: 'pointer',
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                      fontFamily: 'inherit',
                    }}
                  >
                    {/* A glyph, not just a background tint — selection state must
                        not be conveyed by color alone. */}
                    <span style={{ display: 'flex', flexShrink: 0, color: checked ? 'var(--accent)' : 'var(--text-faint)' }}>
                      {checked ? <SquareCheck size={14} strokeWidth={2} /> : <Square size={14} strokeWidth={2} />}
                    </span>
                    {opt.icon}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>

          {hasSelection && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => { onChange([]); setOpen(false); }}
              style={{
                flexShrink: 0,
                marginTop: 4,
                padding: '7px 8px',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'inherit',
                color: 'var(--text-muted)',
                background: 'transparent',
                border: 0,
                borderTop: '1px solid var(--border)',
                borderRadius: 0,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
