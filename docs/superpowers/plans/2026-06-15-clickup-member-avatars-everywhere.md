# ClickUp Member Avatars — Everywhere (extension)

> Follow-up to `2026-06-15-clickup-member-avatars.md`. Reuses `ClickupAvatar` / `useClickupMembers`.

**Goal:** Show a member avatar in front of the member name on the remaining surfaces — Time Spikes rows, assignee filter dropdowns, and the Analytics/Overview "by assignee" breakdown bars.

**Key constraint:** Some surfaces carry only a username (Analytics/Overview bars), no ClickUp user id. So resolution adds a best-effort **by-name** fallback; a renamed/duplicate username falls back to initials (never a wrong photo).

**Verification:** web app has no test runner → `tsc --noEmit` + `vite build`. No backend changes.

---

## Task 1: by-name resolution (foundation)

**Files:** `apps/web/src/hooks/useClickupMembers.ts`, `apps/web/src/components/ui/ClickupAvatar.tsx`

- [ ] **Hook:** add a `byName` map (lowercased `name`) alongside `byId`/`byEmail`. In the existing `useMemo` that builds the maps:

```ts
const byName = new Map<string, ClickupMember>();
// inside the for loop, after byEmail:
if (m.name) byName.set(m.name.toLowerCase(), m);
```

Return `byName` too: `return { members, byId, byEmail, byName, isLoading: query.isLoading };` and add `byName` to the inner `useMemo` return.

- [ ] **ClickupAvatar:** add a final by-name fallback in BOTH `ClickupAvatar` and `ClickupAvatarStack`. Pull `byName` from the hook and extend the resolution chain:

```ts
const { byId, byEmail, byName } = useClickupMembers();
const m =
  (userId != null ? byId.get(String(userId)) : undefined) ||
  (email ? byEmail.get(email.toLowerCase()) : undefined) ||
  (name ? byName.get(name.toLowerCase()) : undefined) ||
  undefined;
```

Apply the same `(u.name ? byName.get(u.name.toLowerCase()) : undefined)` tail inside `ClickupAvatarStack`'s `.map`.

- [ ] **Verify:** `cd apps/web && npx tsc -p tsconfig.app.json --noEmit` → exit 0.
- [ ] **Commit:** `feat(web): resolve ClickupAvatar by username as a fallback`

---

## Task 2: Select supports a per-option icon

**File:** `apps/web/src/components/ui/Select.tsx`

- [ ] Add `icon?: ReactNode` to `SelectOption` (it already imports `ReactNode`).
- [ ] In the trigger's selected-label area (around line 99), render `selected?.icon` before the label text, inside a flex wrapper so they align:

```tsx
<span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', color: selected ? 'var(--text)' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
  {selected?.icon}
  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected ? selected.label : placeholder ?? '—'}</span>
</span>
```

- [ ] In the option row button (around line 167, currently `{opt.label}`), render the icon before the label:

```tsx
<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
  {opt.icon}
  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.label}</span>
</span>
```

(Keep the existing trailing `{opt.value === value && <CircleCheck .../>}`.)

- [ ] **Verify:** tsc → exit 0. This is backward-compatible: every existing `Select` (no `icon` on options) renders unchanged.
- [ ] **Commit:** `feat(web): Select renders an optional per-option icon`

---

## Task 3: BarChart supports a leading node per row

**File:** `apps/web/src/components/charts/BarChart.tsx`

- [ ] Import `ReactNode` (`import type { ReactNode } from 'react';`) and add `leading?: ReactNode` to `BarData`.
- [ ] In the HORIZONTAL mode row (around line 35), render `d.leading` before the label span, inside the existing flex row:

```tsx
<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
  {d.leading}
  <span style={{ width: 110, ... }}>{d.label}</span>
  ...
</div>
```

