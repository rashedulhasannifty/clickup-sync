# ClickUp Member Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render real ClickUp member profile photos (with an initials fallback) everywhere a ClickUp user appears — time entries, assignee rates, task assignees, and missing-rate rows.

**Architecture:** The backend already fetches `/team/{team}` members and caches them for 10 minutes in `WorkspaceMembersService`; we widen the captured fields to include `profilePicture` and expose the directory via a new `GET /clickup/members` endpoint. The web app gains an `image` prop on the `Avatar` primitive, a `useClickupMembers()` hook that indexes the directory by id and email, and `ClickupAvatar` / `ClickupAvatarStack` wrappers that resolve a person to their photo. App-account avatars (Team page, user menu, etc.) are deliberately left as initials.

**Tech Stack:** NestJS 11 + Jest (backend), React 19 + Vite + TanStack Query + Axios (frontend). The web app has **no unit-test runner**, so frontend tasks are verified with `tsc --noEmit` and `vite build`; backend tasks use Jest TDD.

**Spec:** `docs/superpowers/specs/2026-06-15-clickup-member-avatars-design.md`

---

## File Structure

Backend:
- `src/clickup/clickup.types.ts` — widen `ClickUpMember.user` (modify)
- `src/clickup/workspace-members.service.ts` — cache the directory, add `MemberDto` + `getDirectory()` (modify)
- `src/clickup/workspace-members.service.spec.ts` — extend tests (modify)
- `src/clickup/clickup-members.controller.ts` — `GET /clickup/members` (create)
- `src/clickup/clickup-members.controller.spec.ts` — controller test (create)
- `src/clickup/clickup.module.ts` — register controller (modify)

Frontend:
- `apps/web/src/components/ui/Avatar.tsx` — `image` prop + onError fallback (modify)
- `apps/web/src/api/clickup-members.ts` — API client (create)
- `apps/web/src/hooks/useClickupMembers.ts` — query hook + lookup maps (create)
- `apps/web/src/components/ui/ClickupAvatar.tsx` — `ClickupAvatar` + `ClickupAvatarStack` (create)
- `apps/web/src/pages/TimeEntriesPage.tsx`, `AssigneeRatesPage.tsx`, `MissingRatesPage.tsx`, `TasksPage.tsx` — wire (modify)
- `apps/web/src/components/TimeEntryDrawer.tsx` — wire (modify)

---

## Task 1: Backend — capture `profilePicture` in the member directory

**Files:**
- Modify: `src/clickup/clickup.types.ts`
- Modify: `src/clickup/workspace-members.service.ts`
- Test: `src/clickup/workspace-members.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to `src/clickup/workspace-members.service.spec.ts` inside the existing `describe('WorkspaceMembersService', ...)` block:

```ts
it('getDirectory maps profilePicture/color/initials and drops members without an id', async () => {
  const { client } = makeClient([
    { user: { id: 123, username: 'Ada', email: 'ada@x.com', profilePicture: 'https://cdn/ada.png', color: '#7B68EE', initials: 'AD' } },
    { user: { id: '456', username: 'Bo', email: 'bo@x.com', profilePicture: null } },
    { user: { id: null } },
    {},
  ]);
  const svc = new WorkspaceMembersService(client, settings);
  expect(await svc.getDirectory()).toEqual([
    { id: '123', name: 'Ada', email: 'ada@x.com', profilePicture: 'https://cdn/ada.png', color: '#7B68EE', initials: 'AD' },
    { id: '456', name: 'Bo', email: 'bo@x.com', profilePicture: null, color: null, initials: null },
  ]);
});

