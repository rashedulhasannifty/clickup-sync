# Multi-select filters on Tasks and Time Entries pages

**Date:** 2026-07-23
**Status:** Approved

## Goal

The filter bars on the Tasks page and the Time Entries page only allow one value
per dropdown. You cannot ask "show me Acme **and** Beta", or "show me tasks that
are `in progress` **or** `in review`". Every categorical dropdown on both pages
becomes multi-select.

## Decisions (approved)

### Which filters become multi-select

Categorical membership filters — the ones where "any of these" is a meaningful
question — become multi-select:

| Page | Multi-select | Stays single-select |
|---|---|---|
| Tasks | Status, Priority, Assignee, Client, Folder, List | Type, Archived |
| Time Entries | Assignee, Client, Folder, List, Cost status | Billable, Missing-rate toggle |

`Type` (parent / subtask / both), `Archived` (exclude / include / only),
`Billable` (billable / non / both) and the missing-rate `Switch` are
mutually-exclusive *modes*, not membership lists. "Exclude archived **and**
archived only" has no coherent meaning, so they keep their current single-select
control. The global topbar **Space** filter is also unchanged (out of scope).

### Wire format: comma-separated values in the existing query params

`?status=open,review&client=Acme,Beta`.

Chosen over repeated params (`?client=a&client=b`) and new plural params
(`?clients=a,b`) because it is **backward-compatible with every existing
deep-link**. `?userId=X`, `?status=NO_RATE_FOUND`, `?client=Y`, `?spaceId=Z` all
parse as a one-element list, so `MissingRatesPage`, `CostBucketDrawer`,
`TimesheetPage` and `SpacesPage` keep working with no changes and no controller
signature churn.

An empty selection means "no constraint" — the param is omitted entirely.

### Dropdown UX: checkboxes + in-menu search

The menu stays open while ticking options, has a type-to-filter search box at the
top (List and Assignee can run to dozens of options), and a `Clear selection`
footer.

```
┌─ Client: Acme +2 ────────▾ ┐
│ ┌───────────────────┐ │
│ │ ⌕ Search…         │ │
│ └───────────────────┘ │
│ ☑ Acme          (42) │
│ ☑ Beta Corp     (18) │
│ ☐ Contoso        (7) │
│ ☑ Delta Ltd      (3) │
│ ─────────────────── │
│ Clear selection      │
└───────────────────────┘
```

## Frontend

### 1. New `components/ui/MultiSelect.tsx`

A new component, **not** an extension of `Select`. `Select`'s model is
commit-and-close on a scalar value; multi-select needs stay-open toggling, a
different trigger label, and a search box. `MultiSelect` copies `Select`'s
trigger *styling* (the `btn-3d` class, `size` heights of 28/32px, radius 9,
`--b-edge` / `--b-glow` custom properties, focus border swap) so the two sit
side-by-side in the same filter bar indistinguishably, but owns its own
behavior.

Props:

```ts
interface MultiSelectProps {
  options: { value: string; label: string; icon?: ReactNode }[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Trigger label when nothing is selected, e.g. "Any client". */
  allLabel: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  ariaLabel?: string;
  menuAlign?: 'left' | 'right';
  menuPlacement?: 'bottom' | 'top';
  /** Show the in-menu search box. Defaults to true. */
  searchable?: boolean;
}
```

Behavior:

- **Trigger label**: 0 selected → `allLabel`; 1 selected → that option's label;
  N selected → `"<first selected label> +<N-1>"` (e.g. `Acme +2`). When anything
  is selected the trigger text uses `var(--text)` and the border uses
  `var(--accent)` so an active filter is visible without opening the menu. The
  single-selection case also renders the option's `icon` (assignee avatars),
  matching `Select`.
- **Options carry no empty sentinel.** The `{ value: '', label: 'Any status' }`
  first entry disappears from every option-builder `useMemo` on both pages; an
  empty `value` array *is* "any". That string moves to the `allLabel` prop.
- **Menu stays open** on option click. Clicking toggles membership.
- **Search box** at the top of the menu, auto-focused on open, filters options by
  case-insensitive label substring. Cleared each time the menu opens. Hidden when
  `searchable={false}`.
- **`Clear selection`** footer row, rendered only when `value.length > 0`, sets
  `[]` and closes the menu.
- **Outside click / Escape** closes the menu (same `mousedown` document listener
  as `Select`).

Accessibility:

- Menu is `role="listbox" aria-multiselectable="true"`; each row is
  `role="option"` with `aria-selected={selected}`.
- Trigger carries `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls`,
  `aria-activedescendant`, and the caller's `ariaLabel`.
- Keyboard: ArrowDown/ArrowUp move the active row (over the *filtered* option
  list), Home/End jump, Enter/Space toggles the active option **without
  closing**, Escape closes, Tab closes. When the search box has focus, printable
  keys type into it and the arrow keys still drive the list.