(Leave the vertical-mode SVG branch unchanged — avatars don't belong on a vertical axis.)

- [ ] **Verify:** tsc → exit 0. Backward-compatible (no `leading` → renders as before).
- [ ] **Commit:** `feat(web): BarChart renders an optional leading node per row`

---

## Task 4: wire assignee filter dropdowns

**Files:** `apps/web/src/pages/TimeEntriesPage.tsx`, `apps/web/src/pages/HourSpikesPage.tsx`

- [ ] **TimeEntriesPage** `assigneeOptions` (around line 204): give each real-assignee option an `icon`. The first option (`value: ''`, "Any assignee") gets NO icon. For the rest:

```tsx
opts.push({ value: id, label: r.userName, icon: <ClickupAvatar userId={r.userId} name={r.userName} size={18} /> });
```

Add `import { ClickupAvatar } from '../components/ui/ClickupAvatar';` if missing. Note: `assigneeOptions` is a `useMemo` — JSX in it is fine.

- [ ] **HourSpikesPage** dropdown (around line 156): the options are `users.map((u) => ({ value: u.userId, label: u.userName }))`. Add an icon:

```tsx
options={users.map((u) => ({ value: u.userId, label: u.userName, icon: <ClickupAvatar userId={u.userId} name={u.userName} size={18} /> }))}
```

Add the `ClickupAvatar` import.

- [ ] **Verify:** tsc → exit 0. Confirm `assigneeOptions`' array type still satisfies `Select`'s `options` (the `icon` field is optional on `SelectOption`).
- [ ] **Commit:** `feat(web): show member avatars in assignee filter dropdowns`

---

## Task 5: wire Time Spikes rows

**File:** `apps/web/src/pages/HourSpikesPage.tsx`

- [ ] The spike row text (around line 117) reads `{s.userName} logged {s.hours}h on {date}`. Put a `ClickupAvatar` in front of the name. Wrap the existing text node so the avatar and text sit on one line:

```tsx
<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
  <ClickupAvatar userId={s.userId} name={s.userName} size={22} />
  <span>{s.userName} logged {s.hours.toFixed(1)}h on {formatDate(s.date)}</span>
</span>
```

Match the surrounding markup — read the actual JSX around line 117 first and integrate the avatar without breaking the existing layout/styles. If the row already uses a flex container, just insert `<ClickupAvatar ... />` as the first child instead of adding a wrapper.

- [ ] **Verify:** tsc → exit 0.
- [ ] **Commit:** `feat(web): show member avatar on Time Spikes rows`

---

## Task 6: wire Analytics + Overview "by assignee" bars

**Files:** `apps/web/src/pages/AnalyticsPage.tsx`, `apps/web/src/pages/OverviewPage.tsx`

- [ ] **AnalyticsPage:** the by-assignee bar data is built around lines 144–150 (`timeByUserData`, `costByUserData`) as `.map((r, i) => ({ label: r.userName, value: ..., color: ... }))`. Add a `leading` avatar to each (resolved by name — these rows have no id):

```tsx
.map((r, i) => ({ label: r.userName, value: r.totalHours, color: SPACE_COLORS[i % SPACE_COLORS.length], leading: <ClickupAvatar name={r.userName} size={18} /> }));
```

Do the same for `costByUserData`. Add `import { ClickupAvatar } from '../components/ui/ClickupAvatar';`.

- [ ] **OverviewPage:** check whether it renders a by-assignee `BarChart` from `userRows` (`UserTimeRow[]`, around line 237). If it does, add the same `leading: <ClickupAvatar name={r.userName} size={18} />` to that chart's data and import `ClickupAvatar`. If Overview does NOT render a by-assignee BarChart (e.g. `userRows` is unused or feeds something else), leave Overview untouched and note it.

- [ ] **Verify:** tsc → exit 0.
- [ ] **Commit:** `feat(web): show member avatars in Analytics/Overview by-assignee charts`

---

## Task 7: full verification

- [ ] `cd apps/web && npx tsc -p tsconfig.app.json --noEmit` → exit 0.
- [ ] `cd apps/web && npm run build` → succeeds.
- [ ] Manual smoke (stack running, logged in): Time Spikes rows + dropdown show photos; Time Entries assignee dropdown shows photos; Analytics "by assignee" bars show photos (or initials); existing non-member `Select` dropdowns (status, space, role) and other `BarChart`s (by space/client) are visually unchanged.

## Notes / scope
- The **Notify Spike modal** title (`Notify {userName}`) is intentionally left text-only — it's a string title prop and an avatar there is awkward. Flag if the user wants it.
- App-account surfaces (Team, UserMenu, Audit log actor, etc.) remain initials — they are not ClickUp members.
