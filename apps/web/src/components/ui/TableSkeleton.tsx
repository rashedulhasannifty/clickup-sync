import { Skeleton } from './Skeleton';

/**
 * Loading placeholder for the hand-rolled (non-DataTable) tables. Renders a
 * card with a header strip + shimmer "rows" so the loading state reads as a
 * table and matches DataTable's skeleton, instead of one flat grey block.
 */
export function TableSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', background: 'var(--muted-bg)', borderBottom: '1px solid var(--border)' }}>
        <Skeleton height={10} width="30%" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '12px 16px',
              borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined,
            }}
          >
            <Skeleton height={12} width="22%" />
            <Skeleton height={12} width="34%" />
            <Skeleton height={12} width="16%" />
            <div style={{ flex: 1 }} />
            <Skeleton height={12} width={60} />
          </div>
        ))}
      </div>
    </div>
  );
}