- Each row renders a checkbox glyph (`Square` / `SquareCheck` from `lucide-react`)
  so selection state is not conveyed by background color alone.

### 2. `pages/TasksPage.tsx`

Six filter states change from `string` to `string[]`: `statusFilter`,
`priorityFilter`, `assigneeFilter`, `clientFilter`, `listFilter`,
`folderFilter`. `typeFilter` and `archivedFilter` stay `string`.

- Each corresponding `<Select>` becomes `<MultiSelect>` with `allLabel` set to
  the string that used to be the sentinel option's label (`Any status`,
  `Any priority`, `Any assignee`, `Any client`, `Any folder`, `Any list`).
- `PRIORITY_OPTIONS` loses its `{ value: '', label: 'Any priority' }` entry.
  `TYPE_OPTIONS` and `ARCHIVED_OPTIONS` are untouched.
- The four option-builder `useMemo`s (`assigneeOptions`, `clientOptions`,
  `listOptions`, `folderOptions`) and `statusOptions` each drop their leading
  sentinel push.
- `taskParams` serializes each array: `status: statusFilter.length ?
  statusFilter.join(',') : undefined`, and likewise for priority, assigneeId,
  client, listId, folderId.
- `hasFilters` switches those six checks to `.length > 0`.
- `reset()` sets them to `[]`.
- The `[space]` effect that clears `listFilter` / `folderFilter` sets `[]`.
- The `?taskIds=` deep-link effect is unaffected (`taskIdsFilter` is already
  `string[]`).

### 3. `pages/TimeEntriesPage.tsx`

Five filter states become `string[]`: `userId`, `clientFilter`, `listFilter`,
`folderFilter`, `status`. `billable` and `missingOnly` stay as they are.

- `STATUS_OPTIONS` loses its `{ value: '', label: 'Any status' }` entry.
  `BILLABLE_OPTIONS` is untouched.
- `assigneeOptions`, `clientOptions`, `listOptions`, `folderOptions` drop their
  leading sentinel push.
- `params` serializes each array with `.join(',')`, `undefined` when empty.
  `aggParams` strips only `limit`/`offset`, so the aggregates query picks the new
  shape up automatically.
- **The URL deep-link `useEffect` must wrap scalars in arrays**:
  `setUserId([urlUserId])`, `setClientFilter([urlClient])`,
  `setStatus([urlStatus])`. Missing this silently breaks the Missing-Rates →
  Time Entries and Cost-Bucket → Time Entries links.
- The `missingOnly` effect becomes `if (missingOnly) setStatus([])`.
- `hasFilters` and `reset()` updated for arrays.
- The cost-status `MultiSelect` keeps `disabled={missingOnly}`.

### 4. Export and drawers

`exportExcel` on both pages spreads the same `params` / `taskParams` object, so
comma-joined values flow through with no change. No table column, drawer, or
column-visibility change.

## Backend (`src/reports`)

### 5. New `src/reports/report-filter.util.ts`

```ts
/** Split a comma-separated query param into a de-duplicated list of trimmed,
 *  non-empty values. Returns undefined when nothing usable remains, so callers
 *  can treat "absent" and "empty" identically and omit the where-clause. */
export function csvList(value?: string): string[] | undefined
```

Trims each part, drops empties, de-duplicates preserving first-seen order,
returns `undefined` for `undefined`, `''`, `','`, `'  ,  '`.

### 6. `tasks-report.service.ts` — `tasks()`

The where-clause is restructured to the `and: Prisma.ClickupTaskWhereInput[]`
accumulator pattern that `timeEntriesList` already uses, with
`if (and.length) where.AND = and` at the end.

This restructure is required, not cosmetic. Today `assigneeId` writes
`where.assigneesNames = { contains: assigneeId, mode: 'insensitive' }` (a
substring match against the comma-joined names string) while `search` separately
assigns `where.AND = [{ OR: [...] }]`. Multi-assignee must become an `OR` of
`contains` clauses, which cannot live on the bare `assigneesNames` key alongside
the search `OR`. Both push onto the accumulator instead.

Filter conversions:

| Param | Before | After |
|---|---|---|
| `status` | `where.status = status` | `where.status = { in: list }` |
| `priority` | `where.priority = priority` | `where.priority = { in: list }` |
| `client` | `where.client = client` | `where.client = { in: list }` |
| `listId` | `where.listId = listId` | `where.listId = { in: list }` |
| `folderId` | `where.folderId = folderId` | `where.folderId = { in: list }` |
| `assigneeId` | `where.assigneesNames = { contains: … }` | `and.push({ OR: names.map(n => ({ assigneesNames: { contains: n, mode: 'insensitive' } })) })` |
| `search` | `where.AND = [{ OR: [...] }]` | `and.push({ OR: [...] })` |

