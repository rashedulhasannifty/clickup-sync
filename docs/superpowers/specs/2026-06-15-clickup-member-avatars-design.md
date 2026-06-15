# ClickUp Member Avatars — Design

**Date:** 2026-06-15
**Status:** Approved (pending implementation plan)

## Problem

ClickUp returns a profile photo (`profilePicture`) for every workspace member, but
the sync service throws it away. The `ClickUpMember.user` type only declares
`{ id, username, email }`, `WorkspaceMembersService` keeps only member IDs, and the
web app's `Avatar` component renders initials only — it has no `<img>` support.

As a result, every place the dashboard shows a ClickUp person (time-entry loggers,
assignee rates, task assignees, missing-rate rows) shows a coloured initials circle
instead of the real ClickUp photo.

## Goal

Show real ClickUp member photos everywhere a **ClickUp user** appears, with a
graceful fallback to the existing initials circle when no photo exists or the image
fails to load.

Explicitly out of scope: **app-account** avatars (Team page members/invites, the
logged-in user menu, member drawer, remove-confirm, accept-invite). Those are local
login accounts, not ClickUp members, and stay initials-only.

## Non-goals (YAGNI)

- No `clickup_users` database table.
- No backend image proxy / byte caching.
- No historical member tracking.

The directory is small (workspace members), changes rarely, and is already fetched
and cached in memory. ClickUp `profilePicture` URLs are public CDN links that load
directly in an `<img>` with no API token, so direct loading is sufficient.

## Architecture

```
ClickUp GET /team/{team}        WorkspaceMembersService          GET /clickup/members
  team.members[].user      ->   (10-min in-memory cache)    ->   directory array
  { id, username, email,        { id, name, email,                     |
    profilePicture, color,        profilePicture, color,               v
    initials }                    initials }                    useClickupMembers()
                                                                 (react-query, maps
                                                                  byId + byEmail)
                                                                        |
                                                                        v
                                                                  ClickupAvatar
                                                                  -> Avatar(image|initials)
```

### Join keys (how a displayed user maps to a photo)

| Surface | Stored key | Resolve by |
|---|---|---|
| Time entries (`ClickupTimeEntry`) | `userId`, `userName`, `userEmail` | `userId` (fallback email) |
| Assignee rates (`AssigneeRate`) | `assigneeId`, `assigneeName`, `assigneeEmail` | `assigneeId` |
| Missing rates | `userId`, `userName` | `userId` (fallback email) |
| Tasks (`ClickupTask`) | `assigneesNames`, `assigneesEmails` (comma-joined strings, **no IDs**) | **email** |

The directory therefore must be indexed by **both** ClickUp user id and email.

## Components

### 1. Backend types — `src/clickup/clickup.types.ts`

Widen the member user shape:

```ts
export interface ClickUpMember {
  user: {
    id: string | number;
    username?: string;
    email?: string;
    profilePicture?: string | null;
    color?: string | null;
    initials?: string | null;
  };
}
```

### 2. `WorkspaceMembersService` — `src/clickup/workspace-members.service.ts`

Today the cache holds `{ ids: string[]; expiresAt }`. Refactor so it holds the
mapped directory and derives IDs from it — **one** `/team/{team}` fetch, **one**
10-minute TTL, existing in-flight-promise sharing preserved.

```ts
interface MemberDto {
  id: string;
  name: string | null;          // from user.username
  email: string | null;
  profilePicture: string | null;
  color: string | null;
  initials: string | null;
}
```

- `getDirectory(): Promise<MemberDto[]>` — new. Maps `team.members[].user`, dropping
  members with no id, `String()`-ing the id.
- `getMemberIds(): Promise<string[]>` — unchanged signature; now derives
  `directory.map(m => m.id)`. The time-entry sync path keeps working untouched.

### 3. Endpoint — `ClickupMembersController` (new, in `clickup.module.ts`)

`GET /clickup/members` → `MemberDto[]`.

- Readable by **any authenticated user** (Owner/Admin/Member) — Members render
  avatars too, so this sits outside the admin API-key gate. The global `AuthGuard`
  still requires a valid session; `RolesGuard` imposes no minimum role.
- Thin: returns `workspaceMembers.getDirectory()`. No new business logic.

### 4. Frontend `Avatar` — `apps/web/src/components/ui/Avatar.tsx`

Add an `image?: string | null` prop and an `image?` field on `UserObj` (so
`AvatarStack` can carry it). Behaviour:

