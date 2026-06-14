// Shared color generator for the stacked cost-trend charts (assignee, client).
// Brand-leading hues for the first (highest-cost) segments, then a golden-angle
// hue walk for the long tail so every segment gets a distinct color — these
// charts have 20+ segments, far more than any fixed list, and consecutive
// legend entries must not collide.
const LEAD_HUES = ['#7B68EE', '#FF02F0', '#49CCF9', '#10b981', '#f59e0b', '#ef4444'];

export function segmentColor(i: number): string {
  if (i < LEAD_HUES.length) return LEAD_HUES[i];
  // 137.508° golden angle maximizes separation between successive hues.
  const hue = ((i - LEAD_HUES.length) * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 62%, 58%)`;
}
