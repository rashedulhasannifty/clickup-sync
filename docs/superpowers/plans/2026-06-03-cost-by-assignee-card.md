# Cost by assignee card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Cost by assignee" tile to the Overview Charts Grid that ranks assignees by `totalCostAud` (money), mirroring the existing hours-by-assignee tile.

**Architecture:** Pure UI addition in `apps/web/src/pages/OverviewPage.tsx`. Reuses the existing `useTimeEntriesByUser()` hook — same data source the page already consumes for hours-by-assignee and the KPI totals. One new derived array + one new `<Card>`.

**Tech Stack:** React, TanStack Query (already wired), the project's `<Card>` and `<BarChart>` components, `moneyAud()` helper already defined at the top of the file.

**Spec:** `docs/superpowers/specs/2026-06-03-cost-by-assignee-card-design.md`

---

## File Structure

Only one file changes:

- **Modify:** `apps/web/src/pages/OverviewPage.tsx`
  - Add a `costByUserData` derivation (around the existing `timeByUserData` block, ~line 177–180).
  - Add a new `<Card>` in the Charts Grid between "Time tracked by assignee" and "Cost by department" (~line 373).

No new files, no new hooks, no new API client methods, no backend changes.

---

## Task 1: Add the `costByUserData` derivation

**Files:**
- Modify: `apps/web/src/pages/OverviewPage.tsx` (insert after the existing `timeByUserData` block, ~line 180)

- [ ] **Step 1: Read the surrounding context**

Open `apps/web/src/pages/OverviewPage.tsx` and locate this block:

```tsx
  // BarChart: time by assignee (top 6). Full username — the old
  // `.split(' ')[0]` collapsed people whose names start with "Md." or
  // "Mohammad" into the same first token, making the chart unreadable.
  const timeByUserData = [...userRows]
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 6)
    .map((r, i) => ({ label: r.userName, value: r.totalHours, color: SPACE_COLORS[i % SPACE_COLORS.length] }));
```

This is the model. `userRows` is the array from `useTimeEntriesByUser()` and has shape `{ userName: string; totalHours: number; totalCostAud: number }` (see `UserTimeRow` type at line 72).

- [ ] **Step 2: Add `costByUserData` immediately after `timeByUserData`**

Insert this block directly below the `timeByUserData` declaration:

```tsx
  // BarChart: cost by assignee (top 6). Same source array as timeByUserData
  // but sorted/mapped by totalCostAud. Raw dollars are passed straight to
  // moneyAud() in the card body, matching the "Cost by department" tile.
  const costByUserData = [...userRows]
    .sort((a, b) => b.totalCostAud - a.totalCostAud)
    .slice(0, 6)
    .map((r, i) => ({ label: r.userName, value: r.totalCostAud, color: SPACE_COLORS[i % SPACE_COLORS.length] }));
```

- [ ] **Step 3: Type-check**

Run from the repo root:

```bash
cd apps/web && npx tsc -b --noEmit
```

Expected: no errors. (`userRows` is typed `UserTimeRow[]`, so `r.totalCostAud` resolves cleanly.)

- [ ] **Step 4: Do NOT commit yet**

The derivation is unused until Task 2 adds the card. Commit both changes together so each commit leaves the page in a coherent state.

---

## Task 2: Add the `<Card>` in the Charts Grid

**Files:**
- Modify: `apps/web/src/pages/OverviewPage.tsx` (Charts Grid block, ~line 373)

- [ ] **Step 1: Locate the Charts Grid**

Find this section (around line 364):

