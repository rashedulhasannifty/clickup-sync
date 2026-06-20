import { Skeleton } from './Skeleton';

/**
 * Neutral page-shaped placeholder used as the route-level <Suspense> fallback
 * while a page's code chunk loads. Deliberately generic (a header row + a card
 * grid + one wide block) so it reads as "this page is forming" on every route
 * without pretending to know each page's specific layout. Replaces the lone
 * centered spinner, which made the whole content area look empty mid-navigation.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading page" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header row: title + actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
          <Skeleton width={200} height={20} />
          <Skeleton width={320} height={12} />
        </div>
        <Skeleton width={96} height={32} radius="8px" />
      </div>

      {/* Metric card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <Skeleton width={80} height={11} />
            <Skeleton width={120} height={24} />
          </div>
        ))}
      </div>

      {/* One wide content block */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height={14} />
        ))}
      </div>
    </div>
  );
}