it('getDirectory and getMemberIds share a single ClickUp fetch within the TTL', async () => {
  const { client, getTeamMembers } = makeClient([{ user: { id: 1, username: 'A' } }]);
  const svc = new WorkspaceMembersService(client, settings);
  await svc.getDirectory();
  await svc.getMemberIds();
  expect(getTeamMembers).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- workspace-members.service.spec`
Expected: FAIL — `svc.getDirectory is not a function`.

- [ ] **Step 3: Widen the member type**

In `src/clickup/clickup.types.ts`, replace the `ClickUpMember` line:

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

- [ ] **Step 4: Cache the directory in the service**

Replace the body of `src/clickup/workspace-members.service.ts` (keep the file header comment). The cache now holds the mapped directory; `getMemberIds()` derives ids from it so the time-entry sync path is unchanged:

```ts
import { Injectable } from '@nestjs/common';
import { ClickupClient } from './clickup.client';
import { SettingsService } from '../settings/settings.service';

const TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface MemberDto {
  id: string;
  name: string | null;
  email: string | null;
  profilePicture: string | null;
  color: string | null;
  initials: string | null;
}

/**
 * Cached resolver for the workspace's members. Used by the time-entry sync to
 * pass `assignee=<all members>` to ClickUp's `/team/{team}/time_entries`
 * endpoint (the only way to capture tracked time on tasks the loggers are not
 * assignees of), and by the dashboard to render member profile photos. ClickUp
 * is hit at most once per TTL window; concurrent callers share the in-flight
 * promise.
 */
@Injectable()
export class WorkspaceMembersService {
  private cache?: { members: MemberDto[]; expiresAt: number };
  private inFlight?: Promise<MemberDto[]>;

  constructor(
    private readonly clickup: ClickupClient,
    private readonly settings: SettingsService,
  ) {}

  async getDirectory(): Promise<MemberDto[]> {
    if (this.cache && Date.now() < this.cache.expiresAt) return this.cache.members;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const teamId = this.settings.getTeamId();
        const raw = await this.clickup.getTeamMembers(teamId);
        const members: MemberDto[] = raw
          .filter((m) => m?.user?.id !== null && m?.user?.id !== undefined)
          .map((m) => ({
            id: String(m.user.id),
            name: m.user.username ?? null,
            email: m.user.email ?? null,
            profilePicture: m.user.profilePicture ?? null,
            color: m.user.color ?? null,
            initials: m.user.initials ?? null,
          }));
        this.cache = { members, expiresAt: Date.now() + TTL_MS };
        return members;
      } finally {
        this.inFlight = undefined;
      }
    })();
    return this.inFlight;
  }

  async getMemberIds(): Promise<string[]> {
    return (await this.getDirectory()).map((m) => m.id);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- workspace-members.service.spec`
Expected: PASS — all existing tests (ids, caching, dedupe, TTL, team-id) plus the two new ones. The existing `getMemberIds` tests still pass because it now derives from `getDirectory`.

- [ ] **Step 6: Commit**

```bash
git add src/clickup/clickup.types.ts src/clickup/workspace-members.service.ts src/clickup/workspace-members.service.spec.ts
git commit -m "feat(clickup): capture member profilePicture in the workspace directory"
```

---

## Task 2: Backend — `GET /clickup/members` endpoint

**Files:**
- Create: `src/clickup/clickup-members.controller.ts`
- Create: `src/clickup/clickup-members.controller.spec.ts`
- Modify: `src/clickup/clickup.module.ts`

- [ ] **Step 1: Write the failing test**

Create `src/clickup/clickup-members.controller.spec.ts`:

```ts
import { ClickupMembersController } from './clickup-members.controller';
import type { MemberDto } from './workspace-members.service';

describe('ClickupMembersController', () => {
  it('returns the workspace member directory', async () => {
    const directory: MemberDto[] = [
      { id: '1', name: 'Ada', email: 'ada@x.com', profilePicture: 'https://cdn/ada.png', color: '#7B68EE', initials: 'AD' },
    ];
    const members = { getDirectory: jest.fn().mockResolvedValue(directory) } as any;
    const controller = new ClickupMembersController(members);
    expect(await controller.list()).toBe(directory);
    expect(members.getDirectory).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- clickup-members.controller.spec`
Expected: FAIL — cannot find module `./clickup-members.controller`.

- [ ] **Step 3: Create the controller**

Create `src/clickup/clickup-members.controller.ts`. It carries no `@Roles`, so the global `AuthGuard` lets any authenticated user (Owner/Admin/Member) read it — Members render avatars too. Mirrors `ReportsController`'s decorators:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { WorkspaceMembersService, type MemberDto } from './workspace-members.service';

@ApiTags('clickup')
@ApiSecurity('x-admin-key')
@Controller('clickup')
export class ClickupMembersController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get('members')
  @ApiOperation({ summary: 'Workspace member directory (id, name, email, profilePicture) for rendering avatars. Cached ~10 min.' })
  list(): Promise<MemberDto[]> {
    return this.members.getDirectory();
  }
}
```

- [ ] **Step 4: Register the controller**

In `src/clickup/clickup.module.ts`, import the controller and add a `controllers` array. Add the import near the other imports:

```ts
import { ClickupMembersController } from './clickup-members.controller';
```

Then add `controllers` to the `@Module({...})` decorator (it currently has only `imports`, `providers`, `exports`):

```ts
  controllers: [ClickupMembersController],
```

- [ ] **Step 5: Run the test + build to verify**

Run: `npm test -- clickup-members.controller.spec`
Expected: PASS.

Run: `npm run build`
Expected: build succeeds (controller wired into the module with no DI errors).

- [ ] **Step 6: Commit**

```bash
git add src/clickup/clickup-members.controller.ts src/clickup/clickup-members.controller.spec.ts src/clickup/clickup.module.ts
git commit -m "feat(clickup): add GET /clickup/members directory endpoint"
```

---

## Task 3: Frontend — `Avatar` image support

**Files:**
- Modify: `apps/web/src/components/ui/Avatar.tsx`

No web test runner exists; verify with `tsc`.

- [ ] **Step 1: Add the `image` prop and onError fallback**

In `apps/web/src/components/ui/Avatar.tsx`:

1. Add `image?: string | null` to `UserObj` and to `AvatarProps`:

```ts
interface UserObj { name: string; color?: string; initials?: string; image?: string | null }

interface AvatarProps {
  name?: string;
  user?: UserObj;
  size?: 'sm' | 'md' | 'lg' | number;
  color?: string;
  image?: string | null;
}
```

2. Replace the `Avatar` function so a usable image renders as `<img>` and any load error falls back to initials. Add `useState` to the import at the top of the file (`import { useState } from 'react';`):

```tsx
export function Avatar({ name, user, size = 'md', color, image }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const resolvedName = user?.name ?? name ?? '?';
  const bg = color ?? user?.color ?? nameToColor(resolvedName);
  const initials = user?.initials ?? resolvedName.split(' ').map((p: string) => p[0]).join('').toUpperCase().slice(0, 2);
  const px = getPixelSize(size);
  const fontSize = px <= 24 ? 10 : px <= 32 ? 12 : 14;
  const src = image ?? user?.image ?? null;

  if (src && !imgFailed) {
    return (
      <img
        src={src}
        alt={resolvedName}
        title={resolvedName}
        onError={() => setImgFailed(true)}
        style={{
          width: px, height: px, borderRadius: 999,
          objectFit: 'cover', flexShrink: 0, display: 'inline-block',
        }}
      />
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: px, height: px, borderRadius: 999,
        background: bg, color: '#fff',
        fontSize, fontWeight: 700, flexShrink: 0,
        letterSpacing: '-0.02em',
      }}
      title={resolvedName}
    >
      {initials}
    </span>
  );
}
```

`AvatarStack` needs no change — it already spreads `UserObj` (now including `image`) into `Avatar`.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/Avatar.tsx
git commit -m "feat(web): Avatar renders an image with initials fallback on error"
```

---

## Task 4: Frontend — API client + `useClickupMembers` hook

**Files:**
- Create: `apps/web/src/api/clickup-members.ts`
- Create: `apps/web/src/hooks/useClickupMembers.ts`

- [ ] **Step 1: Create the API client**

Create `apps/web/src/api/clickup-members.ts` (follows the `usersApi` pattern; `apiClient` baseURL is `/api`, so this hits `/api/clickup/members`):

```ts
import { apiClient } from './client';

export interface ClickupMember {
  id: string;
  name: string | null;
  email: string | null;
  profilePicture: string | null;
  color: string | null;
  initials: string | null;
}

export const clickupMembersApi = {
  list: () => apiClient.get<ClickupMember[]>('/clickup/members').then((r) => r.data),
};
```

- [ ] **Step 2: Create the hook**

Create `apps/web/src/hooks/useClickupMembers.ts`. Long `staleTime` (matches the backend TTL); a fetch error degrades to an empty directory so avatars fall back to initials instead of surfacing an error:

```ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clickupMembersApi, type ClickupMember } from '../api/clickup-members';

const TEN_MIN = 10 * 60 * 1000;

export function useClickupMembers() {
  const query = useQuery({
    queryKey: ['clickup-members'],
    queryFn: clickupMembersApi.list,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN,
    retry: 1,
  });

  const members: ClickupMember[] = useMemo(() => query.data ?? [], [query.data]);

  const { byId, byEmail } = useMemo(() => {
    const byId = new Map<string, ClickupMember>();
    const byEmail = new Map<string, ClickupMember>();
    for (const m of members) {
      byId.set(m.id, m);
      if (m.email) byEmail.set(m.email.toLowerCase(), m);
    }
    return { byId, byEmail };
  }, [members]);

  return { members, byId, byEmail, isLoading: query.isLoading };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/clickup-members.ts apps/web/src/hooks/useClickupMembers.ts
git commit -m "feat(web): clickup members api client + useClickupMembers hook"
```

---

## Task 5: Frontend — `ClickupAvatar` + `ClickupAvatarStack` wrappers

**Files:**
- Create: `apps/web/src/components/ui/ClickupAvatar.tsx`

- [ ] **Step 1: Create the wrappers**

Create `apps/web/src/components/ui/ClickupAvatar.tsx`. Both resolve a person to their photo via `useClickupMembers()` — by `userId` first, then `email` (case-insensitive) — and fall through to initials when there's no match:

```tsx
import { Avatar, AvatarStack } from './Avatar';
import { useClickupMembers } from '../../hooks/useClickupMembers';

interface ClickupAvatarProps {
  userId?: string | null;
  email?: string | null;
  name?: string | null;
  size?: 'sm' | 'md' | 'lg' | number;
}

export function ClickupAvatar({ userId, email, name, size }: ClickupAvatarProps) {
  const { byId, byEmail } = useClickupMembers();
  const m =
    (userId != null && byId.get(String(userId))) ||
    (email ? byEmail.get(email.toLowerCase()) : undefined) ||
    undefined;
  return (
    <Avatar
      size={size}
      image={m?.profilePicture ?? undefined}
      name={name ?? m?.name ?? email ?? '?'}
    />
  );
}

export interface ClickupPerson { userId?: string | null; email?: string | null; name?: string | null }

export function ClickupAvatarStack({ users, max = 3 }: { users: ClickupPerson[]; max?: number }) {
  const { byId, byEmail } = useClickupMembers();
  const resolved = users.map((u) => {
    const m =
      (u.userId != null && byId.get(String(u.userId))) ||
      (u.email ? byEmail.get(u.email.toLowerCase()) : undefined) ||
      undefined;
    return { name: u.name ?? m?.name ?? u.email ?? '?', image: m?.profilePicture ?? undefined };
  });
  return <AvatarStack users={resolved} max={max} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/ClickupAvatar.tsx
git commit -m "feat(web): ClickupAvatar + ClickupAvatarStack resolve photos by id/email"
```

---

## Task 6: Frontend — wire single-avatar surfaces (time entries, rates, missing rates)

**Files:**
- Modify: `apps/web/src/pages/TimeEntriesPage.tsx:385`
- Modify: `apps/web/src/components/TimeEntryDrawer.tsx:103`
- Modify: `apps/web/src/pages/AssigneeRatesPage.tsx:342`
- Modify: `apps/web/src/pages/MissingRatesPage.tsx:105, :361`

- [ ] **Step 1: Time entries table row**

In `apps/web/src/pages/TimeEntriesPage.tsx`, add the import:

```ts
import { ClickupAvatar } from '../components/ui/ClickupAvatar';
```

Replace line 385 `<Avatar user={{ name: row.userName }} size={22} />` with:

```tsx
<ClickupAvatar userId={row.userId} email={row.userEmail} name={row.userName} size={22} />
```

If `tsc` reports `userId`/`userEmail` are missing on the row type, open the time-entry type in `apps/web/src/api/` (the type backing `row`) and add `userId: string | null` / `userEmail: string | null` — the backend `ClickupTimeEntry` already exposes them.

- [ ] **Step 2: Time entry drawer**

In `apps/web/src/components/TimeEntryDrawer.tsx`, add the import:

```ts
import { ClickupAvatar } from './ui/ClickupAvatar';
```

Replace line 103 `<Avatar user={{ name: entry.userName }} size={36} />` with:

```tsx
<ClickupAvatar userId={entry.userId} email={entry.userEmail} name={entry.userName} size={36} />
```

- [ ] **Step 3: Assignee rates page**

In `apps/web/src/pages/AssigneeRatesPage.tsx`, add the import:

```ts
import { ClickupAvatar } from '../components/ui/ClickupAvatar';
```

Replace line 342 `<Avatar name={g.displayName} size={36} />` with (the group `g` is keyed by assignee id — confirm the field name, commonly `g.assigneeId`, and pass `g.email`/`g.assigneeEmail` if present, else omit `email`):

```tsx
<ClickupAvatar userId={g.assigneeId} name={g.displayName} size={36} />
```

- [ ] **Step 4: Missing rates page**

In `apps/web/src/pages/MissingRatesPage.tsx`, add the import:

```ts
import { ClickupAvatar } from '../components/ui/ClickupAvatar';
```

Replace line 105 `<Avatar name={item.userName} size={36} />` with:

```tsx
<ClickupAvatar userId={item.userId} name={item.userName} size={36} />
```

Replace line 361 `<Avatar name={issue.userName} size={32} />` with:

```tsx
<ClickupAvatar userId={issue.userId} name={issue.userName} size={32} />
```

If `tsc` reports `userId` missing on `item`/`issue`, pass only `name` (the directory has no email either in that case) — resolution then yields initials, which is acceptable. Prefer wiring `userId` if the field exists.

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0. Resolve any missing-field errors per the notes above.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/TimeEntriesPage.tsx apps/web/src/components/TimeEntryDrawer.tsx apps/web/src/pages/AssigneeRatesPage.tsx apps/web/src/pages/MissingRatesPage.tsx
git commit -m "feat(web): show ClickUp photos in time entries, rates, missing rates"
```

---

## Task 7: Frontend — wire task assignees (match by email)

**Files:**
- Modify: `apps/web/src/pages/TasksPage.tsx` (`parseAssignees`, `:180`, `:561`, import)

Task assignees are stored as comma-joined `assigneesNames` / `assigneesEmails` strings with no ids, so they resolve by email.

- [ ] **Step 1: Extend the assignee parser to include emails**

In `apps/web/src/pages/TasksPage.tsx`, replace `parseAssignees` (currently around line 52):

```ts
function parseAssignees(r: Task): { name: string; email?: string }[] {
  const names = String(r.assigneesNames ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const emails = String(r.assigneesEmails ?? '').split(',').map((s) => s.trim());
  return names.map((name, i) => ({ name, email: emails[i] || undefined }));
}
```

- [ ] **Step 2: Swap the stacks to `ClickupAvatarStack`**

Add the import:

```ts
import { ClickupAvatarStack } from '../components/ui/ClickupAvatar';
```

At line ~180 replace `<AvatarStack users={assignees} max={5} />` with:

```tsx
<ClickupAvatarStack users={assignees} max={5} />
```

At line ~561 replace `<AvatarStack users={users} max={3} />` with:

```tsx
<ClickupAvatarStack users={users} max={3} />
```

The `assignees` / `users` arrays are now `{ name, email }[]`, which satisfies `ClickupPerson`. If the old `import { AvatarStack } from '../components/ui/Avatar';` (line 21) is now unused, remove it to keep the lint/build clean.

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0.

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/TasksPage.tsx
git commit -m "feat(web): show ClickUp photos for task assignees (matched by email)"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend tests + build**

Run: `npm test`
Expected: all suites pass (includes the new member service + controller specs).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 2: Frontend typecheck + build**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0, build succeeds.

- [ ] **Step 3: Manual smoke (with the stack running)**

With backend (`:3002`) and `npm run dev` (web) running and logged in:
- Open **Time Entries** — loggers with a ClickUp photo show the photo; others show initials.
- Open **Tasks** — assignee stacks show photos where the assignee's email is in the directory.
- Open **Assignee Rates** and **Missing Rates** — photos resolve by id.
- Confirm **Team** page, user menu, and member drawer still show initials (unchanged).
- Temporarily throttle/offline the `/api/clickup/members` request (DevTools) and confirm every avatar degrades to initials with no blank circles or errors.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(web): clickup member avatars verification cleanup" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** type widening (T1), service directory (T1), endpoint (T2), Avatar image (T3), hook+api (T4), ClickupAvatar/Stack (T5), wiring of all four ClickUp-user surfaces (T6–T7), app-account avatars left untouched (verified in T8). Edge cases (null photo, broken url, empty directory, missing email) handled by Avatar `onError`, the empty-directory fallback in the hook, and initials-on-no-match in the wrappers.
- **Deviation from spec:** the spec listed frontend unit tests for `Avatar` / `ClickupAvatar`, but the web app has no test runner. Rather than add Vitest + Testing Library (out of scope), frontend tasks are verified via `tsc --noEmit`, `vite build`, and the Task 8 manual smoke. Backend keeps Jest TDD.
- **Type consistency:** `MemberDto` (backend) ↔ `ClickupMember` (frontend) carry the same fields; `getDirectory()` is the single name used by the service, controller, and tests; `ClickupPerson` (`{ userId?, email?, name? }`) is the stack input type used in Task 7.