```tsx
      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <Card title="Tasks by status" subtitle={`${fmt.number(totalTasks)} total tasks tracked`} padding={16}>
          <DonutChart data={tasksByStatusData} size={140} thickness={14} centerLabel="Total" centerValue={totalTasks} />
        </Card>

        <Card title="Tasks by space" subtitle="Distribution across workspaces" padding={16}>
          <BarChart data={tasksBySpaceData} direction="horizontal" formatValue={fmt.number} />
        </Card>

        <Card title="Time tracked by assignee" subtitle={`Hours logged in ${dateRangeLabel}`} padding={16}>
          <BarChart data={timeByUserData} direction="horizontal" formatValue={fmt.hours} />
        </Card>

        <Card title="Cost by department" subtitle="Calculated labor cost" padding={16}>
          <BarChart data={costByDeptData} direction="horizontal" formatValue={v => moneyAud(v)} />
        </Card>

        <Card title="Cost by client" subtitle="Top 5 clients by spend" padding={16}>
          <BarChart data={costByClientData} direction="horizontal" formatValue={(v) => moneyAud(v / 100)} />
        </Card>
      </div>
```

- [ ] **Step 2: Insert the new card between "Time tracked by assignee" and "Cost by department"**

After the "Time tracked by assignee" `</Card>` and before the "Cost by department" `<Card>`, add:

```tsx
        <Card title="Cost by assignee" subtitle="Top 6 by calculated labor cost" padding={16}>
          <BarChart data={costByUserData} direction="horizontal" formatValue={(v) => moneyAud(v)} />
        </Card>
```

Final block in the Charts Grid:

```tsx
        <Card title="Time tracked by assignee" subtitle={`Hours logged in ${dateRangeLabel}`} padding={16}>
          <BarChart data={timeByUserData} direction="horizontal" formatValue={fmt.hours} />
        </Card>

        <Card title="Cost by assignee" subtitle="Top 6 by calculated labor cost" padding={16}>
          <BarChart data={costByUserData} direction="horizontal" formatValue={(v) => moneyAud(v)} />
        </Card>

        <Card title="Cost by department" subtitle="Calculated labor cost" padding={16}>
          <BarChart data={costByDeptData} direction="horizontal" formatValue={v => moneyAud(v)} />
        </Card>
```

- [ ] **Step 3: Type-check and lint**

Run from `apps/web`:

```bash
npx tsc -b --noEmit
npm run lint
```

Expected: no TypeScript errors, no new ESLint errors.

- [ ] **Step 4: Manual verification in the browser**

Start the web dev server:

```bash
cd apps/web && npm run dev
```

In a browser, open the Overview page. Confirm:

1. The Charts Grid now shows **six** cards instead of five.
2. The new "Cost by assignee" card sits **between** "Time tracked by assignee" and "Cost by department".
3. Values are formatted as money (e.g. `$1,234.56`), not as raw numbers or hours.
4. Bars are sorted descending by cost (highest at the top).
5. The card displays at most 6 rows.
6. Changing the global date range (top bar) updates the new card alongside the existing assignee/department/client cards.
7. The other five cards still render correctly (regression check) — hours by assignee, cost by department, and cost by client should look identical to before.

If you cannot run the dev server in this environment, say so explicitly rather than claiming success. Type-checking only verifies types, not visual correctness.

- [ ] **Step 5: Commit both Task 1 and Task 2 changes together**

```bash
git add apps/web/src/pages/OverviewPage.tsx
git commit -m "$(cat <<'EOF'
feat(web): cost by assignee card on Overview

Add a new "Cost by assignee" tile in the Overview Charts Grid,
mirroring the existing hours-by-assignee pattern but sorted and
formatted by totalCostAud. Reuses GET /reports/time-entries/by-user
via the existing useTimeEntriesByUser() hook — no backend changes.
EOF
)"
```

Expected: clean commit, working tree clean afterward.

---

## Self-review (done)

- **Spec coverage:** placement, data source, derivation, JSX, formatter convention, top-6 limit, out-of-scope items — all reflected in Tasks 1–2. No gaps.
- **Placeholder scan:** no TBD/TODO; every code change is shown verbatim; every command has an expected outcome.
- **Type consistency:** `costByUserData` shape (`{ label, value, color }`) matches what `BarChart` consumes everywhere else in the same grid. `userRows` is `UserTimeRow[]`, so `r.totalCostAud` is `number`, consistent with `moneyAud(v: number)`.
