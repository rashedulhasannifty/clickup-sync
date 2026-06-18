import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Select } from './Select';
import { Skeleton } from './Skeleton';
import { onActivate } from '../../lib/a11y';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  hidden?: boolean;
  sticky?: boolean;
  width?: string | number;
  align?: 'left' | 'right';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyBody?: string;
  emptyIcon?: React.ReactNode;
  emptyAction?: React.ReactNode;
  pageSize?: number;
  total?: number;
  page?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  loading?: boolean;
  /** Match design/project `data-table.jsx` (tasks explorer). */
  layout?: 'default' | 'design';
  /** Sticky first column (design table). Shorthand for stickyColumns={1}. */
  stickyFirstColumn?: boolean;
  /**
   * Freeze the first N columns during horizontal scroll (design layout only).
   * Each frozen column's `left` offset is derived from the declared widths of
   * the frozen columns before it, so those columns MUST have numeric (or `px`)
   * widths and should render at that width (pin long content with maxWidth +
   * ellipsis) or the offsets drift. Takes precedence over stickyFirstColumn.
   */
  stickyColumns?: number;
  rowKey?: keyof T | string;
  /**
   * Initial sort indicator for server-paginated tables. The arrow renders next
   * to the column header so users can see how the server ordered rows before
   * any local click happens. The user can't change this — when the data is a
   * slice of a larger set, client-side sort is disabled (see `isServerPaginated`).
   */
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}