- `image` present **and** loads → render `<img>` filling the circle
  (`width/height = px`, `borderRadius: 999`, `objectFit: 'cover'`).
- `image` null/absent **or** `onError` fires → render the existing initials circle
  (unchanged colour/initials logic).

`Avatar` stays a pure primitive: it does no data fetching and has no knowledge of the
directory. Local `useState` tracks the image error so a broken URL falls back once.

### 5. Frontend `ClickupAvatar` (new) — `apps/web/src/components/ui/ClickupAvatar.tsx`

```ts
interface ClickupAvatarProps {
  userId?: string | null;
  email?: string | null;
  name?: string | null;
  size?: AvatarProps['size'];
}
```

Resolves the photo via `useClickupMembers()`: look up by `userId` first, then by
`email` (case-insensitive). Renders `<Avatar image={photo} name={name ?? email} />`.
When the directory is still loading, empty, or has no match, `image` is undefined and
`Avatar` shows initials — no blank circles, no layout shift beyond the image swap-in.

### 6. Hook + API client

- `apps/web/src/api/clickup-members.ts`: `getClickupMembers(): Promise<MemberDto[]>`
  hitting `GET /clickup/members`.
- `apps/web/src/hooks/useClickupMembers.ts`: react-query with a long `staleTime`
  (~10 min, matching the backend TTL). Exposes the list plus memoised lookup maps
  (`byId`, `byEmail`). A directory fetch error resolves to an empty directory so
  avatars degrade to initials rather than surfacing an error.

## Wiring (call sites)

Swap to `ClickupAvatar` / photo-aware `AvatarStack`:

- `TimeEntriesPage.tsx:385` — `userId` (fallback `userEmail`).
- `TimeEntryDrawer.tsx:103` — `entry.userId` / `entry.userEmail`.
- `AssigneeRatesPage.tsx:342` — `assigneeId`.
- `MissingRatesPage.tsx:105, :361` — `userId` if present, else by name/email.
- `TasksPage.tsx:180, :561` — extend the assignee parser to pair
  `assigneesNames[i]` with `assigneesEmails[i]`, attach `email` to each `UserObj`,
  and have `AvatarStack` resolve each entry's photo by email. (The parser currently
  reads only `assigneesNames`; it gains the parallel email split.)

Leave initials-only (app accounts, **not** ClickUp users):
`TeamPage.tsx:676,775`, `UserMenu.tsx:39,50`, `MemberDrawer.tsx:106`,
`ConfirmRemove.tsx:75`, `AcceptInvitePage.tsx:114`.

## Edge cases

- `profilePicture` is `null` (no photo set) → initials.
- Image URL 404 / network error → `onError` → initials.
- Endpoint error or empty directory → all ClickUp avatars degrade to initials.
- Task assignee whose email isn't in the directory (e.g. left the workspace) →
  initials from the stored name.
- `assigneesNames` / `assigneesEmails` length mismatch → pair by index defensively;
  a missing email just means that entry resolves to initials.

## Testing

Backend:
- `WorkspaceMembersService.getDirectory()` maps `profilePicture/color/initials`,
  `String()`s ids, and drops members without an id.
- `getMemberIds()` still returns the same ids after the refactor (regression).

Frontend:
- `Avatar` renders `<img>` when `image` loads; falls back to initials on `onError`
  and when `image` is null.
- `ClickupAvatar` resolves by id and by email; shows initials when the directory has
  no match or is empty.

## Files touched

Backend:
- `src/clickup/clickup.types.ts` (widen type)
- `src/clickup/workspace-members.service.ts` (cache directory, add `getDirectory`)
- `src/clickup/clickup-members.controller.ts` (new)
- `src/clickup/clickup.module.ts` (register controller)
- `src/clickup/workspace-members.service.spec.ts` (extend)

Frontend:
- `apps/web/src/components/ui/Avatar.tsx` (image prop)
- `apps/web/src/components/ui/ClickupAvatar.tsx` (new)
- `apps/web/src/api/clickup-members.ts` (new)
- `apps/web/src/hooks/useClickupMembers.ts` (new)
- `apps/web/src/pages/TimeEntriesPage.tsx`, `TasksPage.tsx`, `AssigneeRatesPage.tsx`,
  `MissingRatesPage.tsx`
- `apps/web/src/components/TimeEntryDrawer.tsx`
- Tests for `Avatar` / `ClickupAvatar`
