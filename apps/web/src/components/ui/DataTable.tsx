import React, { useState } from 'react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  hidden?: boolean;
  sticky?: boolean;
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyBody?: string;
  pageSize?: number;
  total?: number;
  page?: number;
  onPageChange?: (page: number) => void;
  loading?: boolean;
}

export function DataTable<T extends { [key: string]: unknown }>({
  columns: initialColumns,
  data,
  onRowClick,
  emptyTitle = 'No data',
  emptyBody,
  pageSize = 50,
  total,
  page = 1,
  onPageChange,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(
    new Set(initialColumns.filter(c => c.hidden).map(c => c.key)),
  );
  const [showColMenu, setShowColMenu] = useState(false);

  const visibleCols = initialColumns.filter(c => !hiddenKeys.has(c.key));

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : data;

  const totalPages = total !== undefined ? Math.ceil(total / pageSize) : 1;

  function handleSort(key: string) {
    if (sortKey === key) {
      sortDir === 'asc' ? setSortDir('desc') : setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end relative">
        <Button size="sm" variant="ghost" onClick={() => setShowColMenu(v => !v)}>Columns ▾</Button>
        {showColMenu && (
          <div className="absolute top-8 right-0 z-20 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-lg p-2 w-44">
            {initialColumns.map(col => (
              <label key={col.key} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--hover)] cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={!hiddenKeys.has(col.key)}
                  onChange={() => {
                    const next = new Set(hiddenKeys);
                    next.has(col.key) ? next.delete(col.key) : next.add(col.key);
                    setHiddenKeys(next);
                  }}
                />
                {col.header}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto border border-[var(--border)] rounded-[var(--radius-lg)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-alt)]">
              {visibleCols.map(col => (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] whitespace-nowrap ${col.sortable ? 'cursor-pointer hover:text-[var(--text)] select-none' : ''}`}
                  style={{ width: col.width }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  {col.header}
                  {col.sortable && sortKey === col.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.length}>
                  <EmptyState title={emptyTitle} body={emptyBody} />
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr
                  key={i}
                  className={`border-b border-[var(--border-soft)] last:border-0 ${i % 2 === 1 ? 'bg-[var(--surface-alt)]' : 'bg-[var(--surface)]'} ${onRowClick ? 'cursor-pointer hover:bg-[var(--hover)]' : ''} transition-colors`}
                  onClick={() => onRowClick?.(row)}
                >
                  {visibleCols.map(col => (
                    <td key={col.key} className="px-3 py-2.5 text-[var(--text)]">{col.render(row)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total !== undefined && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
          <span>{total} items</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>←</Button>
            <span>Page {page} of {totalPages}</span>
            <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>→</Button>
          </div>
        </div>
      )}
    </div>
  );
}
