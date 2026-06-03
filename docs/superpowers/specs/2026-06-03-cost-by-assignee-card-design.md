# Cost by assignee — Overview card

Date: 2026-06-03
Status: Approved, pending plan

## Problem

The Overview "Charts Grid" currently shows:

- Tasks by status
- Tasks by space
- **Time tracked by assignee** (hours)
- Cost by department (money)
- Cost by client (money)

There is no equivalent **money** view broken down by assignee. Users can see who logged the most hours and how cost is split across departments and clients, but cannot directly see whose tracked time costs the most. The backend already aggregates this — `GET /reports/time-entries/by-user` returns `{ userName, totalHours, totalCostAud }` per assignee — so the gap is purely a missing UI tile.

## Goal

Add a "Cost by assignee" card to the Overview Charts Grid that ranks assignees by calculated labor cost in the active date range.

## Non-goals

- New endpoint or new backend aggregate.
- New filters beyond the global Overview date range.
- Drill-down behavior, click-through, or a dedicated `/cost-by-assignee` page.
- Reworking the existing "Cost by client" cents-vs-dollars formatter inconsistency. It is pre-existing debt and orthogonal to this change.

## Design

### Placement

New `<Card>` in the Charts Grid inside `apps/web/src/pages/OverviewPage.tsx`, inserted **between** "Time tracked by assignee" and "Cost by department". Final order in the grid:

1. Tasks by status
2. Tasks by space
3. Time tracked by assignee (hours)
4. **Cost by assignee (money)** ← new
5. Cost by department (money)
6. Cost by client (money)

The grid uses `gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))'`, so adding a sixth tile is layout-safe — it flows into a new cell without breaking the row.

### Data source

Reuse the existing `useTimeEntriesByUser()` hook. No new hook, no new query, no new cache key. The data the card needs is already in `byUser` / `userRows`, which the page reads today for the "Time tracked by assignee" hours chart and the KPI tiles.

### Derived array

Mirror the existing `timeByUserData` block (lines ~177–180 of `OverviewPage.tsx`):

```ts
const costByUserData = [...userRows]
  .sort((a, b) => b.totalCostAud - a.totalCostAud)
  .slice(0, 6)
  .map((r, i) => ({
    label: r.userName,
    value: r.totalCostAud,
    color: SPACE_COLORS[i % SPACE_COLORS.length],
  }));
```

- Sort descending by `totalCostAud` (cost, not hours).
- Top 6, matching the "Time tracked by assignee" and "Cost by department" cards (Cost by client uses 5 — kept as-is, not propagated).
- Full `userName` (no `.split(' ')[0]`), consistent with the comment on `timeByUserData` explaining why first-name collapsing breaks names like "Md."/"Mohammad".

### Card JSX

```tsx
<Card title="Cost by assignee" subtitle="Top 6 by calculated labor cost" padding={16}>
  <BarChart data={costByUserData} direction="horizontal" formatValue={(v) => moneyAud(v)} />
</Card>
```

- Title and subtitle match the surrounding cards' tone.
- `moneyAud(v)` receives raw dollars, the same convention as "Cost by department". (Cost by client passes cents; not adopted here.)

### Loading and error behavior

Inherits both from the page. `timeByUser` is already in the `QueryError` array at the top of `OverviewPage`, so errors surface centrally. The card renders with whatever `userRows` resolves to — an empty array produces an empty BarChart, the same as the existing "Time tracked by assignee" card during loading.

## Files changed

- `apps/web/src/pages/OverviewPage.tsx` — add `costByUserData` derivation, add the `<Card>` in the Charts Grid.

Estimated footprint: ~10 lines of code.

## Testing

- Manual: open `/overview`, confirm the new card renders, ranks descending by cost, formats as money, sits between hours-by-assignee and cost-by-department, and respects the date range.
- Regression check: hours-by-assignee, cost-by-department, and cost-by-client values are unchanged (same source data, no shared mutation).

No new unit tests warranted — the derivation is a straight mirror of an existing tested-by-eye pattern and contains no branching logic.
