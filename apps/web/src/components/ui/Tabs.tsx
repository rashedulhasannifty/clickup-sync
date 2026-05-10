import React from 'react';

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
}

export function Tabs({ items, value, onChange, variant = 'underline' }: TabsProps) {
  if (variant === 'plain') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
        {items.map(item => (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            style={{
              fontSize: 13,
              fontWeight: value === item.value ? 600 : 400,
              color: value === item.value ? 'var(--text)' : 'var(--text-muted)',
              background: 'transparent', border: 0,
              cursor: 'pointer', fontFamily: 'inherit',
              padding: 0,
              transition: 'color 100ms',
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
      <div style={{
        display: 'inline-flex', background: 'var(--muted-bg)',
        borderRadius: 8, padding: 3,
      }}>
        {items.map(item => (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            style={{
              padding: '5px 12px', fontSize: 13, fontWeight: 500,
              borderRadius: 6, border: 0, cursor: 'pointer',
              fontFamily: 'inherit',
              background: value === item.value ? 'var(--surface)' : 'transparent',
              color: value === item.value ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: value === item.value ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 100ms',
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
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
      {items.map(item => (
        <button
          key={item.value}
          onClick={() => onChange(item.value)}
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