Each list comes from `csvList(param)`; when it returns `undefined` the clause is
skipped exactly as before. `spaceId`, `type`, `archived`, `taskIds` and the
`from`/`to` window are unchanged.

**Known pre-existing behavior, deliberately not fixed here:** the assignee filter
is a substring match, so selecting `Sam` also matches `Sameer`. Multi-select does
not worsen this (each selected name is matched the same way it is today);
switching to exact ordinal matching is a separate change.

### 7. `time-entries-report.service.ts` — `timeEntriesList()` **and** `timeEntriesAggregates()`

| Param | Before | After |
|---|---|---|
| `userId` | `where.userId = userId` | `where.userId = { in: list }` |
| `status` | `where.status = status` | `where.status = { in: list }` |
| `client` | `and.push({ task: { client } })` | `and.push({ task: { client: { in: list } } })` |
| `listId` | `and.push({ task: { listId } })` | `and.push({ task: { listId: { in: list } } })` |
| `folderId` | `and.push({ task: { folderId } })` | `and.push({ task: { folderId: { in: list } } })` |

`missingOnly === 'true'` still short-circuits to the scalar
`where.status = 'NO_RATE_FOUND'` and still takes precedence over `status`.
`spaceId`, `billable`, `search` and the date window are unchanged.

**Both methods must be edited.** The where-clause is duplicated between them on
purpose (there is a comment at the top of `timeEntriesAggregates` saying so). If
only one side is converted, the metric cards silently disagree with the table
underneath them.

### 8. Controllers

`reports.controller.ts` signatures are unchanged — the params are still
`@Query('status') status?: string`. Only the `@ApiOperation` summaries for
`GET /reports/tasks`, `GET /reports/time-entries` and
`GET /reports/time-entries/aggregates` are updated to document that `status`,
`priority`, `assigneeId`, `client`, `listId`, `folderId` and `userId` accept a
comma-separated list of values (OR semantics), and that a single value behaves
exactly as before.

## Testing

New unit spec `test/report-filter.util.spec.ts` for `csvList`: single value,
multiple values, surrounding whitespace, empty string, comma-only string,
duplicate values, `undefined`.

`test/tasks-report.service.spec.ts`:
- Existing assertions like `expect(arg.where.client).toBe('Acme Corp')` become
  `toEqual({ in: ['Acme Corp'] })` — these double as the regression test that a
  single-value deep-link still works.
- New: multi-value `status`, `priority`, `client`, `listId`, `folderId` each
  produce `{ in: [...] }` with every value.
- New: multi-value `assigneeId` produces an `OR` of `contains` clauses inside
  `where.AND`.
- New: assignee filter and `search` coexist — `where.AND` contains **both** OR
  groups (the regression this restructure exists to prevent).
- New: an empty/comma-only param omits the clause entirely.

`test/time-entries-report.service.spec.ts`:
- Existing single-value assertions updated to `{ in: [...] }`.
- New multi-value cases for `userId`, `status`, `client`, `listId`, `folderId` —
  asserted against **both** `timeEntriesList` and `timeEntriesAggregates`.
- New: `missingOnly=true` still forces the scalar `'NO_RATE_FOUND'` and ignores a
  multi-value `status`.

Frontend has no test runner (`apps/web` only has `tsc -b` + `vite build`), so UI
verification is:

```bash
npm run test          # repo root — backend specs
npm run build         # repo root — nest build
cd apps/web && npm run build   # tsc -b + vite build
```

plus a manual browser pass on both pages (web on `:5174`, backend on `:3002`):
select two clients and confirm the row count and the Time Entries metric cards
both reflect the union; confirm a Missing-Rates deep-link still lands with the
assignee pre-selected.

`npm run lint` is known-broken at the repo root (no root ESLint config; exits 2)
and is excluded from the CI gate — a failure there is not a signal.

## Out of scope (YAGNI)

- Multi-select on the global topbar **Space** filter.
- Multi-select on Type / Archived / Billable / the missing-rate toggle.
- Persisting filter selections to the URL or to local storage.
- "Select all" / "Invert selection" bulk actions in the menu.
- Exact-match (non-substring) assignee filtering.
- A shared `useMultiFilter` hook to deduplicate the two pages' state — eleven
  `useState<string[]>` calls do not yet justify the indirection.

## Note on an unrelated pre-existing issue

`SpacesPage` navigates to `/tasks?spaceId=…` (lines 318 and 495) but
`TasksPage`'s URL effect only reads `taskIds` — the `spaceId` param is silently
dropped. This is a pre-existing dead deep-link, unrelated to multi-select, and is
not fixed by this spec.
