import React, { useRef } from 'react';

interface TabItem {
  value: string;
  label: React.ReactNode;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  variant?: 'underline' | 'segmented' | 'plain';
  /** Accessible name for the tablist (e.g. "Report view"). */
  ariaLabel?: string;
}

export function Tabs({ items, value, onChange, variant = 'segmented', ariaLabel }: TabsProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Roving-tabindex keyboard model: ArrowLeft/Right (and Home/End) move between
  // tabs and activate them, matching the WAI-ARIA tabs pattern.
  function onKeyDown(e: React.KeyboardEvent) {
    const current = items.findIndex((i) => i.value === value);
    if (current < 0) return;
    let next = current;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % items.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(items[next].value);
    const btn = ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    btn?.focus();
  }

  function tabProps(item: TabItem) {
    const selected = value === item.value;
    return {
      role: 'tab' as const,
      'aria-selected': selected,
      tabIndex: selected ? 0 : -1,
      onClick: () => onChange(item.value),
      onKeyDown,
    };
  }

  if (variant === 'plain') {
    return (
      <div ref={ref} role="tablist" aria-label={ariaLabel} style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
        {items.map(item => (
          <button
            key={item.value}
            {...tabProps(item)}
            className="tab-press"
            style={{
              fontSize: 13,
              fontWeight: value === item.value ? 600 : 400,
              color: value === item.value ? 'var(--text)' : 'var(--text-muted)',
              background: 'transparent', border: 0,
              cursor: 'pointer', fontFamily: 'inherit',
              padding: 0,
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  if (variant === 'segmented') {
    return (
      <div ref={ref} role="tablist" aria-label={ariaLabel} className="seg-track" style={{
        display: 'inline-flex', background: 'var(--muted-bg)',
        borderRadius: 8, padding: 3,
      }}>
        {items.map(item => (
          <button
            key={item.value}
            {...tabProps(item)}
            className="seg-tab"
            style={{
              padding: '5px 12px', fontSize: 13, fontWeight: 500,
              borderRadius: 6, border: 0, cursor: 'pointer',
              fontFamily: 'inherit',
              background: value === item.value ? 'var(--surface)' : 'transparent',
              color: value === item.value ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            {item.label}
            {item.count != null && (
              <span style={{
                marginLeft: 5, fontSize: 10, fontWeight: 700,
                padding: '1px 5px', borderRadius: 999,
                background: value === item.value ? 'var(--muted-bg)' : 'var(--border)',
                color: 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}>{item.count}</span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} role="tablist" aria-label={ariaLabel} style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
      {items.map(item => (
        <button
          key={item.value}
          {...tabProps(item)}
          className="tab-press"
          style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 500,
            borderBottom: `2px solid ${value === item.value ? 'var(--accent)' : 'transparent'}`,
            marginBottom: -1,
            color: value === item.value ? 'var(--accent)' : 'var(--text-muted)',
            background: 'transparent', border: 0,
            borderBottomWidth: 2, borderBottomStyle: 'solid',
            borderBottomColor: value === item.value ? 'var(--accent)' : 'transparent',
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            transition: 'all 100ms',
          }}
        >
          {item.label}
          {item.count != null && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 999,
              background: value === item.value ? 'var(--accent-soft)' : 'var(--muted-bg)',
              color: value === item.value ? 'var(--accent)' : 'var(--text-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}>{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
