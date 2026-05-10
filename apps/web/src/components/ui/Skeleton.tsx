interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string;
  className?: string;
}

export function Skeleton({ width = '100%', height = 16, radius = 'var(--radius-sm)', className = '' }: SkeletonProps) {
  return (
    <span
      className={`block ${className}`}
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, var(--muted-bg) 25%, var(--border-soft) 50%, var(--muted-bg) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
        display: 'block',
      }}
    />
  );
}
