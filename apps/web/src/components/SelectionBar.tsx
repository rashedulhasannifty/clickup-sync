import React from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/Button';
import { Pill } from './ui/Pill';

/**
 * The strip that appears between the filters and the table while rows are
 * selected.
 *
 * Deliberately separate from the metric cards above it: those keep meaning
 * "everything matching your filters", so the two rows of numbers can be read
 * against each other. Nothing renders when the selection is empty.
 */

export interface SelectionStat {
  label: string;
  value: string;
  /** Renders amber — for caveats like entries with no rate. */
  warn?: boolean;
}

interface Props {
  count: number;
  /** What one selected row is, e.g. "task". */
  noun: string;
  /** Plural form, when adding an 's' doesn't work ("entry" -> "entries"). */
  nounPlural?: string;
  stats: SelectionStat[];
  onClear: () => void;
  /** Bulk actions for the selection, rendered before Clear. */
  actions?: React.ReactNode;
}

export function SelectionBar({ count, noun, nounPlural, stats, onClear, actions }: Props) {
  if (count === 0) return null;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: '9px 14px',
        background: 'var(--surface)',
        border: '1px solid var(--accent, var(--border))',
        borderRadius: 10,
        fontSize: 13,
      }}
    >
      <Pill tone="blue" size="xs">
        {count} {count === 1 ? noun : (nounPlural ?? `${noun}s`)} selected
      </Pill>
      {stats.map((s) => (
        <span key={s.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {s.label}
          </span>
          <span style={{
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
            color: s.warn ? 'var(--amber, var(--text))' : 'var(--text)',
          }}
          >
            {s.value}
          </span>
        </span>
      ))}
      <span style={{ flex: 1 }} />
      {actions}
      <Button size="sm" variant="ghost" icon={<X size={12} strokeWidth={1.75} />} onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
