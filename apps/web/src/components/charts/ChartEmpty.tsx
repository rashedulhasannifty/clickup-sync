export function ChartEmpty({ height = 200 }: { height?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2" style={{ height }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="1.5">
        <rect x="3" y="14" width="4" height="7" rx="1" /><rect x="10" y="8" width="4" height="13" rx="1" /><rect x="17" y="11" width="4" height="10" rx="1" />
      </svg>
      <span className="text-xs text-[var(--text-faint)]">No data available</span>
    </div>
  );
}
