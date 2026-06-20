import { Button } from './Button';
import { Select } from './Select';

interface PaginationProps {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

/**
 * Footer pager for the hand-rolled (non-DataTable) tables. Mirrors DataTable's
 * design-layout footer: "start–end of total" on the left, page-size picker, and
 * ←/→ controls on the right. Drop it inside the table's <Card> after </table>.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}: PaginationProps) {
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(safePage * pageSize, total);

  // Nothing to page through and no size control to offer → render nothing.
  if (total === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 14px',
        borderTop: '1px solid var(--border)',
        fontSize: 12,
        color: 'var(--text-muted)',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {rangeStart}–{rangeEnd}
          </span>{' '}
          of{' '}
          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)', fontWeight: 600 }}>{total}</span>
        </span>
        {onPageSizeChange && (
          <Select
            size="sm"
            ariaLabel="Rows per page"
            value={String(pageSize)}
            onChange={(v) => onPageSizeChange(Number(v))}
            options={pageSizeOptions.map((n) => ({ value: String(n), label: `${n} / page` }))}
          />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Button size="sm" variant="ghost" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} aria-label="Previous page">
          ←
        </Button>
        <span style={{ minWidth: 60, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
          {safePage} / {totalPages}
        </span>
        <Button size="sm" variant="ghost" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)} aria-label="Next page">
          →
        </Button>
      </div>
    </div>
  );
}