export function DataTable<T extends { [key: string]: unknown }>({
  columns: initialColumns,
  data,
  onRowClick,
  emptyTitle = 'No data',
  emptyBody,
  emptyIcon,
  emptyAction,
  pageSize = 50,
  total,
  page = 1,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  loading = false,
  layout = 'default',
  stickyFirstColumn = false,
  stickyColumns,
  rowKey = 'id' as keyof T,
  initialSort,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(initialSort?.key ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSort?.dir ?? 'asc');
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(
    new Set(initialColumns.filter(c => c.hidden).map(c => c.key)),
  );
  const [showColMenu, setShowColMenu] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);

  const visibleCols = initialColumns.filter(c => !hiddenKeys.has(c.key));

  // If the caller passes `total` and the visible `data` is only a slice of it,
  // we're on a server-paginated list — client-side sort would only reorder
  // the current page, which silently lies about "top by X". Disable sort UI
  // in that case so users don't get a misleading partial reorder.
  const isServerPaginated = total != null && total > data.length;

  const sorted = sortKey && !isServerPaginated
    ? [...data].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : data;

  const totalPages = total != null && total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const rangeStart = total == null || total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = total == null || total === 0 ? 0 : Math.min(safePage * pageSize, total);

  const colPx = (w: Column<T>['width']): number => {
    if (typeof w === 'number') return w;
    if (typeof w === 'string' && w.endsWith('px')) return parseInt(w, 10);
    return 120;
  };

  const tableMinWidth = useMemo(() => {
    if (layout !== 'design') return undefined;
    return visibleCols.reduce((sum, c) => sum + colPx(c.width), 0);
  }, [layout, visibleCols]);

  // How many leading columns to freeze, and each one's cumulative left offset.
  const stickyCount = stickyColumns ?? (stickyFirstColumn ? 1 : 0);
  const stickyLefts = useMemo(() => {
    const lefts: number[] = [];
    let acc = 0;
    for (let i = 0; i < stickyCount; i++) {
      lefts[i] = acc;
      acc += colPx(visibleCols[i]?.width);
    }
    return lefts;
  }, [stickyCount, visibleCols]);

  // The frozen-column edge shadow should appear only once the table is scrolled
  // horizontally — at rest it would bleed onto the first scrollable column.
  const [scrolledX, setScrolledX] = useState(false);
  const stickyShadow = scrolledX ? '6px 0 8px -6px rgba(15, 23, 42, 0.18)' : undefined;

  useEffect(() => {
    if (!showColMenu) return;
    const close = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setShowColMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showColMenu]);

  function handleSort(key: string) {
    if (isServerPaginated) return;
    const col = initialColumns.find(c => c.key === key);
    if (col?.sortable === false) return;
    if (sortKey === key) {
      sortDir === 'asc' ? setSortDir('desc') : setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function rowId(row: T, i: number): string | number {
    const k = rowKey as string;
    const v = row[k];
    if (v != null && (typeof v === 'string' || typeof v === 'number')) return v;
    return i;
  }

  if (layout === 'design' && sorted.length === 0 && !loading) {
    return (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
      }}
      >
        <EmptyState title={emptyTitle} body={emptyBody} icon={emptyIcon} action={emptyAction} />
      </div>
    );
  }

  if (layout === 'design') {
    const headPad = '8px 12px';
    const cellPad = '6px 12px';
    const rowH = 36;

    return (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
      }}
      >
        <div
          style={{ overflowX: 'auto', position: 'relative' }}
          onScroll={(e) => {
            const next = e.currentTarget.scrollLeft > 0;
            setScrolledX((prev) => (prev === next ? prev : next));
          }}
        >
          <table style={{
            width: '100%', borderCollapse: 'separate', borderSpacing: 0,
            fontSize: 13, minWidth: tableMinWidth,
          }}
          >
            <thead>
              <tr style={{ background: 'var(--table-head-bg)' }}>
                {visibleCols.map((col, i) => {
                  const w = col.width != null ? (typeof col.width === 'number' ? `${col.width}px` : col.width) : undefined;
                  const align = col.align || 'left';
                  const sticky = i < stickyCount;
                  const isLastSticky = sticky && i === stickyCount - 1;
                  const headerClickable = !isServerPaginated && col.sortable !== false;
                  const sortState: 'ascending' | 'descending' | 'none' | undefined =
                    col.sortable === false || isServerPaginated
                      ? undefined
                      : sortKey === col.key
                        ? sortDir === 'asc' ? 'ascending' : 'descending'
                        : 'none';
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={sortState}
                      role={headerClickable ? 'button' : undefined}
                      tabIndex={headerClickable ? 0 : undefined}
                      onClick={() => headerClickable && handleSort(col.key)}
                      onKeyDown={headerClickable ? onActivate(() => handleSort(col.key)) : undefined}
                      style={{
                        padding: headPad,
                        textAlign: align,
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: '1px solid var(--border)',
                        cursor: headerClickable ? 'pointer' : 'default',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                        position: sticky ? 'sticky' : 'static',
                        left: sticky ? stickyLefts[i] : 'auto',
                        background: sticky ? 'var(--table-head-bg)' : undefined,
                        borderRight: isLastSticky ? '1px solid var(--border-soft)' : undefined,
                        boxShadow: isLastSticky ? stickyShadow : undefined,
                        zIndex: sticky ? 2 : 1,
                        width: w,
                      }}
                    >
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
                        width: '100%',
                      }}
                      >
                        {col.header}
                        {sortKey === col.key && (sortDir === 'asc' ? '↑' : '↓')}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, r) => (
                  <tr key={`sk-${r}`} style={{ height: rowH }}>
                    {visibleCols.map((col, c) => (
                      <td key={col.key} style={{ padding: cellPad, borderBottom: '1px solid var(--border-soft)' }}>
                        <Skeleton height={12} width={c === 0 ? '70%' : '45%'} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                sorted.map((row, idx) => (
                  <tr
                    key={String(rowId(row, idx))}
                    onClick={() => onRowClick?.(row)}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={onRowClick ? onActivate(() => onRowClick(row)) : undefined}
                    style={{
                      cursor: onRowClick ? 'pointer' : 'default',
                      height: rowH,
                      background: idx % 2 === 0 ? 'transparent' : 'var(--table-zebra)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)'; }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'var(--table-zebra)';
                    }}
                  >
                    {visibleCols.map((col, i) => {
                      const align = col.align || 'left';
                      const sticky = i < stickyCount;
                      const isLastSticky = sticky && i === stickyCount - 1;
                      return (
                        <td
                          key={col.key}
                          style={{
                            padding: cellPad,
                            textAlign: align,
                            borderBottom: '1px solid var(--border-soft)',
                            verticalAlign: 'middle',
                            color: 'var(--text)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            position: sticky ? 'sticky' : 'static',
                            left: sticky ? stickyLefts[i] : 'auto',
                            // Sticky cell must be OPAQUE or scrolled columns show
                            // through it. --table-zebra is translucent, so for
                            // zebra rows we composite it over the solid surface.
                            background: sticky ? 'var(--surface)' : undefined,
                            backgroundImage:
                              sticky && idx % 2 !== 0
                                ? 'linear-gradient(var(--table-zebra), var(--table-zebra))'
                                : undefined,
                            borderRight: isLastSticky ? '1px solid var(--border-soft)' : undefined,
                            boxShadow: isLastSticky ? stickyShadow : undefined,
                            zIndex: sticky ? 1 : 0,
                          }}
                        >
                          {col.render(row)}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total !== undefined && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 14px', borderTop: '1px solid var(--border)',
            fontSize: 12, color: 'var(--text-muted)', gap: 8, flexWrap: 'wrap',
          }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {total === 0 ? '0' : `${rangeStart}–${rangeEnd}`}
                </span>
                {' '}
                of <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)', fontWeight: 600 }}>{total}</span>
              </span>
              {onPageSizeChange && (
                <Select
                  value={String(pageSize)}
                  onChange={v => onPageSizeChange(Number(v))}
                  options={pageSizeOptions.map(n => ({ value: String(n), label: `${n} / page` }))}
                />
              )}
              <div ref={colMenuRef} style={{ position: 'relative' }}>
                <Button size="sm" variant="ghost" onClick={() => setShowColMenu(o => !o)}>Columns ▾</Button>
                {showColMenu && (
                  <div style={{
                    position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 20,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: 6, minWidth: 180,
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
                  }}
                  >
                    {initialColumns.map(c => (
                      <label
                        key={c.key}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 8px', fontSize: 12, color: 'var(--text)',
                          cursor: 'pointer', borderRadius: 5,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!hiddenKeys.has(c.key)}
                          onChange={() => {
                            const next = new Set(hiddenKeys);
                            next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                            setHiddenKeys(next);
                          }}
                        />
                        {c.header}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Button size="sm" variant="ghost" disabled={safePage <= 1} onClick={() => onPageChange?.(safePage - 1)}>←</Button>
              <span style={{ minWidth: 60, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                {safePage} / {totalPages}
              </span>
              <Button size="sm" variant="ghost" disabled={safePage >= totalPages} onClick={() => onPageChange?.(safePage + 1)}>→</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ——— default layout (existing pages) ——— */
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end relative">
        <Button size="sm" variant="ghost" onClick={() => setShowColMenu(v => !v)}>Columns ▾</Button>
        {showColMenu && (
          <div className="absolute top-8 right-0 z-20 bg-(--surface) border border-(--border) rounded-(--radius) shadow-lg p-2 w-44">
            {initialColumns.map(col => (
              <label key={col.key} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-(--hover) cursor-pointer text-sm">
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

      <div className="overflow-x-auto border border-(--border) rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--border) bg-(--surface-alt)">
              {visibleCols.map(col => {
                const clickable = col.sortable !== false && !isServerPaginated;
                const sortState: 'ascending' | 'descending' | 'none' | undefined =
                  col.sortable === false || isServerPaginated
                    ? undefined
                    : sortKey === col.key
                      ? sortDir === 'asc' ? 'ascending' : 'descending'
                      : 'none';
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={sortState}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    className={`px-3 py-2.5 text-left text-xs font-medium text-(--text-muted) whitespace-nowrap ${clickable ? 'cursor-pointer hover:text-(--text) select-none' : ''}`}
                    style={{
                      width: col.width != null ? (typeof col.width === 'number' ? `${col.width}px` : col.width) : undefined,
                      textAlign: col.align === 'right' ? 'right' : 'left',
                    }}
                    onClick={() => clickable && handleSort(col.key)}
                    onKeyDown={clickable ? onActivate(() => handleSort(col.key)) : undefined}
                  >
                    {col.header}
                    {col.sortable !== false && sortKey === col.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, r) => (
                <tr key={`sk-${r}`} className="border-b border-(--border-soft)">
                  {visibleCols.map((col, c) => (
                    <td key={col.key} className="px-3 py-2.5">
                      <Skeleton height={12} width={c === 0 ? '70%' : '45%'} />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.length}>
                  <EmptyState title={emptyTitle} body={emptyBody} icon={emptyIcon} action={emptyAction} />
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr
                  key={String(rowId(row, i))}
                  className={`border-b border-(--border-soft) last:border-0 ${i % 2 === 1 ? 'bg-(--surface-alt)' : 'bg-(--surface)'} ${onRowClick ? 'cursor-pointer hover:bg-(--hover)' : ''} transition-colors`}
                  onClick={() => onRowClick?.(row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? onActivate(() => onRowClick(row)) : undefined}
                >
                  {visibleCols.map(col => (
                    <td
                      key={col.key}
                      className="px-3 py-2.5 text-(--text)"
                      style={{ textAlign: col.align === 'right' ? 'right' : 'left' }}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total !== undefined && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-(--text-muted)">
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
