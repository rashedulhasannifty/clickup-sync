import React from 'react';

interface TabItem { key: string; label: React.ReactNode; }
interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  variant?: 'underline' | 'segmented';
}

export function Tabs({ items, active, onChange, variant = 'underline' }: TabsProps) {
  if (variant === 'segmented') {
    return (
      <div className="inline-flex bg-[var(--muted-bg)] rounded-[var(--radius)] p-0.5">
        {items.map(item => (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={`px-3 py-1 text-sm rounded-[calc(var(--radius)-2px)] transition-all ${active === item.key ? 'bg-[var(--surface)] text-[var(--text)] font-medium shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex border-b border-[var(--border)]">
      {items.map(item => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${active === item.key ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
