# Team-Scoped Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams own ClickUp clients. Scoped users (org role MEMBER) see only their teams' clients' work. Team leads additionally see cost, edit chargeability and add members. Owner/Admin manage teams from a new `/teams` page and at invite time.

**Architecture:** A pure `resolveScope()` turns a user's team memberships into an `AccessScope`. A global `AccessScopeGuard` attaches that scope to every request, and a `@Scope()` param decorator hands it to controllers. Report services apply it as a Prisma `where` fragment or a `Prisma.Sql` fragment. Both read one derived column, `clickup_tasks.scope_client_option_id`. Cost is masked on the server per row. A guardrail test fails CI if any report route neither takes the scope nor is Owner/Admin-only. Everything ships dark behind `preferences.access.teamScopingEnabled`.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), BullMQ, Jest (backend, `test/*.spec.ts` and `src/**/*.spec.ts`), React + Vite + TanStack Query (`apps/web`, no test runner; verify with `npm run build` + `npm run lint` in `apps/web`).

**Spec:** `docs/superpowers/specs/2026-09-18-team-scoped-access-design.md`. Read it before starting any task; this plan argues from it.

**Delivery: two PRs.** PR 1 = Tasks 1–14: backend scoping, dark behind the flag, no UI change, safe to merge on its own. PR 2 = Tasks 15–19: teams management, invites, web UI, rollout switch. Don't ship all 19 tasks as one branch.

## Global Constraints

- Org `Role` enum (OWNER / ADMIN / MEMBER) is unchanged. "Lead" is `TeamMember.role = LEAD`.
- OWNER and ADMIN are always unrestricted. The `ADMIN_API_KEY` machine principal is a synthetic OWNER and therefore unrestricted by design.
- **Flag off (`teamScopingEnabled = false`) must reproduce today exactly.** MEMBERs read everything including cost, and write nothing.
- **Default deny.** A scoped user with no teams matches **zero** rows. An empty scope must never collapse to "no filter".
- A client (ClickUp option id) belongs to at most one team (`team_clients.option_id` is the PK).
- Scope is resolved **per request** and never cached across requests.
- Access filters read **only** `clickup_tasks.scope_client_option_id`, never the `client` name.
- Cost fields (`costCents`, `hourlyRateCents`, `rateId`, task `cost`, task `estimation`, cost aggregates; not `currency`) are set to `null` on rows whose client the viewer does not LEAD. Aggregates sum only visible cost and return `costPartial: true` when rows were excluded.
- Chargeability writes by a lead are all-or-nothing: one out-of-scope id means a 403 for the whole request.
- `scope_client_option_id` is **derived**, written by sync. It is not a local annotation. `isChargeable` / `chargeableOverride` stay sync-untouchable (existing guardrails).
- No Xero write endpoints, no rate/finance exposure to scoped users.
- Keep Prettier formatting. Never log tokens or secrets. DB writes live in repositories. No `any` for untrusted input.
- Timezone for day bucketing stays `'Asia/Dhaka'`.
- Backend checks: `npm run lint && npm run test && npm run build`. Web checks: `cd apps/web && npm run lint && npm run build`.

## File Structure

**Create (backend)**
| File | Responsibility |
|---|---|
| `src/access/access-scope.ts` | `AccessScope` type + pure `resolveScope()` and predicate helpers |
| `src/access/access-scope.spec.ts` | unit tests for the above |
| `src/access/scope-query.ts` | Prisma `where` + `Prisma.Sql` fragments built from a scope |
| `src/access/scope-query.spec.ts` | tests incl. "empty scope matches nothing" |
| `src/access/cost-mask.ts` | pure per-row cost masking |
| `src/access/cost-mask.spec.ts` | tests |
| `src/access/access-scope.service.ts` | loads memberships from DB, calls `resolveScope` |
| `src/access/access-scope.guard.ts` | global guard: attaches `req.accessScope` |
| `src/access/scope.decorator.ts` | `@Scope()` param decorator, `requireLead()`, `requireUnrestricted()` |
| `src/access/access.module.ts` | wires the above, global |
| `src/access/report-scope.guardrail.spec.ts` | route-classification guardrail |
| `src/clients/client-options.repository.ts` | `clickup_client_options` upserts/reads |
| `src/clients/client-options.service.ts` | extracts client options from field definitions |
| `src/clients/client-options.service.spec.ts` | tests |
| `src/clients/clients.module.ts` | module |
| `src/teams/teams.repository.ts` | teams / team_clients / team_members / invitation_teams |
| `src/teams/teams.service.ts` | business rules (move client, lead add member, readiness) |
| `src/teams/teams.service.spec.ts` | tests |
| `src/teams/teams.controller.ts` | `/teams*` (admin) + `/my-teams*` (lead) |
| `src/teams/dto/*.dto.ts` | DTOs |
| `src/teams/teams.module.ts` | module |
| `src/scripts/backfill-client-option-ids.ts` | one-off backfill from stored `raw` |
| `prisma/migrations/0023_team_scoped_access/migration.sql` | generated |

**Create (web)**
| File | Responsibility |
|---|---|
| `apps/web/src/api/teams.ts` | Teams API client |
| `apps/web/src/hooks/useTeams.ts` | TanStack Query hooks |
| `apps/web/src/pages/TeamsPage.tsx` | Owner/Admin team management (`/teams`) |
| `apps/web/src/pages/MyTeamPage.tsx` | Lead view (`/my-team`) |
| `apps/web/src/components/teams/ClientPicker.tsx` | client multi-select grouped by name, shows owner team |
| `apps/web/src/components/teams/TeamAssignmentRows.tsx` | "team + role" rows reused by the invite modal and Users page |

Note: `apps/web/src/pages/TeamPage.tsx` (route `/team`) is the existing **org users** page. Leave its name alone. The new page is `TeamsPage.tsx` at `/teams`.

**Modify** — listed per task.

---

### Task 1: Pure access scope resolver

**Files:**
- Create: `src/access/access-scope.ts`
- Test: `src/access/access-scope.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TeamRole = 'LEAD' | 'MEMBER';
  export type AccessScope =
    | { kind: 'unrestricted'; canEdit: boolean }
    | { kind: 'scoped'; clients: ReadonlyMap<string, TeamRole>; ledUserClickupIds: readonly string[]; selfClickupId: string | null; ledTeamIds: readonly string[] };
  export interface ScopeInputs {
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    scopingEnabled: boolean;
    selfClickupId: string | null;
    memberships: { teamId: string; role: TeamRole }[];
    teamClients: { teamId: string; optionId: string }[];     // for the user's teams only
    teamMembers: { teamId: string; clickupUserId: string | null }[]; // members of teams the user LEADS
  }
  export function resolveScope(i: ScopeInputs): AccessScope;
  export function isUnrestricted(s: AccessScope): s is Extract<AccessScope, { kind: 'unrestricted' }>;
  export function visibleClientIds(s: AccessScope): string[] | null; // null = all
  export function leadClientIds(s: AccessScope): string[] | null;    // null = all
  export function canSeeCost(s: AccessScope, optionId: string | null): boolean;
  export function canEditChargeability(s: AccessScope, optionId: string | null): boolean;
  export function isLeadAnywhere(s: AccessScope): boolean;
  export function timesheetUserIds(s: AccessScope): string[] | null; // null = anyone
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/access/access-scope.spec.ts
import {
  resolveScope, visibleClientIds, leadClientIds, canSeeCost, canEditChargeability,
  isLeadAnywhere, timesheetUserIds, ScopeInputs,
} from './access-scope';

const base: ScopeInputs = {
  role: 'MEMBER', scopingEnabled: true, selfClickupId: 'cu-me',
  memberships: [], teamClients: [], teamMembers: [],
};

describe('resolveScope', () => {
  it('OWNER and ADMIN are unrestricted and can edit', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const s = resolveScope({ ...base, role });
      expect(s).toEqual({ kind: 'unrestricted', canEdit: true });
      expect(canSeeCost(s, null)).toBe(true);
      expect(canEditChargeability(s, 'x')).toBe(true);
      expect(timesheetUserIds(s)).toBeNull();
    }
  });

  it('flag off: MEMBER reads everything (incl. cost) but cannot edit — exactly today', () => {
    const s = resolveScope({ ...base, scopingEnabled: false });
    expect(s).toEqual({ kind: 'unrestricted', canEdit: false });
    expect(visibleClientIds(s)).toBeNull();
    expect(canSeeCost(s, 'any')).toBe(true);
    expect(canEditChargeability(s, 'any')).toBe(false);
  });

  it('MEMBER with no teams sees nothing (default deny)', () => {
    const s = resolveScope(base);
    expect(visibleClientIds(s)).toEqual([]);
    expect(leadClientIds(s)).toEqual([]);
    expect(isLeadAnywhere(s)).toBe(false);
    expect(timesheetUserIds(s)).toEqual(['cu-me']);
  });

  it('plain member: sees team clients, no cost, no edit', () => {
    const s = resolveScope({
      ...base,
      memberships: [{ teamId: 'A', role: 'MEMBER' }],
      teamClients: [{ teamId: 'A', optionId: 'acme' }],
    });
    expect(visibleClientIds(s)).toEqual(['acme']);
    expect(leadClientIds(s)).toEqual([]);
    expect(canSeeCost(s, 'acme')).toBe(false);
    expect(canEditChargeability(s, 'acme')).toBe(false);
    expect(timesheetUserIds(s)).toEqual(['cu-me']);
  });

  it('lead of A and member of B: per-client rights', () => {
    const s = resolveScope({
      ...base,
      memberships: [{ teamId: 'A', role: 'LEAD' }, { teamId: 'B', role: 'MEMBER' }],
      teamClients: [{ teamId: 'A', optionId: 'acme' }, { teamId: 'B', optionId: 'bolt' }],
      teamMembers: [{ teamId: 'A', clickupUserId: 'cu-1' }, { teamId: 'A', clickupUserId: null }, { teamId: 'A', clickupUserId: 'cu-me' }],
    });
    expect(visibleClientIds(s)!.sort()).toEqual(['acme', 'bolt']);
    expect(leadClientIds(s)).toEqual(['acme']);
    expect(canSeeCost(s, 'acme')).toBe(true);
    expect(canSeeCost(s, 'bolt')).toBe(false);
    expect(canSeeCost(s, null)).toBe(false);
    expect(canEditChargeability(s, 'bolt')).toBe(false);
    expect(isLeadAnywhere(s)).toBe(true);
    expect(timesheetUserIds(s)!.sort()).toEqual(['cu-1', 'cu-me']);
  });

  it('LEAD wins when the same client is reachable through two memberships', () => {
    const s = resolveScope({
      ...base,
      memberships: [{ teamId: 'A', role: 'MEMBER' }, { teamId: 'A2', role: 'LEAD' }],
      teamClients: [{ teamId: 'A', optionId: 'acme' }, { teamId: 'A2', optionId: 'acme' }],
    });
    expect(canSeeCost(s, 'acme')).toBe(true);
  });

  it('a user with no ClickUp link has an empty own timesheet set, but keeps led members', () => {
    const s = resolveScope({
      ...base, selfClickupId: null,
      memberships: [{ teamId: 'A', role: 'LEAD' }],
      teamMembers: [{ teamId: 'A', clickupUserId: 'cu-1' }],
    });
    expect(timesheetUserIds(s)).toEqual(['cu-1']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/access/access-scope.spec.ts`
Expected: FAIL, "Cannot find module './access-scope'".

- [ ] **Step 3: Implement**

```ts
// src/access/access-scope.ts
/**
 * The ONE place team-scoped visibility is decided. Pure: callers load the
 * memberships and pass them in. See
 * docs/superpowers/specs/2026-09-18-team-scoped-access-design.md.
 *
 * Keys are ClickUp "Client" option ids (never names) and are matched against
 * `clickup_tasks.scope_client_option_id`.
 */
export type TeamRole = 'LEAD' | 'MEMBER';

export type AccessScope =
  | { kind: 'unrestricted'; canEdit: boolean }
  | {
      kind: 'scoped';
      clients: ReadonlyMap<string, TeamRole>;
      ledUserClickupIds: readonly string[];
      selfClickupId: string | null;
      ledTeamIds: readonly string[];
    };

export interface ScopeInputs {
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  scopingEnabled: boolean;
  selfClickupId: string | null;
  memberships: { teamId: string; role: TeamRole }[];
  teamClients: { teamId: string; optionId: string }[];
  teamMembers: { teamId: string; clickupUserId: string | null }[];
}

export function resolveScope(i: ScopeInputs): AccessScope {
  if (i.role === 'OWNER' || i.role === 'ADMIN') return { kind: 'unrestricted', canEdit: true };
  // Flag off must reproduce pre-teams behaviour exactly: members read all, write nothing.
  if (!i.scopingEnabled) return { kind: 'unrestricted', canEdit: false };

  const roleByTeam = new Map(i.memberships.map((m) => [m.teamId, m.role]));
  const clients = new Map<string, TeamRole>();
  for (const tc of i.teamClients) {
    const role = roleByTeam.get(tc.teamId);
    if (!role) continue;
    if (clients.get(tc.optionId) !== 'LEAD') clients.set(tc.optionId, role);
  }
  const ledTeamIds = i.memberships.filter((m) => m.role === 'LEAD').map((m) => m.teamId);
  const led = new Set(ledTeamIds);
  const ledUserClickupIds = [
    ...new Set(i.teamMembers.filter((m) => led.has(m.teamId) && m.clickupUserId).map((m) => m.clickupUserId as string)),
  ];
  return { kind: 'scoped', clients, ledUserClickupIds, selfClickupId: i.selfClickupId, ledTeamIds };
}

export function isUnrestricted(s: AccessScope): s is Extract<AccessScope, { kind: 'unrestricted' }> {
  return s.kind === 'unrestricted';
}

/** null = every client (unrestricted). An empty array means NOTHING is visible. */
export function visibleClientIds(s: AccessScope): string[] | null {
  return isUnrestricted(s) ? null : [...s.clients.keys()];
}

export function leadClientIds(s: AccessScope): string[] | null {
  return isUnrestricted(s) ? null : [...s.clients].filter(([, r]) => r === 'LEAD').map(([id]) => id);
}

export function canSeeCost(s: AccessScope, optionId: string | null): boolean {
  if (isUnrestricted(s)) return true;
  return optionId != null && s.clients.get(optionId) === 'LEAD';
}

export function canEditChargeability(s: AccessScope, optionId: string | null): boolean {
  if (isUnrestricted(s)) return s.canEdit;
  return optionId != null && s.clients.get(optionId) === 'LEAD';
}

export function isLeadAnywhere(s: AccessScope): boolean {
  return isUnrestricted(s) ? s.canEdit : s.ledTeamIds.length > 0;
}

/** ClickUp user ids whose timesheet the viewer may open. null = anyone. */
export function timesheetUserIds(s: AccessScope): string[] | null {
  if (isUnrestricted(s)) return null;
  const ids = new Set(s.ledUserClickupIds);
  if (s.selfClickupId) ids.add(s.selfClickupId);
  return [...ids];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/access/access-scope.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/access/access-scope.ts src/access/access-scope.spec.ts
git commit -m "feat(access): pure team scope resolver"
```

---

### Task 2: Scope query fragments and cost masking

**Files:**
- Create: `src/access/scope-query.ts`, `src/access/cost-mask.ts`
- Test: `src/access/scope-query.spec.ts`, `src/access/cost-mask.spec.ts`

**Interfaces:**
- Consumes: `AccessScope`, `visibleClientIds`, `leadClientIds`, `canSeeCost` (Task 1).
- Produces:
  ```ts
  // scope-query.ts
  export function taskScopeWhere(s: AccessScope): Prisma.ClickupTaskWhereInput;          // {} when unrestricted
  export function timeEntryScopeWhere(s: AccessScope): Prisma.ClickupTimeEntryWhereInput;       // {} when unrestricted
  export function taskScopeSql(s: AccessScope, alias: string): Prisma.Sql;               // TRUE | FALSE | alias.scope_client_option_id = ANY(...)
  export function leadScopeSql(s: AccessScope, alias: string): Prisma.Sql;               // same, LEAD clients only
  export function taskIdInScopeSql(s: AccessScope, column: string): Prisma.Sql;          // for tables without a task join
  // cost-mask.ts
  export const COST_FIELDS: readonly string[];
  export function maskCost<T extends Record<string, unknown>>(row: T, s: AccessScope, optionId: string | null, fields?: readonly (keyof T)[]): T;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/access/scope-query.spec.ts
import { Prisma } from '@prisma/client';
import { resolveScope, ScopeInputs } from './access-scope';
import { taskScopeWhere, timeEntryScopeWhere, taskScopeSql, leadScopeSql, taskIdInScopeSql } from './scope-query';

const member = (clients: [string, 'LEAD' | 'MEMBER'][]) => {
  const i: ScopeInputs = {
    role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
    memberships: clients.map(([, r], n) => ({ teamId: `t${n}`, role: r })),
    teamClients: clients.map(([id], n) => ({ teamId: `t${n}`, optionId: id })),
    teamMembers: [],
  };
  return resolveScope(i);
};
const sqlText = (s: Prisma.Sql) => ({ text: s.sql, values: s.values });

describe('scope-query', () => {
  const all = resolveScope({ role: 'ADMIN', scopingEnabled: true, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [] });

  it('unrestricted adds no constraint', () => {
    expect(taskScopeWhere(all)).toEqual({});
    expect(timeEntryScopeWhere(all)).toEqual({});
    expect(sqlText(taskScopeSql(all, 't')).text).toBe('TRUE');
  });

  it('EMPTY scope matches nothing — never "no filter"', () => {
    const none = member([]);
    expect(taskScopeWhere(none)).toEqual({ scopeClientOptionId: { in: [] } });
    expect(timeEntryScopeWhere(none)).toEqual({ task: { scopeClientOptionId: { in: [] } } });
    expect(sqlText(taskScopeSql(none, 't')).text).toBe('FALSE');
    expect(sqlText(taskIdInScopeSql(none, 'e.task_id')).text).toBe('FALSE');
  });

  it('scoped: filters on scope_client_option_id with bound values', () => {
    const s = member([['acme', 'LEAD'], ['bolt', 'MEMBER']]);
    expect(taskScopeWhere(s)).toEqual({ scopeClientOptionId: { in: ['acme', 'bolt'] } });
    const sql = sqlText(taskScopeSql(s, 't'));
    expect(sql.text).toContain('t.scope_client_option_id = ANY(');
    expect(sql.values).toEqual([['acme', 'bolt']]);
    expect(sqlText(leadScopeSql(s, 't')).values).toEqual([['acme']]);
  });

  it('member with no LEAD clients: lead fragment is FALSE', () => {
    expect(sqlText(leadScopeSql(member([['bolt', 'MEMBER']]), 't')).text).toBe('FALSE');
  });

  it('rejects an alias that is not a bare identifier (defence against injection)', () => {
    expect(() => taskScopeSql(member([['a', 'LEAD']]), 't; DROP')).toThrow();
  });
});
```

```ts
// src/access/cost-mask.spec.ts
import { resolveScope } from './access-scope';
import { maskCost } from './cost-mask';

const lead = resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [{ teamId: 'A', role: 'LEAD' }, { teamId: 'B', role: 'MEMBER' }],
  teamClients: [{ teamId: 'A', optionId: 'acme' }, { teamId: 'B', optionId: 'bolt' }],
  teamMembers: [],
});

describe('maskCost', () => {
  const row = { id: 'e1', durationHours: 2, costCents: 5000n, hourlyRateCents: 2500n, rateId: 7n, currency: 'USD' };

  it('keeps cost on a LEAD client', () => {
    expect(maskCost(row, lead, 'acme')).toEqual(row);
  });

  it('nulls every cost field on a MEMBER client, keeps hours and the currency label', () => {
    expect(maskCost(row, lead, 'bolt')).toEqual({ ...row, costCents: null, hourlyRateCents: null, rateId: null });
  });

  it('only touches fields present on the row', () => {
    expect(maskCost({ taskId: 't', cost: 10 }, lead, 'bolt')).toEqual({ taskId: 't', cost: null });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/access/scope-query.spec.ts src/access/cost-mask.spec.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// src/access/scope-query.ts
import { Prisma } from '@prisma/client';
import { AccessScope, leadClientIds, visibleClientIds } from './access-scope';

const IDENT = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i;
function ident(name: string): Prisma.Sql {
  if (!IDENT.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return Prisma.raw(name);
}

/** Prisma filter for `clickup_tasks`. `{}` = no constraint; an empty id list matches nothing. */
export function taskScopeWhere(s: AccessScope): Prisma.ClickupTaskWhereInput {
  const ids = visibleClientIds(s);
  return ids === null ? {} : { scopeClientOptionId: { in: ids } };
}

/** Prisma filter for `clickup_time_entries`, through the task. Task-less entries are excluded when scoped. */
export function timeEntryScopeWhere(s: AccessScope): Prisma.ClickupTimeEntryWhereInput {
  const ids = visibleClientIds(s);
  return ids === null ? {} : { task: { scopeClientOptionId: { in: ids } } };
}

function inIds(ids: string[] | null, column: Prisma.Sql): Prisma.Sql {
  if (ids === null) return Prisma.sql`TRUE`;
  if (ids.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${column} = ANY(${ids}::text[])`;
}

/** `<alias>.scope_client_option_id` is in scope. A NULL (no client / no task on a LEFT JOIN) is out of scope. */
export function taskScopeSql(s: AccessScope, alias: string): Prisma.Sql {
  return inIds(visibleClientIds(s), Prisma.sql`${ident(alias)}.scope_client_option_id`);
}

/** Same, restricted to clients the viewer LEADS — use inside `CASE WHEN ... THEN cost_cents` sums. */
export function leadScopeSql(s: AccessScope, alias: string): Prisma.Sql {
  return inIds(leadClientIds(s), Prisma.sql`${ident(alias)}.scope_client_option_id`);
}

/** For queries with no `clickup_tasks` join (e.g. `clickup_task_events`): `<column> IN (in-scope task ids)`. */
export function taskIdInScopeSql(s: AccessScope, column: string): Prisma.Sql {
  const ids = visibleClientIds(s);
  if (ids === null) return Prisma.sql`TRUE`;
  if (ids.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${ident(column)} IN (SELECT task_id FROM clickup_tasks WHERE scope_client_option_id = ANY(${ids}::text[]))`;
}
```

```ts
// src/access/cost-mask.ts
import { AccessScope, canSeeCost } from './access-scope';

/** Every money field a report row can carry. Hours are never masked. */
// `currency` is deliberately absent: it's a label, not an amount, and keeping it a
// non-null string lets the web type every cost field as `number | null`.
export const COST_FIELDS = [
  'costCents', 'hourlyRateCents', 'rateId', 'cost', 'estimation',
  'validCostCents', 'costAud', 'totalCostAud', 'totalCostCents',
] as const;

/**
 * Null the cost fields of one row unless the viewer may see cost for its client.
 * Nulls rather than deletes, so the JSON shape is stable and the UI renders "—".
 */
export function maskCost<T extends Record<string, unknown>>(
  row: T,
  s: AccessScope,
  optionId: string | null,
  fields: readonly string[] = COST_FIELDS,
): T {
  if (canSeeCost(s, optionId)) return row;
  const out: Record<string, unknown> = { ...row };
  for (const f of fields) if (f in out) out[f] = null;
  return out as T;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/access`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/access/scope-query.ts src/access/scope-query.spec.ts src/access/cost-mask.ts src/access/cost-mask.spec.ts
git commit -m "feat(access): scope query fragments and per-row cost masking"
```

---

### Task 3: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (`User`, `Invitation`, `ClickupTask`; add new models + enum)
- Create: `prisma/migrations/0023_team_scoped_access/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma models `ClickupClientOption`, `Team`, `TeamClient`, `TeamMember`, `InvitationTeam`, enum `TeamRole`; fields `User.clickupUserId`, `Invitation.clickupUserId`, `ClickupTask.clientOptionId`, `ClickupTask.scopeClientOptionId`.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

In `model ClickupTask`, add after `client          String?`:
```prisma
  // ClickUp "Client" dropdown option id — stable across renames (`client` is the name).
  clientOptionId  String?  @map("client_option_id")
  // DERIVED access key, written by sync: own clientOptionId, else the parent's.
  // The ONLY column team scoping reads. Not a local annotation — sync owns it.
  scopeClientOptionId String? @map("scope_client_option_id")
```
and add `@@index([scopeClientOptionId])` next to the other indexes.

In `model User` add `clickupUserId String? @unique @map("clickup_user_id")` and the relation `teamMemberships TeamMember[]`.

In `model Invitation` add `clickupUserId String? @map("clickup_user_id")` and `teams InvitationTeam[]`.

Append the new enum and models exactly as in the spec's "Data model" section (`TeamRole`, `ClickupClientOption`, `Team`, `TeamClient`, `TeamMember`, `InvitationTeam`), and add `teams Team[]` to `model Organization` with `org Organization @relation(fields: [orgId], references: [id])` on `Team`.

- [ ] **Step 2: Generate the migration**

Run: `npm run dev:deps && npx prisma migrate dev --name team_scoped_access --create-only`
Then rename the generated folder to `prisma/migrations/0023_team_scoped_access` (keep the numbering scheme of `0022_xero_finance`).

- [ ] **Step 3: Review the SQL**

Open `migration.sql` and confirm it:
- only `ADD COLUMN`s nullable columns to `clickup_tasks`, `users`, `invitations` (no rewrites of existing data),
- creates `team_clients` with PRIMARY KEY `(option_id)`,
- has `ON DELETE CASCADE` on `team_members.team_id`, `team_members.user_id`, `team_clients.team_id`, `invitation_teams.*`,
- creates `CREATE UNIQUE INDEX "users_clickup_user_id_key"` and `CREATE INDEX` on `clickup_tasks(scope_client_option_id)`.

- [ ] **Step 4: Apply and verify**

Run: `npm run prisma:generate && npm run prisma:deploy && npm run build && npm run test`
Expected: build OK, all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0023_team_scoped_access
git commit -m "feat(db): teams, client option catalog, scope columns"
```

---

### Task 4: Extract the client option id

**Files:**
- Modify: `src/clickup/clickup.types.ts:18` (add `id?: string` to `ClickUpCustomField`)
- Modify: `src/clickup/custom-field-extractor.ts` (return `clientOptionId`)
- Modify: `src/clickup/clickup-normalizer.ts` (`NormalizedTask.clientOptionId`)
- Test: `src/clickup/custom-field-extractor.spec.ts` (create it if absent; otherwise add to it)

**Interfaces:**
- Produces: `ExtractedCustomFields.clientOptionId: string | null`, `NormalizedTask.clientOptionId: string | null`.

- [ ] **Step 1: Write failing tests**

```ts
// in src/clickup/custom-field-extractor.spec.ts
import { CustomFieldExtractor } from './custom-field-extractor';

const clientField = (value: unknown) => ({
  id: 'field-client', name: 'Client', type: 'drop_down', value,
  type_config: { options: [
    { id: 'opt-acme', orderindex: 0, name: 'Acme' },
    { id: 'opt-bolt', orderindex: 1, name: ' Bolt ' },
  ] },
});

describe('CustomFieldExtractor client option id', () => {
  const x = new CustomFieldExtractor();
  it('resolves name and option id from the orderindex value', () => {
    const r = x.extract({ id: 't', custom_fields: [clientField(1)] } as any);
    expect(r.client).toBe('Bolt');
    expect(r.clientOptionId).toBe('opt-bolt');
  });
  it('accepts the option id itself as the value', () => {
    const r = x.extract({ id: 't', custom_fields: [clientField('opt-acme')] } as any);
    expect(r.clientOptionId).toBe('opt-acme');
    expect(r.client).toBe('Acme');
  });
  it('null when unset or unmatched', () => {
    expect(x.extract({ id: 't', custom_fields: [clientField(null)] } as any).clientOptionId).toBeNull();
    expect(x.extract({ id: 't', custom_fields: [clientField(9)] } as any).clientOptionId).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`clientOptionId` undefined): `npx jest src/clickup/custom-field-extractor.spec.ts`

- [ ] **Step 3: Implement**

In `clickup.types.ts`: `export interface ClickUpCustomField { id?: string; name?: string; type?: string; value?: unknown; type_config?: { options?: ClickUpCustomFieldOption[] }; }`

In `custom-field-extractor.ts`:
- Add `clientOptionId: string | null` to `ExtractedCustomFields`; declare `let clientOptionId: string | null = null;`.
- Replace the client line with:
```ts
      if (name === 'client' && cf.type === 'drop_down') {
        const opt = this.findDropdownOption(cf, value);
        client = this.cleanText(opt?.name ?? null);
        clientOptionId = opt?.id ?? null;
      }
```
- Replace `resolveDropdown` with:
```ts
  /** The selected drop_down option: the value is its orderindex, or (newer payloads) its id. */
  private findDropdownOption(cf: ClickUpCustomField, value: unknown): ClickUpCustomFieldOption | undefined {
    const options = cf.type_config?.options ?? [];
    if (typeof value === 'string') {
      const byId = options.find((o) => o.id === value);
      if (byId) return byId;
    }
    const selected = Number(value);
    return options.find((o) => o.orderindex === selected);
  }
```
- Include `clientOptionId` in the return object.

In `clickup-normalizer.ts`: add `clientOptionId: string | null;` to `NormalizedTask` (next to `client`) and `clientOptionId: cf.clientOptionId,` in `normalizeTask`.

- [ ] **Step 4: Run** `npx jest src/clickup test/` then `npm run build`. Expected: PASS. Fix any fixture that builds a `NormalizedTask` literal and now misses `clientOptionId` by adding `clientOptionId: null`.

- [ ] **Step 5: Commit**

```bash
git add src/clickup
git commit -m "feat(clickup): capture the Client dropdown option id"
```

---

### Task 5: Maintain `scope_client_option_id` on sync, plus the backfill

**Files:**
- Modify: `src/tasks/tasks.repository.ts`
- Test: `src/tasks/tasks.repository.spec.ts`
- Create: `src/scripts/backfill-client-option-ids.ts`
- Modify: `package.json` (script `backfill:client-option-ids`)

**Interfaces:**
- Consumes: `NormalizedTask.clientOptionId` (Task 4).
- Produces: `TasksRepository.upsert` now runs in a `$transaction` and writes `scopeClientOptionId`; the backfill script.

Rule: `scope = task.clientOptionId ?? parent.scopeClientOptionId ?? null`. When a task's own `clientOptionId` changes, its subtasks **without their own** `clientOptionId` get the new scope in the same transaction.

- [ ] **Step 1: Write failing tests** (append to `tasks.repository.spec.ts`)

```ts
describe('TasksRepository.upsert scope_client_option_id', () => {
  function setup(parent: { scopeClientOptionId: string | null } | null = null) {
    const tx = {
      clickupTask: {
        findUnique: jest.fn().mockResolvedValue(parent),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = { $transaction: jest.fn((fn: any) => fn(tx)), clickupTask: tx.clickupTask } as unknown as never;
    return { repo: new TasksRepository(prisma), tx };
  }

  it('uses the task’s own option id', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ clientOptionId: 'acme', parentTaskId: null }));
    const call = tx.clickupTask.upsert.mock.calls[0][0];
    expect(call.create.scopeClientOptionId).toBe('acme');
    expect(call.update.scopeClientOptionId).toBe('acme');
  });

  it('a subtask with no client inherits its parent’s scope', async () => {
    const { repo, tx } = setup({ scopeClientOptionId: 'acme' });
    await repo.upsert(makeTask({ taskId: 's1', clientOptionId: null, parentTaskId: 'p1' }));
    expect(tx.clickupTask.findUnique).toHaveBeenCalledWith({ where: { taskId: 'p1' }, select: { scopeClientOptionId: true } });
    expect(tx.clickupTask.upsert.mock.calls[0][0].update.scopeClientOptionId).toBe('acme');
  });

  it('propagates to client-less children, touching only rows that actually differ', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ taskId: 'p1', clientOptionId: 'bolt', parentTaskId: null }));
    expect(tx.clickupTask.updateMany).toHaveBeenCalledWith({
      where: {
        parentTaskId: 'p1', clientOptionId: null,
        OR: [{ scopeClientOptionId: null }, { scopeClientOptionId: { not: 'bolt' } }],
      },
      data: { scopeClientOptionId: 'bolt' },
    });
  });

  it('a null scope only clears children that currently have one', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ taskId: 'p1', clientOptionId: null, parentTaskId: null }));
    expect(tx.clickupTask.updateMany).toHaveBeenCalledWith({
      where: { parentTaskId: 'p1', clientOptionId: null, scopeClientOptionId: { not: null } },
      data: { scopeClientOptionId: null },
    });
  });

  it('still never writes the local isChargeable annotation', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ clientOptionId: 'acme' }));
    const call = tx.clickupTask.upsert.mock.calls[0][0];
    expect(call.create).not.toHaveProperty('isChargeable');
    expect(call.update).not.toHaveProperty('isChargeable');
  });
});
```

Also update the existing `setup()` helpers in this file so `prisma` provides `$transaction: (fn) => fn(prisma)` and `clickupTask.findUnique/updateMany` mocks, because `upsert` becomes async and transactional. Existing assertions stay unchanged.

- [ ] **Step 2: Run, expect FAIL**: `npx jest src/tasks/tasks.repository.spec.ts`

- [ ] **Step 3: Implement.** Replace `upsert` in `tasks.repository.ts`:

```ts
  async upsert(task: NormalizedTask) {
    // (keep the existing comment block about local annotations here)
    const shared = { ...task, raw: task.raw as Prisma.InputJsonValue, isDeleted: false };
    const update: Prisma.ClickupTaskUpdateInput = { ...shared, deletedAt: null, syncCount: { increment: 1 } };
    // (keep the three existing `delete (update as ...)` blocks unchanged)
    return this.prisma.$transaction(async (tx) => {
      // DERIVED access key (see schema): own option id, else the parent's. Sync owns
      // this column — it is NOT a local annotation, so writing it here is correct.
      let scopeClientOptionId = task.clientOptionId;
      if (!scopeClientOptionId && task.parentTaskId) {
        const parent = await tx.clickupTask.findUnique({ where: { taskId: task.parentTaskId }, select: { scopeClientOptionId: true } });
        scopeClientOptionId = parent?.scopeClientOptionId ?? null;
      }
      const row = await tx.clickupTask.upsert({
        where: { taskId: task.taskId },
        create: { ...shared, scopeClientOptionId, syncCount: 1 },
        update: { ...update, scopeClientOptionId },
      });
      // Subtasks without their own client follow this task's scope. This runs for
      // EVERY upsert (whole-space reconciles on a 1.9 GB host), so it must only
      // match rows that actually differ — an unchanged parent is an indexed no-op.
      // Prisma's `not` excludes NULLs, hence the explicit OR.
      await tx.clickupTask.updateMany({
        where: {
          parentTaskId: task.taskId,
          clientOptionId: null,
          ...(scopeClientOptionId === null
            ? { scopeClientOptionId: { not: null } }
            : { OR: [{ scopeClientOptionId: null }, { scopeClientOptionId: { not: scopeClientOptionId } }] }),
        },
        data: { scopeClientOptionId },
      });
      return row;
    });
  }
```

- [ ] **Step 4: Run** `npx jest src/tasks test/` → PASS; `npm run build` → OK.

- [ ] **Step 4b: Performance check.** Locally, run a full space backfill (`POST /admin/sync/backfill` for the largest space, lookback 3650) before and after this change and compare the `sync_job_logs` durations. The per-task transaction adds two indexed round-trips. If the duration grows by more than ~25%, move the child propagation out of `upsert` into one set-based `UPDATE ... FROM` at the end of `TasksService.syncTasks`, and keep only the webhook path per-task.

- [ ] **Step 5: Write the backfill script** `src/scripts/backfill-client-option-ids.ts`, modelled on `src/scripts/backfill-sub-projects.ts` (same header style, same `PrismaClient` + `PrismaPg` + `buildPgPoolConfig` setup, same `--dry-run` flag, `BATCH = 500`, cursor over `taskId`):

```ts
/**
 * One-off backfill for `clickup_tasks.client_option_id` and `scope_client_option_id`.
 * Pass 1 re-extracts the Client option id from each stored `raw` payload (no API calls).
 * Pass 2 derives scope: own id, else parent's (one level — ClickUp subtasks of subtasks
 * inherit through their direct parent, so pass 2 loops until no row changes).
 *
 *   npm run backfill:client-option-ids -- --dry-run
 * Production:
 *   docker compose -f docker-compose.prod.yml exec app-worker node dist/scripts/backfill-client-option-ids.js --dry-run
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildPgPoolConfig } from '../config/connection.config';
import { CustomFieldExtractor } from '../clickup/custom-field-extractor';
import type { ClickUpTask } from '../clickup/clickup.types';

const BATCH = 500;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient({ adapter: new PrismaPg(buildPgPoolConfig(process.env.DATABASE_URL ?? '')) });
  const extractor = new CustomFieldExtractor();
  let cursor: string | undefined;
  let changed = 0;
  for (;;) {
    const rows = await prisma.clickupTask.findMany({
      take: BATCH, ...(cursor ? { skip: 1, cursor: { taskId: cursor } } : {}),
      orderBy: { taskId: 'asc' }, select: { taskId: true, raw: true, clientOptionId: true },
    });
    if (!rows.length) break;
    for (const r of rows) {
      const next = r.raw ? extractor.extract(r.raw as unknown as ClickUpTask).clientOptionId : null;
      if (next !== r.clientOptionId) {
        changed++;
        if (!dryRun) await prisma.clickupTask.update({ where: { taskId: r.taskId }, data: { clientOptionId: next } });
      }
    }
    cursor = rows[rows.length - 1].taskId;
  }
  console.log(`client_option_id: ${changed} row(s) ${dryRun ? 'would change' : 'updated'}`);
  if (dryRun) { await prisma.$disconnect(); return; }

  const own = await prisma.$executeRaw`
    UPDATE clickup_tasks SET scope_client_option_id = client_option_id
    WHERE client_option_id IS NOT NULL AND scope_client_option_id IS DISTINCT FROM client_option_id`;
  let inherited = 0;
  for (let pass = 0; pass < 5; pass++) {
    const n = await prisma.$executeRaw`
      UPDATE clickup_tasks c SET scope_client_option_id = p.scope_client_option_id
      FROM clickup_tasks p
      WHERE c.parent_task_id = p.task_id AND c.client_option_id IS NULL
        AND c.scope_client_option_id IS DISTINCT FROM p.scope_client_option_id`;
    inherited += n;
    if (n === 0) break;
  }
  console.log(`scope_client_option_id: ${own} own, ${inherited} inherited`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Add to `package.json` scripts: `"backfill:client-option-ids": "tsx src/scripts/backfill-client-option-ids.ts",`

- [ ] **Step 6: Run locally** `npm run backfill:client-option-ids -- --dry-run`, then without the flag. Expected: counts print, no errors. Spot check: `SELECT count(*) FILTER (WHERE client IS NOT NULL AND scope_client_option_id IS NULL) FROM clickup_tasks;` should be near 0 (non-zero only for tasks whose `raw` predates the option list).

- [ ] **Step 7: Commit**

```bash
git add src/tasks src/scripts/backfill-client-option-ids.ts package.json
git commit -m "feat(tasks): derive scope_client_option_id on sync + backfill script"
```

---

### Task 6: Client option catalog

**Files:**
- Create: `src/clients/client-options.repository.ts`, `src/clients/client-options.service.ts`, `src/clients/client-options.service.spec.ts`, `src/clients/clients.module.ts`
- Modify: `src/clickup/clickup.client.ts` (add `getWorkspaceFields`, `getSpaceFields`)
- Modify: `src/lists/list-catalog.service.ts`, `src/lists/lists.module.ts` (sync options alongside lists)
- Modify: `src/app.module.ts` (import `ClientsModule`)

**Interfaces:**
- Produces:
  ```ts
  // clickup.client.ts
  getWorkspaceFields(teamId: string): Promise<ClickUpCustomField[]>;   // GET /team/{team_id}/field
  getSpaceFields(spaceId: string): Promise<ClickUpCustomField[]>;      // GET /space/{space_id}/field
  // client-options.service.ts
  export function extractClientOptions(fields: ClickUpCustomField[]): { fieldId: string; optionId: string; name: string }[];
  class ClientOptionsService { syncSpace(spaceId: string): Promise<{ upserted: number; archived: number }>; }
  // client-options.repository.ts
  class ClientOptionsRepository {
    upsertForField(fieldId: string, options: { optionId: string; name: string }[]): Promise<{ upserted: number; archived: number }>;
    list(): Promise<{ optionId: string; fieldId: string; name: string; archived: boolean; teamId: string | null }[]>;
  }
  ```

- [ ] **Step 1: Verify the field shape (one-off, informational).** Add to `ClickupClient`:

```ts
  async getWorkspaceFields(teamId: string): Promise<ClickUpCustomField[]> {
    const res: any = await this.request('GET', `/team/${teamId}/field`);
    return res.fields || [];
  }

  async getSpaceFields(spaceId: string): Promise<ClickUpCustomField[]> {
    const res: any = await this.request('GET', `/space/${spaceId}/field`);
    return res.fields || [];
  }
```
After Step 5, with a real ClickUp token in `.env`, start the app (`npm run start:dev`), call `POST /admin/lists/sync` with the `x-admin-key` header, wait for the backfill queue to drain, then run
`psql "$DATABASE_URL" -c "SELECT field_id, count(*) FROM clickup_client_options GROUP BY 1"`.
One row means one workspace-level Client field. Several rows mean several fields, and the Teams page groups by name (Task 17 already does this). Record the result in the PR description.

- [ ] **Step 2: Write failing tests**

```ts
// src/clients/client-options.service.spec.ts
import { extractClientOptions, ClientOptionsService } from './client-options.service';

const field = (over: object = {}) => ({
  id: 'f1', name: 'Client', type: 'drop_down',
  type_config: { options: [{ id: 'o1', name: 'Acme', orderindex: 0 }, { id: 'o2', name: '  Bolt ', orderindex: 1 }, { id: 'o3', name: '' }] },
  ...over,
});

describe('extractClientOptions', () => {
  it('takes drop_down fields named Client (case-insensitive), trims names, skips empty', () => {
    expect(extractClientOptions([field(), field({ id: 'f2', name: 'Department' })] as any)).toEqual([
      { fieldId: 'f1', optionId: 'o1', name: 'Acme' },
      { fieldId: 'f1', optionId: 'o2', name: 'Bolt' },
    ]);
  });
  it('ignores a non-dropdown field called client', () => {
    expect(extractClientOptions([field({ type: 'short_text' })] as any)).toEqual([]);
  });
});

describe('ClientOptionsService.syncSpace', () => {
  it('upserts per field from workspace + space fields, deduped by field id', async () => {
    const clickup = { getWorkspaceFields: jest.fn().mockResolvedValue([field()]), getSpaceFields: jest.fn().mockResolvedValue([field()]) };
    const repo = { upsertForField: jest.fn().mockResolvedValue({ upserted: 2, archived: 0 }) };
    const settings = { getTeamId: () => 'team' };
    const svc = new ClientOptionsService(clickup as any, repo as any, settings as any);
    await svc.syncSpace('s1');
    expect(repo.upsertForField).toHaveBeenCalledTimes(1);
    expect(repo.upsertForField).toHaveBeenCalledWith('f1', [{ optionId: 'o1', name: 'Acme' }, { optionId: 'o2', name: 'Bolt' }]);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**: `npx jest src/clients`

- [ ] **Step 4: Implement**

```ts
// src/clients/client-options.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import type { ClickUpCustomField } from '../clickup/clickup.types';
import { SettingsService } from '../settings/settings.service';
import { ClientOptionsRepository } from './client-options.repository';

/** Pure: the Client dropdown's options from ClickUp field definitions. */
export function extractClientOptions(fields: ClickUpCustomField[]) {
  const out: { fieldId: string; optionId: string; name: string }[] = [];
  for (const f of fields) {
    if ((f.name ?? '').trim().toLowerCase() !== 'client' || f.type !== 'drop_down' || !f.id) continue;
    for (const o of f.type_config?.options ?? []) {
      const name = (o.name ?? '').trim();
      if (o.id && name) out.push({ fieldId: f.id, optionId: o.id, name });
    }
  }
  return out;
}

@Injectable()
export class ClientOptionsService {
  private readonly logger = new Logger(ClientOptionsService.name);
  constructor(
    private readonly clickup: ClickupClient,
    private readonly repo: ClientOptionsRepository,
    private readonly settings: SettingsService,
  ) {}

  /** Refresh the catalog from workspace-level and this space's Client fields. */
  async syncSpace(spaceId: string) {
    const [ws, sp] = await Promise.all([
      this.clickup.getWorkspaceFields(this.settings.getTeamId()),
      this.clickup.getSpaceFields(spaceId),
    ]);
    const byField = new Map<string, Map<string, string>>();
    for (const o of extractClientOptions([...ws, ...sp])) {
      if (!byField.has(o.fieldId)) byField.set(o.fieldId, new Map());
      byField.get(o.fieldId)!.set(o.optionId, o.name);
    }
    let upserted = 0;
    let archived = 0;
    for (const [fieldId, opts] of byField) {
      const r = await this.repo.upsertForField(fieldId, [...opts].map(([optionId, name]) => ({ optionId, name })));
      upserted += r.upserted;
      archived += r.archived;
    }
    this.logger.log(`Client options for space ${spaceId}: ${upserted} upserted, ${archived} archived`);
    return { upserted, archived };
  }
}
```

```ts
// src/clients/client-options.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ClientOptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert one field's options. Options of THIS field no longer returned by ClickUp
   * are marked archived — never deleted, so a team keeps its mapping and history.
   */
  async upsertForField(fieldId: string, options: { optionId: string; name: string }[]) {
    return this.prisma.$transaction(async (tx) => {
      for (const o of options) {
        await tx.clickupClientOption.upsert({
          where: { optionId: o.optionId },
          create: { optionId: o.optionId, fieldId, name: o.name },
          update: { fieldId, name: o.name, archived: false },
        });
      }
      const { count } = await tx.clickupClientOption.updateMany({
        where: { fieldId, archived: false, optionId: { notIn: options.map((o) => o.optionId) } },
        data: { archived: true },
      });
      return { upserted: options.length, archived: count };
    });
  }

  async list() {
    const rows = await this.prisma.clickupClientOption.findMany({
      orderBy: { name: 'asc' },
      include: { team: { select: { teamId: true } } },
    });
    return rows.map((r) => ({ optionId: r.optionId, fieldId: r.fieldId, name: r.name, archived: r.archived, teamId: r.team?.teamId ?? null }));
  }

  findByIds(ids: string[]) {
    return this.prisma.clickupClientOption.findMany({ where: { optionId: { in: ids } } });
  }
}
```

```ts
// src/clients/clients.module.ts
import { Module } from '@nestjs/common';
import { ClickupModule } from '../clickup/clickup.module';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { ClientOptionsRepository } from './client-options.repository';
import { ClientOptionsService } from './client-options.service';

@Module({
  imports: [ClickupModule, DatabaseModule, SettingsModule],
  providers: [ClientOptionsRepository, ClientOptionsService],
  exports: [ClientOptionsRepository, ClientOptionsService],
})
export class ClientsModule {}
```
(Check the actual module name/path for `SettingsService` with `grep -rn "export class SettingsModule" src` and adjust the import.)

- [ ] **Step 5: Hook into the list-catalog sync.** In `ListsModule` import `ClientsModule`. In `ListCatalogService` inject `ClientOptionsService` and at the end of `syncSpace(spaceId)` add:

```ts
    // Piggyback: the Client option catalog refreshes on the same schedule
    // (daily 03:00 cron, POST /admin/lists/sync, manual backfill). Best-effort —
    // a field-endpoint failure must not fail the list catalog.
    try {
      await this.clientOptions.syncSpace(spaceId);
    } catch (err: any) {
      this.logger.warn(`Client option sync failed for space ${spaceId}: ${err?.message ?? err}`);
    }
```
(Add `private readonly logger = new Logger(ListCatalogService.name)` if absent.) Update `list-catalog.service` spec/constructor calls in tests by passing a `{ syncSpace: jest.fn() }` mock.

- [ ] **Step 6: Run** `npx jest src/clients src/lists test/` and `npm run build`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/clients src/clickup/clickup.client.ts src/lists src/app.module.ts test
git commit -m "feat(clients): ClickUp Client option catalog synced with the list catalog"
```

---

### Task 7: Scope plumbing: flag, service, global guard, decorator, `/auth/me`

**Files:**
- Modify: `src/settings/settings.service.ts` (preference `access.teamScopingEnabled` + getter)
- Create: `src/access/access-scope.service.ts`, `src/access/access-scope.guard.ts`, `src/access/scope.decorator.ts`, `src/access/access.module.ts`
- Modify: `src/auth/auth.module.ts` (register guard after `RolesGuard`), `src/auth/auth.controller.ts` (`me` returns `access`)
- Test: `src/access/access-scope.service.spec.ts`, `src/access/scope.decorator.spec.ts`

**Interfaces:**
- Consumes: Task 1 functions; Prisma models from Task 3.
- Produces:
  ```ts
  SettingsService.isTeamScopingEnabled(): boolean;
  AccessScopeService.forPrincipal(p: AuthPrincipal): Promise<AccessScope>;
  AccessScopeService.summary(p: AuthPrincipal, s: AccessScope): Promise<AccessSummary>;
  export interface AccessSummary {
    scopingEnabled: boolean; unrestricted: boolean;
    teams: { id: string; name: string; role: 'LEAD' | 'MEMBER' }[];
    canSeeCost: boolean; canSeeSprints: boolean; canEditChargeability: boolean;
    hasClickupLink: boolean; timesheetUserIds: string[] | null;
  }
  export function scopeFactory(_d: unknown, ctx: ExecutionContext): AccessScope;
  export const Scope: () => ParameterDecorator;       // createParamDecorator(scopeFactory); reads req.accessScope
  export const SCOPE_PARAM = 'accessScope';
  export function requireLead(s: AccessScope): void;          // 403 unless unrestricted or leads any team
  export function requireUnrestricted(s: AccessScope): void;  // 403 unless unrestricted
  ```

- [ ] **Step 1: Add the preference.** In `settings.service.ts`:
  - `SettingsPreferences` gains `access: { teamScopingEnabled: boolean };`
  - `DEFAULT_PREFERENCES` gains `access: { teamScopingEnabled: false },`
  - add:
  ```ts
  isTeamScopingEnabled(): boolean {
    return this.getPreferences().access?.teamScopingEnabled === true;
  }
  ```
  The existing `update()` + Redis change-publisher already propagate preference patches to every process, so flipping it takes effect on the next request.

- [ ] **Step 2: Write failing tests**

```ts
// src/access/access-scope.service.spec.ts
import { AccessScopeService } from './access-scope.service';

function make(opts: { enabled?: boolean; user?: object; memberships?: object[]; teamClients?: object[]; teamMembers?: object[] } = {}) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(opts.user ?? { clickupUserId: 'cu-me' }) },
    teamMember: {
      findMany: jest.fn()
        .mockResolvedValueOnce(opts.memberships ?? [])   // the user's memberships
        .mockResolvedValueOnce(opts.teamMembers ?? []),  // members of led teams
    },
    teamClient: { findMany: jest.fn().mockResolvedValue(opts.teamClients ?? []) },
  };
  const settings = { isTeamScopingEnabled: () => opts.enabled ?? true };
  return { svc: new AccessScopeService(prisma as any, settings as any), prisma };
}
const member = { userId: 'u1', orgId: 'o', role: 'MEMBER', email: 'm@x', isMachine: false } as any;

describe('AccessScopeService', () => {
  it('does not touch the DB for OWNER/ADMIN or the machine key', async () => {
    const { svc, prisma } = make();
    expect(await svc.forPrincipal({ ...member, role: 'OWNER', isMachine: true })).toEqual({ kind: 'unrestricted', canEdit: true });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not touch the DB when the flag is off', async () => {
    const { svc, prisma } = make({ enabled: false });
    expect(await svc.forPrincipal(member)).toEqual({ kind: 'unrestricted', canEdit: false });
    expect(prisma.teamMember.findMany).not.toHaveBeenCalled();
  });

  it('builds a scoped scope from memberships', async () => {
    const { svc } = make({
      memberships: [{ teamId: 'A', role: 'LEAD' }],
      teamClients: [{ teamId: 'A', optionId: 'acme' }],
      teamMembers: [{ teamId: 'A', user: { clickupUserId: 'cu-2' } }],
    });
    const s = await svc.forPrincipal(member);
    expect(s.kind).toBe('scoped');
    if (s.kind === 'scoped') {
      expect([...s.clients]).toEqual([['acme', 'LEAD']]);
      expect(s.ledUserClickupIds).toEqual(['cu-2']);
    }
  });
});
```

```ts
// src/access/scope.decorator.spec.ts
import { ForbiddenException } from '@nestjs/common';
import { resolveScope } from './access-scope';
import { requireLead, requireUnrestricted } from './scope.decorator';

const mk = (role: 'LEAD' | 'MEMBER' | null) => resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: role ? [{ teamId: 'A', role }] : [], teamClients: [], teamMembers: [],
});

describe('scope assertions', () => {
  it('requireLead passes for a lead, throws for a plain member', () => {
    expect(() => requireLead(mk('LEAD'))).not.toThrow();
    expect(() => requireLead(mk('MEMBER'))).toThrow(ForbiddenException);
  });
  it('requireLead throws for flag-off MEMBER (unrestricted but cannot edit)', () => {
    const s = resolveScope({ role: 'MEMBER', scopingEnabled: false, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [] });
    expect(() => requireLead(s)).toThrow(ForbiddenException);
  });
  it('requireUnrestricted throws for any scoped user', () => {
    expect(() => requireUnrestricted(mk('LEAD'))).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**: `npx jest src/access`

- [ ] **Step 4: Implement**

```ts
// src/access/access-scope.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuthPrincipal } from '../auth/auth.types';
import { AccessScope, canEditChargeability, isLeadAnywhere, isUnrestricted, resolveScope, timesheetUserIds } from './access-scope';

export interface AccessSummary {
  scopingEnabled: boolean;
  unrestricted: boolean;
  teams: { id: string; name: string; role: 'LEAD' | 'MEMBER' }[];
  canSeeCost: boolean;
  canSeeSprints: boolean;
  canEditChargeability: boolean;
  hasClickupLink: boolean;
  timesheetUserIds: string[] | null;
}

@Injectable()
export class AccessScopeService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  /** Resolved fresh on every call — membership changes apply to the very next request. */
  async forPrincipal(p: AuthPrincipal): Promise<AccessScope> {
    const scopingEnabled = this.settings.isTeamScopingEnabled();
    if (p.isMachine || p.role !== 'MEMBER' || !scopingEnabled) {
      return resolveScope({ role: p.role, scopingEnabled, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [] });
    }
    const [user, memberships] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: p.userId }, select: { clickupUserId: true } }),
      this.prisma.teamMember.findMany({ where: { userId: p.userId }, select: { teamId: true, role: true } }),
    ]);
    const teamIds = memberships.map((m) => m.teamId);
    const ledIds = memberships.filter((m) => m.role === 'LEAD').map((m) => m.teamId);
    const [teamClients, ledMembers] = await Promise.all([
      this.prisma.teamClient.findMany({ where: { teamId: { in: teamIds } }, select: { teamId: true, optionId: true } }),
      ledIds.length
        ? this.prisma.teamMember.findMany({ where: { teamId: { in: ledIds } }, select: { teamId: true, user: { select: { clickupUserId: true } } } })
        : Promise.resolve([] as { teamId: string; user: { clickupUserId: string | null } }[]),
    ]);
    return resolveScope({
      role: 'MEMBER', scopingEnabled, selfClickupId: user?.clickupUserId ?? null,
      memberships, teamClients,
      teamMembers: ledMembers.map((m) => ({ teamId: m.teamId, clickupUserId: m.user.clickupUserId })),
    });
  }

  async summary(p: AuthPrincipal, s: AccessScope): Promise<AccessSummary> {
    const teams = p.isMachine ? [] : await this.prisma.teamMember.findMany({
      where: { userId: p.userId }, select: { role: true, team: { select: { id: true, name: true } } }, orderBy: { team: { name: 'asc' } },
    });
    const user = p.isMachine ? null : await this.prisma.user.findUnique({ where: { id: p.userId }, select: { clickupUserId: true } });
    const unrestricted = isUnrestricted(s);
    return {
      scopingEnabled: this.settings.isTeamScopingEnabled(),
      unrestricted,
      teams: teams.map((t) => ({ id: t.team.id, name: t.team.name, role: t.role })),
      canSeeCost: unrestricted || isLeadAnywhere(s),
      canSeeSprints: unrestricted || isLeadAnywhere(s),
      canEditChargeability: unrestricted ? canEditChargeability(s, null) : isLeadAnywhere(s),
      hasClickupLink: !!user?.clickupUserId,
      timesheetUserIds: timesheetUserIds(s),
    };
  }
}
```

```ts
// src/access/scope.decorator.ts
import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AccessScope, isLeadAnywhere, isUnrestricted } from './access-scope';

export const SCOPE_PARAM = 'accessScope';

/** Exported so the route guardrail can recognise @Scope() params by identity. */
export function scopeFactory(_d: unknown, ctx: ExecutionContext): AccessScope {
  const scope = ctx.switchToHttp().getRequest()[SCOPE_PARAM] as AccessScope | undefined;
  // Fail closed: a missing scope is a wiring bug, never "everything".
  if (!scope) throw new ForbiddenException('Access scope unavailable');
  return scope;
}

/** The request's AccessScope, attached by AccessScopeGuard. Every report handler takes it. */
export const Scope = createParamDecorator(scopeFactory);

export function requireLead(s: AccessScope): void {
  if (!isLeadAnywhere(s)) throw new ForbiddenException('Team lead access required');
}

export function requireUnrestricted(s: AccessScope): void {
  if (!isUnrestricted(s)) throw new ForbiddenException('Admin access required');
}
```

```ts
// src/access/access-scope.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth.types';
import { AccessScopeService } from './access-scope.service';
import { SCOPE_PARAM } from './scope.decorator';

/** Runs after AuthGuard/RolesGuard. Public routes (no req.user) are left alone. */
@Injectable()
export class AccessScopeGuard implements CanActivate {
  constructor(private readonly scopes: AccessScopeService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthPrincipal | undefined;
    if (user) req[SCOPE_PARAM] = await this.scopes.forPrincipal(user);
    return true;
  }
}
```

```ts
// src/access/access.module.ts
import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { AccessScopeService } from './access-scope.service';
import { AccessScopeGuard } from './access-scope.guard';

@Global()
@Module({
  imports: [DatabaseModule, SettingsModule],
  providers: [AccessScopeService, AccessScopeGuard],
  exports: [AccessScopeService, AccessScopeGuard],
})
export class AccessModule {}
```

In `auth.module.ts` add, **after** the `RolesGuard` entry: `{ provide: APP_GUARD, useClass: AccessScopeGuard },` and import `AccessModule`. (Nest runs `APP_GUARD`s in registration order.) Import `AccessModule` in `app.module.ts` too.

In `auth.controller.ts` `me()`:
```ts
  @Get('me')
  async me(@CurrentUser() user: AuthPrincipal, @Scope() scope: AccessScope) {
    if (!user) throw new UnauthorizedException();
    const org = await this.orgs.get(user.orgId);
    return {
      user: { id: user.userId, email: user.email, role: user.role, isMachine: user.isMachine },
      org: { id: org?.id, name: org?.name },
      access: await this.access.summary(user, scope),
    };
  }
```
(inject `AccessScopeService` as `access`).

- [ ] **Step 5: Run** `npx jest src/access src/auth test/` and `npm run build`. Expected: PASS. Fix auth controller specs by providing an `AccessScopeService` mock.

- [ ] **Step 6: Commit**

```bash
git add src/access src/settings src/auth src/app.module.ts test
git commit -m "feat(access): per-request scope guard, @Scope decorator, /auth/me access summary"
```

---

### Task 8: Route guardrail and admin-only report routes

**Files:**
- Create: `src/access/report-scope.guardrail.spec.ts`
- Modify: `src/reports/reports.controller.ts` (admin-only `@Roles` on ops/anomaly/spike routes)

**Interfaces:**
- Consumes: `Scope` decorator (Task 7).
- Produces: the guardrail with a shrinking `PENDING` allowlist. Tasks 9–13 each **remove** their handlers from `PENDING`. Task 13 ends with `PENDING` empty.

- [ ] **Step 1: Write the guardrail**

```ts
// src/access/report-scope.guardrail.spec.ts
import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../auth/decorators';
import { ReportsController } from '../reports/reports.controller';
import { AdminTasksController } from '../admin/admin-tasks.controller';
import { scopeFactory } from './scope.decorator';
import { AuthController } from '../auth/auth.controller';

/**
 * Every data route must EITHER take @Scope() (so its service can filter) OR be
 * Owner/Admin-only. A new report route that does neither fails here — default deny
 * is enforced by CI, not by reviewers remembering.
 *
 * PENDING lists routes not yet migrated. It must only ever shrink; Task 13 empties it.
 */
const PENDING = new Set<string>([
  'ReportsController.tasksSummary', 'ReportsController.tasksBySpaceStatus', 'ReportsController.tasksAssignees',
  'ReportsController.timeEntriesAssignees', 'ReportsController.timesheet', 'ReportsController.tasksClients',
  'ReportsController.tasksSubProjects', 'ReportsController.tasksLists', 'ReportsController.tasksFolders',
  'ReportsController.tasks', 'ReportsController.taskDescription', 'ReportsController.taskAssigneeChargeability',
  'ReportsController.chargeablePreview', 'ReportsController.timeEntriesByUser', 'ReportsController.timeEntriesByClient',
  'ReportsController.timeEntriesByDepartment', 'ReportsController.timeEntriesChargeableSummary',
  'ReportsController.timeEntriesAggregates', 'ReportsController.costTrend', 'ReportsController.costTrendByAssignee',
  'ReportsController.costTrendByClient', 'ReportsController.budgetStatus', 'ReportsController.overviewDeltas',
  'ReportsController.timeEntriesByTask', 'ReportsController.timeEntriesList', 'ReportsController.sprintPoints',
  'ReportsController.sprints', 'ReportsController.sprintFolders', 'ReportsController.velocity',
  'ReportsController.sprintDetail', 'ReportsController.spaces', 'ReportsController.cycleTime',
  'ReportsController.timeInStatus', 'ReportsController.work', 'ReportsController.workEntries',
  'AdminTasksController.listChargeabilityRules', 'AdminTasksController.setChargeable',
  'AdminTasksController.setEntryChargeableOverride', 'AdminTasksController.setAssigneeChargeable',
]);

/**
 * EVERY controller in src/, not just reports: the spec promises 403s on /finance,
 * /xero, /users, /invitations and all other /admin routes, so CI must check them.
 * Import each one here (list them with: grep -rl "@Controller" src | grep -v spec).
 */
const CONTROLLERS: Function[] = [
  ReportsController, AdminTasksController,
  // + AuthController, UsersController, InvitationController, FinanceReportsController,
  //   XeroAuthController, HealthController, AdminController, AdminSpikesController,
  //   AdminSyncController, AdminRatesController, AdminBudgetsController,
  //   AdminWebhooksController, AdminDeadLettersController, AdminTagsController,
  //   ClickupMembersController, ClickupWebhookController (import each above)
  // Task 15 adds TeamsController and MyTeamsController.
];

/**
 * Routes that are neither scoped nor admin-only ON PURPOSE. Each needs a reason.
 * Adding to this list is a design decision — say why in the PR.
 */
const NON_DATA: Record<string, string> = {
  'AuthController.logout': 'session only',
  'AuthController.logoutAll': 'session only',
  'ClickupMembersController.members':
    'workspace directory (names, emails, avatars) — every ClickUp member already sees it in ClickUp; ' +
    'the avatar component and the invite picker depend on it being open to all signed-in users',
  // Task 15: 'MyTeamsController.mine': 'returns only the caller’s own memberships',
  //          'MyTeamsController.addMember': 'authorised in TeamsService.leadAddMember (lead of that team)',
};

function isPublic(ctrl: Function, method: string): boolean {
  return Reflect.getMetadata(IS_PUBLIC_KEY, (ctrl.prototype as any)[method]) === true
    || Reflect.getMetadata(IS_PUBLIC_KEY, ctrl) === true;
}

it('CONTROLLERS lists every controller in src/', () => {
  const { execSync } = require('child_process');
  const files: string[] = execSync('grep -rl "@Controller(" src --include=*.ts').toString().trim().split('\n')
    .filter((f: string) => !f.endsWith('.spec.ts'));
  expect(CONTROLLERS.length).toBe(files.length);
});

/** Custom param decorators are stored as `{ index, factory, data, pipes }` under a `__customRouteArgs__` key. */
function takesScope(ctrl: Function, method: string): boolean {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, method) ?? {};
  return Object.values(args).some((a: any) => a?.factory === scopeFactory);
}

function adminOnly(ctrl: Function, method: string): boolean {
  const roles: Role[] | undefined =
    Reflect.getMetadata(ROLES_KEY, (ctrl.prototype as any)[method]) ?? Reflect.getMetadata(ROLES_KEY, ctrl);
  return !!roles && roles.length > 0 && roles.every((r) => r === Role.OWNER || r === Role.ADMIN);
}

function routes(ctrl: Function): string[] {
  return Object.getOwnPropertyNames(ctrl.prototype).filter(
    (m) => m !== 'constructor' && Reflect.getMetadata('path', (ctrl.prototype as any)[m]) !== undefined,
  );
}

describe('report scope guardrail', () => {
  for (const ctrl of CONTROLLERS) {
    for (const m of routes(ctrl)) {
      const key = `${ctrl.name}.${m}`;
      it(`${key} is scoped, admin-only, public, or a reasoned non-data route`, () => {
        const ok = takesScope(ctrl, m) || adminOnly(ctrl, m) || isPublic(ctrl, m) || key in NON_DATA;
        if (PENDING.has(key)) {
          // Fails once migrated so the entry gets deleted from PENDING.
          expect(ok).toBe(false);
        } else {
          expect(ok).toBe(true);
        }
      });
    }
  }
});
```

Sanity-check that the guardrail can see `@Scope()` at all: temporarily add `it('sees @Scope on AuthController.me', () => expect(takesScope(AuthController, 'me')).toBe(true))` (Task 7 added `@Scope()` there), run it, confirm it PASSES, and keep it. It proves the metadata shape matches `takesScope`. If it fails, inspect `Reflect.getMetadata(ROUTE_ARGS_METADATA, AuthController, 'me')` and adjust `takesScope` to the shape you see, still comparing by `scopeFactory` identity.

Replace the comment in `CONTROLLERS` with real imports of every controller, then run the test. Expected: every existing admin controller passes through its class-level `@Roles`; `AuthController.me` passes through `@Scope()` (Task 7); `signup`/`login`, `XeroAuthController.callback`, `HealthController` and `ClickupWebhookController` pass as `@Public()`; `UsersController`, `InvitationController` and `XeroAuthController` pass through their per-route `@Roles`. Anything else that fails is a real gap: fix it, or add it to `NON_DATA` with a reason.

- [ ] **Step 2: Make the admin-only routes explicit.** In `reports.controller.ts` add `@Roles(Role.OWNER, Role.ADMIN)` to: `anomalies`, `hourSpikes`, `syncHealth`, `webhookEvents`, `jobLogs`, `deadLetters`, `stats`, `missingRates`. (Import `Roles` from `../auth/decorators`, `Role` from `@prisma/client`.)

- [ ] **Step 3: Run** `npx jest src/access/report-scope.guardrail.spec.ts`
Expected: PASS. Admin routes pass through `adminOnly`, and every other route is in `PENDING` and currently unscoped.

- [ ] **Step 4: Commit**

```bash
git add src/access/report-scope.guardrail.spec.ts src/access/scope.decorator.ts src/reports/reports.controller.ts
git commit -m "test(access): report route scope guardrail; ops/anomaly/spike routes admin-only"
```

---

### Task 9: Scope the shared where-builders and the list endpoints (tasks, time entries, work)

**Files:**
- Modify: `src/reports/task-filter.util.ts` (`buildTaskWhere` gains required `scope`; `TASK_LIST_SELECT` adds `scopeClientOptionId`)
- Modify: `src/reports/report-filter.util.ts` (`buildTimeEntryWhere` gains required `scope`)
- Modify: `src/reports/tasks-report.service.ts` (`tasks`)
- Modify: `src/reports/time-entries-report.service.ts` (`timeEntriesList`, `timeEntriesAggregates`, `timeEntriesByTask`)
- Modify: `src/reports/work-report.service.ts` (`work`, `workEntries`, private helpers)
- Modify: `src/reports/reports.controller.ts` (the 6 handlers take `@Scope() scope: AccessScope` and pass it)
- Modify: `src/access/report-scope.guardrail.spec.ts` (remove the 6 keys from `PENDING`)
- Test: `src/reports/report-filter.util.spec.ts`, plus new cases in `test/tasks-report.service.spec.ts` / `test/time-entries-report.service.spec.ts` / `test/work-report.service.spec.ts` (use whichever exists; `ls test | grep -i report`)

**Interfaces:**
- Consumes: `taskScopeWhere`, `timeEntryScopeWhere`, `maskCost`, `canSeeCost` (Task 2).
- Produces:
  ```ts
  buildTaskWhere(prisma, f: TaskFilters, scope: AccessScope, opts?: TaskWhereOptions)
  buildTimeEntryWhere(prisma, f: TimeEntryFilters, scope: AccessScope)
  ```
  `scope` is a **required positional param** so the compiler finds every caller.

- [ ] **Step 1: Failing tests for the builders** (add to `src/reports/report-filter.util.spec.ts`)

```ts
import { resolveScope } from '../access/access-scope';
const ADMIN = resolveScope({ role: 'ADMIN', scopingEnabled: true, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [] });
const NONE = resolveScope({ role: 'MEMBER', scopingEnabled: true, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [] });
const prismaStub = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
const win = { from: new Date('2026-01-01'), to: new Date('2026-02-01') };

describe('buildTimeEntryWhere scope', () => {
  it('unrestricted adds no scope clause', async () => {
    const w = await buildTimeEntryWhere(prismaStub, win, ADMIN);
    expect(JSON.stringify(w)).not.toContain('scopeClientOptionId');
  });
  it('empty scope pins to an empty id list (matches nothing)', async () => {
    const w = await buildTimeEntryWhere(prismaStub, win, NONE);
    expect(w.AND).toContainEqual({ task: { scopeClientOptionId: { in: [] } } });
  });
});

describe('buildTaskWhere scope', () => {
  it('empty scope pins to an empty id list', async () => {
    const w = await buildTaskWhere(prismaStub, {}, NONE);
    expect(w.AND).toContainEqual({ scopeClientOptionId: { in: [] } });
  });
});
```
(Import `buildTaskWhere` from `./task-filter.util`.)

- [ ] **Step 2: Run, expect FAIL** (TS arity error / missing clause): `npx jest src/reports/report-filter.util.spec.ts`

- [ ] **Step 3: Implement the builders**
  - `buildTimeEntryWhere(prisma, f, scope: AccessScope)`: right after `const and = [];` add
    ```ts
    // Team scope first: every filter below narrows WITHIN what the viewer may see.
    const scoped = timeEntryScopeWhere(scope);
    if (Object.keys(scoped).length) and.push(scoped);
    ```
  - `buildTaskWhere(prisma, f, scope: AccessScope, opts = {})`: same, with `taskScopeWhere(scope)`, pushed to `and`.
  - `TASK_LIST_SELECT`: add `scopeClientOptionId: true,`.

- [ ] **Step 4: Fix every caller** (the compiler lists them: `npm run build`). For each report method below, add a final `scope: AccessScope` parameter (or a `scope` property on the params object for `timeEntriesByTask` / `WorkParams`), pass it to the builder, and mask cost on the returned rows:

  - `TasksReportService.tasks(..., scope)`: after fetching rows:
    ```ts
    const items = rows.map((r) => maskCost(r, scope, r.scopeClientOptionId));
    ```
    If the method returns summed cost, sum only over rows where `canSeeCost(scope, r.scopeClientOptionId)` and add `costPartial: rows.some((r) => !canSeeCost(scope, r.scopeClientOptionId))`.
  - `TimeEntriesReportService.timeEntriesList(..., scope)`: make sure the query includes `task: { select: { ..., scopeClientOptionId: true } }` (add it to the existing `include`/`select`), then `items.map((e) => maskCost(e, scope, e.task?.scopeClientOptionId ?? null))`.
  - `timeEntriesAggregates(..., scope)`: it aggregates over `where`. Split the cost aggregate: run the existing cost `aggregate`/`groupBy` a second time with `where: { AND: [where, { task: { scopeClientOptionId: { in: leadClientIds(scope)! } } }] }` when `leadClientIds(scope) !== null`, and use that for every cost total. Return `costPartial: leadClientIds(scope) !== null && <total hours count> !== <lead hours count>`. Hours totals keep using `where`.
  - `timeEntriesByTask({ ..., scope })`: rows are grouped by task. Select `scopeClientOptionId` for each task and mask each row's cost fields with `maskCost`.
  - `WorkReportService`: add `scope: AccessScope` to `WorkParams`; `candidates()` and `entryWhere()` pass `p.scope` to the builders; mask each row with the task's `scopeClientOptionId` (already in `TASK_LIST_SELECT`). Compute `totals.cost` only from rows with `canSeeCost`, and add `totals.costPartial`. `workEntries` masks each entry the same way. **Entries with no task (`__none__`)**: when `scope.kind === 'scoped'` they are already excluded by the builder; keep it that way.
  - Controller: add `@Scope() scope: AccessScope` to `tasks`, `timeEntriesList`, `timeEntriesAggregates`, `timeEntriesByTask`, `work`, `workEntries`, and pass it through (`workParams(...)` gains a `scope` argument).
  - Any **other** caller of the builders outside reports (e.g. exports, admin), found by `grep -rn "buildTaskWhere\|buildTimeEntryWhere" src`, passes `{ kind: 'unrestricted', canEdit: true }` explicitly, with a comment saying why it's an internal/admin path.

- [ ] **Step 5: Service-level tests.** In each of the three report service spec files, add one test that runs the method with the `NONE` scope and asserts the Prisma call's `where` contains `{ in: [] }`. Add one test with a lead-of-A/member-of-B scope where rows from client `bolt` come back with `costCents: null` and rows from `acme` keep their cost. Mock `findMany` to return one row per client with `task: { scopeClientOptionId: 'acme' | 'bolt' }`.

- [ ] **Step 6: Remove from `PENDING`**: `ReportsController.tasks`, `timeEntriesList`, `timeEntriesAggregates`, `timeEntriesByTask`, `work`, `workEntries`.

- [ ] **Step 7: Run** `npm run test && npm run build`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/reports src/access test
git commit -m "feat(reports): team-scope tasks, time-entry and work lists; mask cost per row"
```

---

### Task 10: Scope the raw-SQL task reports and facets

**Files:**
- Modify: `src/reports/tasks-report.service.ts`, `src/reports/reports.controller.ts`, `src/access/report-scope.guardrail.spec.ts`
- Test: the tasks-report service spec

**Interfaces:**
- Consumes: `taskScopeSql`, `leadScopeSql`, `taskScopeWhere`, `canSeeCost`, `isUnrestricted` (Tasks 1–2).

The pattern for every raw query over `clickup_tasks` is to add `AND ${taskScopeSql(scope, '<alias>')}` to its `WHERE`. If the query has no alias, alias the table first (`FROM clickup_tasks t`) and prefix the columns it references, or pass the bare table name as alias: `taskScopeSql(scope, 'clickup_tasks')`. Cost sums become `SUM(CASE WHEN ${leadScopeSql(scope, 't')} THEN <cost expr> ELSE 0 END)`.

- [ ] **Step 1: Failing test.** In the tasks-report service spec, for each method below, call it with the `NONE` scope and assert the SQL passed to `$queryRaw` contains `FALSE`:

```ts
const sqlOf = (call: any[]) => (call[0] as Prisma.Sql).sql;
it.each([
  ['tasksSummary', []], ['tasksBySpaceStatus', []], ['tasksAssignees', []],
  ['tasksClients', [{}]], ['tasksSubProjects', [{}]], ['tasksLists', [undefined]],
  ['tasksFolders', [undefined]], ['spaces', []],
])('%s applies an empty scope as FALSE', async (method, args) => {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([]), clickupTask: { groupBy: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) } } as any;
  await (new TasksReportService(prisma) as any)[method](...args, NONE);
  const calls = prisma.$queryRaw.mock.calls;
  if (calls.length) expect(calls.every((c: any[]) => sqlOf(c).includes('FALSE'))).toBe(true);
  else expect(JSON.stringify(prisma.clickupTask.groupBy.mock.calls.concat(prisma.clickupTask.count.mock.calls))).toContain('"in":[]');
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Add a trailing `scope: AccessScope` param to each method and apply it:

| Method | Change |
|---|---|
| `tasksSummary` | Prisma parts: merge `taskScopeWhere(scope)` into each `where`. Raw part: `AND ${taskScopeSql(scope, 'clickup_tasks')}`. |
| `tasksBySpaceStatus` | same |
| `tasksAssignees` | `WHERE ... AND ${taskScopeSql(scope, 'clickup_tasks')}` in the inner select, before `CROSS JOIN LATERAL` |
| `tasksClients` | `AND ${taskScopeSql(scope, 'clickup_tasks')}` |
| `tasksSubProjects` | `AND ${taskScopeSql(scope, 'clickup_tasks')}` |
| `tasksLists`, `tasksFolders` | `AND ${taskScopeSql(scope, 'clickup_tasks')}` |
| `sprintPoints` | `requireLead(scope)` at the top (sprints are hidden for members), then scope its query |
| `spaces` | `WHERE ${taskScopeSql(scope, 't')}` on the task side of the `LEFT JOIN`; wrap each cost sum in `CASE WHEN ${leadScopeSql(scope, 't')}`; add `costPartial` when `!isUnrestricted(scope)` and some rows are not lead-scoped (select `BOOL_OR(NOT ${leadScopeSql(scope,'t')}) AS cost_partial`) |
| `taskDescription(taskId, scope)` | `findFirst({ where: { taskId, ...taskScopeWhere(scope) } })`; `NotFoundException` if null. Never 403, which would confirm the task exists. |
| `chargeablePreview(ids, chargeable, scope)` | same lookup; if the in-scope count ≠ `ids.length`, throw `NotFoundException('Some tasks were not found')` |

Controller: add `@Scope() scope: AccessScope` to `tasksSummary`, `tasksBySpaceStatus`, `tasksAssignees`, `tasksClients`, `tasksSubProjects`, `tasksLists`, `tasksFolders`, `sprintPoints`, `spaces`, `taskDescription`, `chargeablePreview` and pass it.

- [ ] **Step 4: Remove those 11 keys from `PENDING`.**

- [ ] **Step 5: Run** `npm run test && npm run build`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/reports src/access test
git commit -m "feat(reports): team-scope task summaries, facets and spaces"
```

---

### Task 11: Scope the time-entry aggregates and the timesheet

**Files:**
- Modify: `src/reports/time-entries-report.service.ts`, `src/reports/timesheet.assemble.ts`, `src/reports/reports.controller.ts`, guardrail spec
- Test: `src/reports/timesheet.assemble.spec.ts`, time-entries report service spec

**Interfaces:**
- Consumes: `taskScopeSql`, `leadScopeSql`, `canSeeCost`, `timesheetUserIds`, `requireLead`, `isUnrestricted`.
- Produces: `TimesheetAggRow` gains `scopeClientOptionId: string | null`; `assembleTimesheet` output cells gain nullable cost (`validCostCents: number | null`) and a top-level `costPartial: boolean`.

- [ ] **Step 1: Failing tests**

Timesheet authorisation (service spec):
```ts
describe('timesheet access', () => {
  const lead = resolveScope({ role: 'MEMBER', scopingEnabled: true, selfClickupId: 'cu-lead',
    memberships: [{ teamId: 'A', role: 'LEAD' }], teamClients: [{ teamId: 'A', optionId: 'acme' }],
    teamMembers: [{ teamId: 'A', clickupUserId: 'cu-x' }] });
  it('lead may open a member’s timesheet', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
    await expect(new TimeEntriesReportService(prisma).timesheet('cu-x', undefined, undefined, lead)).resolves.toBeDefined();
  });
  it('lead may NOT open an outsider’s timesheet, even one who logged on the lead’s clients', async () => {
    const prisma = { $queryRaw: jest.fn() } as any;
    await expect(new TimeEntriesReportService(prisma).timesheet('cu-outsider', undefined, undefined, lead)).rejects.toThrow(ForbiddenException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('the timesheet is NOT client-filtered (decision 10) — other-team rows come back with null cost', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([
      { day: '2026-09-14', task_id: 't1', task_name: 'Landing', client_option_id: 'acme', user_name: 'X', hours: 5, valid_cost_cents: 25000n, entry_count: 1, missing_rate_count: 0 },
      { day: '2026-09-14', task_id: 't2', task_name: 'Onboarding', client_option_id: 'zulu', user_name: 'X', hours: 3, valid_cost_cents: 15000n, entry_count: 1, missing_rate_count: 0 },
    ]) } as any;
    const sheet = await new TimeEntriesReportService(prisma).timesheet('cu-x', '2026-09-14', '2026-09-14', lead);
    const sql = (prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql).sql;
    expect(sql).not.toContain('scope_client_option_id = ANY');
    expect(JSON.stringify(sheet)).toContain('Onboarding');
    expect(sheet.costPartial).toBe(true);
  });
});
```
Assembler (`timesheet.assemble.spec.ts`): a row with `validCostCents: null` contributes to hours but not to cost totals, and the result has `costPartial: true`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement the timesheet.**
  - `timesheet(userId, fromParam, toParam, scope)`: first
    ```ts
    const allowed = timesheetUserIds(scope);
    if (allowed !== null && !allowed.includes(userId)) throw new ForbiddenException('Not allowed to view this timesheet');
    ```
  - Add `MAX(t.scope_client_option_id) AS client_option_id` to the SELECT (the grouping is per task, so the value is unique). Do **not** add a scope filter (decision 10).
  - Map `validCostCents: canSeeCost(scope, r.client_option_id) ? Number(r.valid_cost_cents) : null` and pass `scopeClientOptionId`.
  - `assembleTimesheet`: treat `validCostCents: null` as "cost hidden". Sum cost only from non-null values, set per-cell/per-day cost to `null` when every contributing row is hidden, and return `costPartial = rows.some(r => r.validCostCents === null)`.
  - Controller `timesheet` takes `@Scope()`.

- [ ] **Step 4: Implement the aggregates.** Add a trailing `scope` param and apply it:

| Method | Change |
|---|---|
| `timeEntriesAssignees(scope)` | if unrestricted, unchanged. Else add `JOIN clickup_tasks t ON t.task_id = clickup_time_entries.task_id` and `AND (${taskScopeSql(scope,'t')} OR clickup_time_entries.user_id = ANY(${timesheetUserIds(scope)}::text[]))`, so the timesheet picker lists led members even with no in-scope entries |
| `timeEntriesByUser` | it uses Prisma `groupBy`: add `...timeEntryScopeWhere(scope)` to its `where`; cost per row via a second `groupBy` on the lead scope as in Task 9's aggregates, or null the cost when `!isUnrestricted(scope)` and the user has non-lead hours, plus `costPartial` |
| `overviewDeltas` | `requireLead(scope)`; `AND ${taskScopeSql(scope,'t')}` in both period queries; cost sums wrapped in `CASE WHEN ${leadScopeSql(scope,'t')}` |
| `timeEntriesByClient` | `AND ${taskScopeSql(scope,'t')}`; cost `CASE WHEN ${leadScopeSql(scope,'t')} THEN e.cost_cents ELSE 0 END`; return `cost: null` for clients the viewer doesn't lead (group key → `canSeeCost(scope, MAX(t.scope_client_option_id))`) |
| `timeEntriesByDepartment` | scope filter + lead-CASE cost + `costPartial` |
| `timeEntriesChargeableSummary` | scope filter (hours only; if it returns cost, lead-CASE it) |
| `taskAssigneeChargeability(taskId, scope)` | first `findFirst({ where: { taskId, ...taskScopeWhere(scope) } })` → `NotFoundException` if missing; mask any cost with `maskCost` |

Controller: `@Scope()` on `timeEntriesAssignees`, `timesheet`, `timeEntriesByUser`, `timeEntriesByClient`, `timeEntriesByDepartment`, `timeEntriesChargeableSummary`, `overviewDeltas`, `taskAssigneeChargeability`.

- [ ] **Step 5: Add scope tests** for `timeEntriesByClient` and `overviewDeltas`: the `NONE` scope's SQL contains `FALSE`, and `overviewDeltas` with a plain member scope throws `ForbiddenException`.

- [ ] **Step 6: Remove those 8 keys from `PENDING`.** Run `npm run test && npm run build`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/reports src/access test
git commit -m "feat(reports): team-scope time-entry aggregates; timesheet access by team"
```

---

### Task 12: Scope sprints and cycle time

**Files:**
- Modify: `src/reports/sprints-report.service.ts`, `src/reports/cycle-time-report.service.ts`, `src/reports/reports.controller.ts`, guardrail spec
- Test: sprints and cycle-time service specs

- [ ] **Step 1: Failing tests.** For `sprints`, `sprintFolders`, `velocity`, `sprintDetail`: a plain-member scope throws `ForbiddenException`. With a lead scope, the SQL contains `scope_client_option_id = ANY(` and `HAVING`. For `cycleTime` / `timeInStatus`: the `NONE` scope's SQL contains `FALSE`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement sprints** (each method gains a trailing `scope`, starts with `requireLead(scope)`):
  - `sprints`: put the scope on the **join**, so a lead's totals cover only their tasks: `LEFT JOIN clickup_tasks t ON t.list_id = l.list_id AND t.is_deleted = false AND ${taskScopeSql(scope,'t')}`. Then, when `!isUnrestricted(scope)`, add `HAVING COUNT(t.task_id) > 0` to the grouped query. Apply the same condition to the total-count query by counting lists with `EXISTS (SELECT 1 FROM clickup_tasks t WHERE t.list_id = l.list_id AND t.is_deleted = false AND ${taskScopeSql(scope,'t')})`. Cost sums use `CASE WHEN ${leadScopeSql(scope,'t')}` (all lead clients here, since `requireLead` passed, but a lead may also be a member elsewhere).
  - `sprintFolders`: count only lists with an in-scope task (same `EXISTS`).
  - `velocity`: scope on the join as above; skip sprints with zero in-scope tasks.
  - `sprintDetail(listId, scope)`: if scoped and no in-scope task in the list → `NotFoundException`. Every sub-query (`status`, `assignee`, `cycle` CTE `sprint_tasks`) adds `AND ${taskScopeSql(scope,'t')}` (alias `clickup_tasks` in the CTE as `t`).
- [ ] **Step 4: Implement cycle time**: `cycleTime(args, scope)` and `timeInStatus(args, scope)` add `AND ${taskIdInScopeSql(scope, 'e.task_id')}` to every query over `clickup_task_events e`, including the `MetaRow` queries (alias the table `e` where it isn't aliased yet).
- [ ] **Step 5: Controller:** `@Scope()` on `sprints`, `sprintFolders`, `velocity`, `sprintDetail`, `cycleTime`, `timeInStatus`. Remove the 6 keys from `PENDING`.
- [ ] **Step 6: Run** `npm run test && npm run build` → PASS.
- [ ] **Step 7: Commit**

```bash
git add src/reports src/access test
git commit -m "feat(reports): team-scope sprints (lead-only) and cycle-time reports"
```

---

### Task 13: Scope cost trends and budgets; empty the guardrail allowlist

**Files:**
- Modify: `src/reports/cost-trend-report.service.ts`, `src/budgets/budgets.service.ts`, `src/reports/reports.controller.ts`, guardrail spec
- Test: cost-trend and budgets service specs

**Interfaces:**
- Produces (budgets): `export function leadBudgetClientNames(leadOptionIds: string[], options: { optionId: string; name: string; teamId: string | null }[], leadTeamIds: string[]): Set<string>`, a pure function in `src/budgets/budget-scope.ts`.

- [ ] **Step 1: Failing tests**

```ts
// src/budgets/budget-scope.spec.ts
import { leadBudgetClientNames } from './budget-scope';
describe('leadBudgetClientNames', () => {
  const opts = [
    { optionId: 'o1', name: 'Acme', teamId: 'A' },
    { optionId: 'o2', name: 'Acme', teamId: 'A' },   // same name, same team: fine
    { optionId: 'o3', name: 'Shared', teamId: 'A' },
    { optionId: 'o4', name: 'Shared', teamId: 'B' }, // same name, different team: ambiguous
  ];
  it('returns names of lead options, excluding names owned by another team', () => {
    expect([...leadBudgetClientNames(['o1', 'o2', 'o3'], opts, ['A'])]).toEqual(['Acme']);
  });
});
```
Cost trends: a plain-member scope → `ForbiddenException`; a lead scope's SQL contains `scope_client_option_id = ANY(` restricted to lead ids (use `leadScopeSql`, not `taskScopeSql`: cost-only views show only LEAD clients).

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**
```ts
// src/budgets/budget-scope.ts
/**
 * Bridge from option-id scope to name-keyed `client_budgets`. A name owned (via any
 * option) by a team the viewer does not lead is ambiguous and excluded — a name
 * filter must never widen access across teams. See spec "Name-keyed data".
 */
export function leadBudgetClientNames(
  leadOptionIds: string[],
  options: { optionId: string; name: string; teamId: string | null }[],
  leadTeamIds: string[],
): Set<string> {
  const lead = new Set(leadOptionIds);
  const ledTeams = new Set(leadTeamIds);
  const foreign = new Set(options.filter((o) => o.teamId && !ledTeams.has(o.teamId)).map((o) => o.name));
  return new Set(options.filter((o) => lead.has(o.optionId) && !foreign.has(o.name)).map((o) => o.name));
}
```
  - Cost trends (`costTrend`, `costTrendBySegment`, and through it `costTrendByAssignee` / `costTrendByClient`) gain a trailing `scope`: `requireLead(scope)` then `AND ${leadScopeSql(scope,'t')}` in every aggregate query.
  - `BudgetsService.clientBudgetStatus({ month, now, scope })`: `requireLead(scope)`. If scoped: spend query adds `AND ${leadScopeSql(scope,'t')}`; load options via `ClientOptionsRepository.list()` (import `ClientsModule` in `BudgetsModule`), compute `allowed = leadBudgetClientNames(leadClientIds(scope)!, options, scope.ledTeamIds)`, and filter budget rows and result rows to `allowed`.
  - Controller: `@Scope()` on `costTrend`, `costTrendByAssignee`, `costTrendByClient`, `budgetStatus`.

- [ ] **Step 4: Empty `PENDING`.** Remove the last 4 report keys. The 4 `AdminTasksController` keys remain until Task 14. Add at the end of the guardrail file:
```ts
it('no ReportsController route is still pending', () => {
  expect([...PENDING].filter((k) => k.startsWith('ReportsController.'))).toEqual([]);
});
```
- [ ] **Step 5: Run** `npm run test && npm run build` → PASS.
- [ ] **Step 6: Commit**

```bash
git add src/reports src/budgets src/access test
git commit -m "feat(reports): lead-only cost trends and budgets; all report routes scoped"
```

---

### Task 14: Chargeability writes for leads (all-or-nothing)

**Files:**
- Modify: `src/admin/admin-tasks.controller.ts`
- Create: `src/access/chargeability-access.service.ts` (+ spec)
- Modify: guardrail spec (empty `PENDING` fully; assert it is empty)

**Interfaces:**
- Produces:
  ```ts
  class ChargeabilityAccessService {
    assertTasks(scope: AccessScope, taskIds: string[]): Promise<void>;       // 403 unless every task is on a LEAD client (or unrestricted & canEdit)
    assertEntries(scope: AccessScope, timeEntryIds: string[]): Promise<void>;
  }
  ```

- [ ] **Step 1: Failing tests**

```ts
// src/access/chargeability-access.service.spec.ts
import { ForbiddenException } from '@nestjs/common';
import { resolveScope } from './access-scope';
import { ChargeabilityAccessService } from './chargeability-access.service';

const lead = resolveScope({ role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [{ teamId: 'A', role: 'LEAD' }, { teamId: 'B', role: 'MEMBER' }],
  teamClients: [{ teamId: 'A', optionId: 'acme' }, { teamId: 'B', optionId: 'bolt' }], teamMembers: [] });

function svc(tasks: { taskId: string; scopeClientOptionId: string | null }[]) {
  const prisma = {
    clickupTask: { findMany: jest.fn().mockResolvedValue(tasks) },
    clickupTimeEntry: { findMany: jest.fn().mockResolvedValue(tasks.map((t, i) => ({ timeEntryId: `e${i}`, task: t }))) },
  };
  return new ChargeabilityAccessService(prisma as any);
}

describe('ChargeabilityAccessService', () => {
  it('allows a lead on their clients', async () => {
    await expect(svc([{ taskId: 't1', scopeClientOptionId: 'acme' }]).assertTasks(lead, ['t1'])).resolves.toBeUndefined();
  });
  it('rejects the WHOLE request if one task is on a member-only client', async () => {
    await expect(svc([{ taskId: 't1', scopeClientOptionId: 'acme' }, { taskId: 't2', scopeClientOptionId: 'bolt' }])
      .assertTasks(lead, ['t1', 't2'])).rejects.toThrow(ForbiddenException);
  });
  it('rejects unknown ids (not found counts as out of scope)', async () => {
    await expect(svc([]).assertTasks(lead, ['nope'])).rejects.toThrow(ForbiddenException);
  });
  it('rejects a flag-off MEMBER', async () => {
    const off = resolveScope({ role: 'MEMBER', scopingEnabled: false, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [] });
    await expect(svc([]).assertTasks(off, ['t1'])).rejects.toThrow(ForbiddenException);
  });
  it('entries: allows only entries whose task is on a lead client', async () => {
    await expect(svc([{ taskId: 't2', scopeClientOptionId: 'bolt' }]).assertEntries(lead, ['e0'])).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/access/chargeability-access.service.ts
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AccessScope, canEditChargeability, isUnrestricted } from './access-scope';

/**
 * All-or-nothing gate for chargeability writes. One id the caller may not edit
 * (or that doesn't exist) rejects the whole request, and the error names no ids —
 * it must not become an existence oracle for other teams' tasks.
 */
@Injectable()
export class ChargeabilityAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertTasks(scope: AccessScope, taskIds: string[]): Promise<void> {
    if (isUnrestricted(scope)) {
      if (!scope.canEdit) throw new ForbiddenException('Not allowed to change chargeability');
      return;
    }
    const rows = await this.prisma.clickupTask.findMany({ where: { taskId: { in: taskIds } }, select: { taskId: true, scopeClientOptionId: true } });
    const ok = rows.length === new Set(taskIds).size && rows.every((r) => canEditChargeability(scope, r.scopeClientOptionId));
    if (!ok) throw new ForbiddenException('Not allowed to change chargeability for one or more items');
  }

  async assertEntries(scope: AccessScope, timeEntryIds: string[]): Promise<void> {
    if (isUnrestricted(scope)) {
      if (!scope.canEdit) throw new ForbiddenException('Not allowed to change chargeability');
      return;
    }
    const rows = await this.prisma.clickupTimeEntry.findMany({
      where: { timeEntryId: { in: timeEntryIds } },
      select: { timeEntryId: true, task: { select: { scopeClientOptionId: true } } },
    });
    const ok = rows.length === new Set(timeEntryIds).size && rows.every((r) => canEditChargeability(scope, r.task?.scopeClientOptionId ?? null));
    if (!ok) throw new ForbiddenException('Not allowed to change chargeability for one or more items');
  }
}
```
Register it in `AccessModule` (providers + exports).

- [ ] **Step 4: Rewire `AdminTasksController`.**
  - Remove the class-level `@Roles(Role.OWNER, Role.ADMIN)`. Keep `@UseInterceptors(AuditLogInterceptor)` at class level, so a lead's writes are audited with the session user as actor.
  - `listChargeabilityRules(@Scope() scope, ...)`: `requireLead(scope)`. When scoped, pass `leadClientIds(scope)` to `this.rules.list({ ..., clientOptionIds })`. In `TaskAssigneeChargeabilityRepository.list` add `where: clientOptionIds ? { task: { scopeClientOptionId: { in: clientOptionIds } } } : {}` to both the rows query and the count query.
  - `setChargeable(@Body() dto, @Scope() scope)`: `await this.access.assertTasks(scope, dto.taskIds)` **before** any write.
  - `setEntryChargeableOverride`: `await this.access.assertEntries(scope, dto.timeEntryIds)` first.
  - `setAssigneeChargeable`: `await this.access.assertTasks(scope, [taskId])` first.
- [ ] **Step 5: Guardrail.** Remove the 4 `AdminTasksController` keys, then replace the "no ReportsController route pending" test with `expect(PENDING.size).toBe(0)` and delete the now-empty `PENDING` branch in the loop.
- [ ] **Step 6: Controller tests** (`test/` or `src/admin/*.spec.ts`, wherever admin-tasks is tested): a lead's out-of-scope bulk request leaves `tasksRepo.setChargeable` and `queues.get().add` **uncalled**, and an in-scope request enqueues `RECALCULATE_COSTS` with the same payload as before.
- [ ] **Step 7: Run** `npm run test && npm run build` → PASS.
- [ ] **Step 8: Commit**

```bash
git add src/access src/admin src/tasks test
git commit -m "feat(chargeability): team leads can edit chargeability on their clients, all-or-nothing"
```

---

### Task 15: Teams backend (admin CRUD, client assignment, members, lead add, readiness)

**Files:**
- Create: `src/teams/teams.repository.ts`, `src/teams/teams.service.ts`, `src/teams/teams.service.spec.ts`, `src/teams/teams.controller.ts`, `src/teams/teams.module.ts`, `src/teams/dto/create-team.dto.ts`, `src/teams/dto/update-team.dto.ts`, `src/teams/dto/set-team-clients.dto.ts`, `src/teams/dto/add-team-member.dto.ts`, `src/teams/dto/set-member-role.dto.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces HTTP:
  | Route | Who | Body / result |
  |---|---|---|
  | `GET /teams` | Owner/Admin | `[{ id, name, clients: [{optionId,name,archived}], members: [{userId,name,email,role,clickupUserId}], pendingInvites: [{invitationId,email,role}] }]` |
  | `POST /teams` | Owner/Admin | `{ name, optionIds: string[] }` → team; 409 if an option is owned by another team |
  | `PATCH /teams/:id` | Owner/Admin | `{ name }` |
  | `DELETE /teams/:id` | Owner/Admin | releases clients, drops memberships (cascade) → `{ releasedClients: n }` |
  | `PUT /teams/:id/clients` | Owner/Admin | `{ optionIds: string[], move?: boolean }`: sets the team's clients. Options owned by another team → 409 `{ conflicts: [{optionId, teamId, teamName}] }` unless `move: true` |
  | `POST /teams/:id/members` | Owner/Admin | `{ userId, role }` |
  | `PATCH /teams/:id/members/:userId` | Owner/Admin | `{ role }` |
  | `DELETE /teams/:id/members/:userId` | Owner/Admin | — |
  | `GET /teams/client-options` | Owner/Admin | catalog with `teamId`/`teamName` |
  | `GET /teams/readiness` | Owner/Admin | `{ unassignedClients, membersWithoutTeam, usersWithoutClickupLink, ambiguousNames }` |
  | `GET /my-teams` | any signed-in user | teams the caller belongs to: clients (names), members, caller's role |
  | `POST /my-teams/:id/members` | lead of that team | `{ userId }`: an **existing active** org user, always added as MEMBER |
- Both controllers use `@UseInterceptors(AuditLogInterceptor)`.

- [ ] **Step 1: Failing service tests** (`teams.service.spec.ts`), with a mocked repository:

```ts
// src/teams/teams.service.spec.ts
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { resolveScope } from '../access/access-scope';
import { TeamsService } from './teams.service';

const admin = { userId: 'admin', orgId: 'org', role: 'ADMIN', email: 'a@x', isMachine: false } as any;
const leadOf = (teamId: string) => resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [{ teamId, role: 'LEAD' }], teamClients: [], teamMembers: [],
});

function make(over: Record<string, jest.Mock> = {}) {
  const repo = {
    ownersOf: jest.fn().mockResolvedValue([]),
    replaceClients: jest.fn().mockResolvedValue([]),
    countClients: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ id: 'A', name: 'Team A' }),
    addMember: jest.fn().mockResolvedValue({}),
    readinessData: jest.fn(),
    ...over,
  };
  const users = { findById: jest.fn() };
  return { svc: new TeamsService(repo as any, users as any), repo, users };
}

describe('TeamsService', () => {
  it('setClients refuses options owned by another team without move', async () => {
    const { svc, repo } = make({ ownersOf: jest.fn().mockResolvedValue([{ optionId: 'o1', teamId: 'B', team: { id: 'B', name: 'Apps' } }]) });
    const err = await svc.setClients(admin, 'A', ['o1'], false).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().conflicts).toEqual([{ optionId: 'o1', teamId: 'B', teamName: 'Apps' }]);
    expect(repo.replaceClients).not.toHaveBeenCalled();
  });

  it('setClients with move reassigns and reports the from-team', async () => {
    const { svc, repo } = make({ ownersOf: jest.fn().mockResolvedValue([{ optionId: 'o1', teamId: 'B', team: { id: 'B', name: 'Apps' } }]) });
    const res = await svc.setClients(admin, 'A', ['o1', 'o2'], true);
    expect(repo.replaceClients).toHaveBeenCalledWith('A', ['o1', 'o2'], 'admin');
    expect(res).toEqual({ clients: 2, moved: [{ optionId: 'o1', fromTeamId: 'B' }] });
  });

  it('options already on this team are not conflicts', async () => {
    const { svc, repo } = make({ ownersOf: jest.fn().mockResolvedValue([{ optionId: 'o1', teamId: 'A', team: { id: 'A', name: 'Team A' } }]) });
    await svc.setClients(admin, 'A', ['o1'], false);
    expect(repo.replaceClients).toHaveBeenCalled();
  });

  it('create rolls the team back when its clients conflict', async () => {
    const { svc, repo } = make({ ownersOf: jest.fn().mockResolvedValue([{ optionId: 'o1', teamId: 'B', team: { id: 'B', name: 'Apps' } }]) });
    await expect(svc.create(admin, 'Team A', ['o1'])).rejects.toBeInstanceOf(ConflictException);
    expect(repo.delete).toHaveBeenCalledWith('A');
  });

  it('deleteTeam returns the number of released clients', async () => {
    const { svc, repo } = make({ countClients: jest.fn().mockResolvedValue(5) });
    await expect(svc.deleteTeam('A')).resolves.toEqual({ releasedClients: 5 });
    expect(repo.delete).toHaveBeenCalledWith('A');
  });

  it('lead adds an existing ACTIVE org user, always as MEMBER', async () => {
    const { svc, repo, users } = make();
    users.findById.mockResolvedValue({ id: 'u2', orgId: 'org', status: 'ACTIVE' });
    await svc.leadAddMember(leadOf('A'), { ...admin, userId: 'lead', role: 'MEMBER' }, 'A', 'u2');
    expect(repo.addMember).toHaveBeenCalledWith('A', 'u2', 'MEMBER', 'lead');
  });

  it('lead cannot add to a team they do not lead', async () => {
    const { svc, repo } = make();
    await expect(svc.leadAddMember(leadOf('B'), { ...admin, role: 'MEMBER' }, 'A', 'u2')).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null],
    ['disabled', { id: 'u2', orgId: 'org', status: 'DISABLED' }],
    ['other org', { id: 'u2', orgId: 'other', status: 'ACTIVE' }],
  ])('lead cannot add a %s user', async (_label, user) => {
    const { svc, repo, users } = make();
    users.findById.mockResolvedValue(user);
    await expect(svc.leadAddMember(leadOf('A'), { ...admin, role: 'MEMBER' }, 'A', 'u2')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it('readiness lists unassigned clients, team-less members, unlinked users and ambiguous names', async () => {
    const { svc } = make({
      readinessData: jest.fn().mockResolvedValue([
        [{ optionId: 'o9', name: 'Hotel' }],
        [{ id: 'u3', name: 'M', email: 'm@x' }],
        [{ id: 'u4', name: 'N', email: 'n@x' }],
        [
          { optionId: 'o1', name: 'Shared', team: { id: 'A' } },
          { optionId: 'o2', name: 'Shared', team: { id: 'B' } },
          { optionId: 'o3', name: 'Acme', team: { id: 'A' } },
          { optionId: 'o4', name: 'Acme', team: { id: 'A' } },
        ],
      ]),
    });
    await expect(svc.readiness('org')).resolves.toEqual({
      unassignedClients: [{ optionId: 'o9', name: 'Hotel' }],
      membersWithoutTeam: [{ id: 'u3', name: 'M', email: 'm@x' }],
      usersWithoutClickupLink: [{ id: 'u4', name: 'N', email: 'n@x' }],
      ambiguousNames: ['Shared'],
    });
  });
});
```
`TeamsService`'s constructor is `(repo: TeamsRepository, users: UserRepository)`. Idempotent re-adds are guaranteed by the repository's `upsert` with `update: {}`, so no service-level test is needed for that.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement the repository** (all Prisma here):

```ts
// src/teams/teams.repository.ts (core methods)
@Injectable()
export class TeamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listFull(orgId: string) {
    return this.prisma.team.findMany({
      where: { orgId }, orderBy: { name: 'asc' },
      include: {
        clients: { include: { option: true } },
        members: { include: { user: { select: { id: true, name: true, email: true, clickupUserId: true, status: true } } } },
        invitations: { include: { invitation: { select: { id: true, email: true, status: true } } } },
      },
    });
  }
  create(orgId: string, name: string) { return this.prisma.team.create({ data: { orgId, name } }); }
  rename(id: string, name: string) { return this.prisma.team.update({ where: { id }, data: { name } }); }
  countClients(teamId: string) { return this.prisma.teamClient.count({ where: { teamId } }); }
  delete(id: string) { return this.prisma.team.delete({ where: { id } }); } // cascades clients/members/invitation_teams
  ownersOf(optionIds: string[]) {
    return this.prisma.teamClient.findMany({ where: { optionId: { in: optionIds } }, include: { team: { select: { id: true, name: true } } } });
  }
  /** Replace a team's client set atomically; moved options are deleted from their old team first. */
  replaceClients(teamId: string, optionIds: string[], addedBy: string) {
    return this.prisma.$transaction([
      this.prisma.teamClient.deleteMany({ where: { OR: [{ teamId, optionId: { notIn: optionIds } }, { optionId: { in: optionIds }, teamId: { not: teamId } }] } }),
      this.prisma.teamClient.createMany({ data: optionIds.map((optionId) => ({ optionId, teamId, addedBy })), skipDuplicates: true }),
    ]);
  }
  addMember(teamId: string, userId: string, role: 'LEAD' | 'MEMBER', addedBy: string) {
    return this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { teamId, userId, role, addedBy },
      update: {}, // idempotent: never silently change an existing role here
    });
  }
  setMemberRole(teamId: string, userId: string, role: 'LEAD' | 'MEMBER') {
    return this.prisma.teamMember.update({ where: { teamId_userId: { teamId, userId } }, data: { role } });
  }
  removeMember(teamId: string, userId: string) {
    return this.prisma.teamMember.delete({ where: { teamId_userId: { teamId, userId } } });
  }
  membershipsOf(userId: string) {
    return this.prisma.teamMember.findMany({ where: { userId }, include: { team: { include: { clients: { include: { option: true } }, members: { include: { user: { select: { id: true, name: true, email: true } } } } } } } });
  }
  readinessData(orgId: string) {
    return Promise.all([
      this.prisma.clickupClientOption.findMany({ where: { archived: false, team: null }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({ where: { orgId, role: 'MEMBER', status: 'ACTIVE', teamMemberships: { none: {} } }, select: { id: true, name: true, email: true } }),
      this.prisma.user.findMany({ where: { orgId, status: 'ACTIVE', clickupUserId: null }, select: { id: true, name: true, email: true } }),
      this.prisma.clickupClientOption.findMany({ include: { team: true } }),
    ]);
  }
}
```

- [ ] **Step 4: Implement the service** (`teams.service.ts`), with the rules the tests pin down:
  - `setClients(actor, teamId, optionIds, move)`: `owners = ownersOf(optionIds).filter(o => o.teamId !== teamId)`. If `owners.length && !move` → `throw new ConflictException({ message: 'Some clients belong to another team', conflicts: owners.map(o => ({ optionId: o.optionId, teamId: o.team.id, teamName: o.team.name })) })`. Otherwise `replaceClients` and return `{ clients: optionIds.length, moved: owners.map(o => ({ optionId: o.optionId, fromTeamId: o.team.id })) }`. The return value is written into the audit log response, which records from-team and to-team.
  - `create(actor, name, optionIds)`: create, then `setClients(..., move=false)`. If that throws, delete the new team and rethrow, so a conflict never leaves a half-made team.
  - `deleteTeam(id)` → `{ releasedClients: await countClients(id) }` then `delete(id)`.
  - `leadAddMember(scope, actor: AuthPrincipal, teamId, userId)`: allowed if `isUnrestricted(scope) && scope.canEdit` (Owner/Admin) or `scope.kind === 'scoped' && scope.ledTeamIds.includes(teamId)`, else `ForbiddenException`. `users.findById(userId)` must exist, have `orgId === actor.orgId` and `status === 'ACTIVE'`, else `BadRequestException('User not found or inactive')`. Then `repo.addMember(teamId, userId, 'MEMBER', actor.userId)`.
  - `readiness(orgId)`: unassigned options; MEMBERs with no team; users with no ClickUp link; `ambiguousNames` = names whose options belong to 2+ distinct teams.
  - Unique team name per org: catch Prisma `P2002` → `ConflictException('A team with that name already exists')`.

- [ ] **Step 5: Implement the controllers.** `TeamsController` (`@Controller('teams')`, class-level `@Roles(Role.OWNER, Role.ADMIN)`, `@UseInterceptors(AuditLogInterceptor)`) with the routes above. Declare static paths (`client-options`, `readiness`) **before** `:id` routes. `MyTeamsController` (`@Controller('my-teams')`, no `@Roles`, `@UseInterceptors(AuditLogInterceptor)`): `GET /my-teams` returns the caller's memberships (clients by name, members by name/email, the caller's role; no cost, no ClickUp ids); `POST /my-teams/:id/members` calls `leadAddMember`. DTOs use `class-validator` like `src/auth/dto/*`: `@IsString() @MaxLength(80) name`, `@IsArray() @ArrayMaxSize(500) @IsString({ each: true }) optionIds`, `@IsIn(['LEAD','MEMBER']) role`, `@IsOptional() @IsBoolean() move`.

- [ ] **Step 5a: Guardrail.** Add `TeamsController` and `MyTeamsController` to `CONTROLLERS` in `src/access/report-scope.guardrail.spec.ts` and uncomment their two `NON_DATA` entries.

- [ ] **Step 6: Module** `TeamsModule` imports `DatabaseModule`, `ClientsModule`, `AdminModule` (or wherever `AuditLogInterceptor`/`AuditLogRepository` are provided; check with `grep -rn "AuditLogRepository" src/admin/*.module.ts`). Register it in `app.module.ts`.

- [ ] **Step 7: Run** `npm run test && npm run build` → PASS. Smoke test: `npm run start:dev`, `curl -H "x-admin-key: $ADMIN_API_KEY" localhost:3000/teams/readiness`.

- [ ] **Step 8: Commit**

```bash
git add src/teams src/app.module.ts
git commit -m "feat(teams): team CRUD, client assignment with explicit move, lead add-member, readiness"
```

---

### Task 16: Invitations carry teams; users link to ClickUp

**Files:**
- Modify: `src/auth/dto/create-invitation.dto.ts`, `src/auth/invitation.service.ts`, `src/auth/invitation.repository.ts`, `src/auth/users.controller.ts`, `src/auth/users.service.ts`, `src/auth/auth.module.ts`
- Create: `src/auth/dto/set-clickup-user.dto.ts`
- Test: `src/auth/invitation.service.spec.ts`, `src/auth/users.service.spec.ts`

**Interfaces:**
- Consumes: `TeamsRepository.addMember` (Task 15), `WorkspaceMembersService.getDirectory()`.
- Produces:
  - `POST /invitations` body: `{ email, role, teams?: { teamId: string; role: 'LEAD'|'MEMBER' }[], clickupUserId?: string | null }`. If `clickupUserId` is `undefined`, auto-match by email against the ClickUp directory; `null` means "no link".
  - `GET /invitations` rows include `teams: [{ teamId, teamName, role }]` and `clickupUserId`.
  - `PATCH /users/:id/clickup-user` (Owner/Admin): `{ clickupUserId: string | null }` → 409 if that ClickUp id is already linked to another user.
  - `GET /users` rows include `clickupUserId` and `teams: [{ id, name, role }]`.

- [ ] **Step 1: Failing tests** (`invitation.service.spec.ts`):
  - `create` with `teams` stores `InvitationTeam` rows (repository `create` receives `teams: { create: [...] }`) and auto-matches `clickupUserId` from a directory mock by case-insensitive email.
  - `create` with `clickupUserId: null` stores null and does not consult the directory.
  - `create` rejects an unknown `teamId` with `BadRequestException`.
  - `accept` creates the user with `clickupUserId` copied, then calls `teams.addMember` for each `InvitationTeam` (a deleted team has already cascaded away, so it's simply absent), with `addedBy = invitedByUserId`.
  - `accept` still succeeds if `addMember` throws for one team: it logs, and the readiness summary surfaces the user as team-less.

  (`users.service.spec.ts`) `setClickupUser` → `ConflictException` on the unique violation `P2002`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**
  - DTO:
    ```ts
    class InviteTeamDto { @IsString() teamId!: string; @IsIn(['LEAD', 'MEMBER']) role!: 'LEAD' | 'MEMBER'; }
    export class CreateInvitationDto {
      @IsEmail() @MaxLength(256) email!: string;
      @IsIn(['ADMIN', 'MEMBER']) role!: 'ADMIN' | 'MEMBER';
      @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InviteTeamDto) teams?: InviteTeamDto[];
      @IsOptional() @IsString() clickupUserId?: string | null;
    }
    ```
    (`@IsOptional()` lets `null` through for `clickupUserId`.)
  - `InvitationService.create`: validate that the team ids exist in the org (`prisma.team.count`, or a `TeamsRepository.countByIds`). Resolve `clickupUserId`: `dto.clickupUserId === undefined ? (await directory.getDirectory()).find(m => m.email?.toLowerCase() === email)?.id ?? null : dto.clickupUserId`. Write the teams with a nested create on insert. On the re-invite path (`existing`), `deleteMany` the old `InvitationTeam` rows, then create the new ones.
  - `InvitationService.accept`: create the user with `clickupUserId: inv.clickupUserId ?? null`. If that id is already linked to someone, catch `P2002`, create the user without the link and log it; the readiness list shows them. Then, for each `inv.teams` row, `teams.addMember(row.teamId, user.id, row.role, inv.invitedByUserId ?? user.id)` inside a try/catch that logs. **Deviation from the spec's "same transaction" line:** this is sequential and idempotent, and failures are surfaced by the readiness summary. Update the spec's "Invitations carry teams" bullet to match in this task's commit.
  - `UsersService.setClickupUser(actor, id, clickupUserId)` → `users.update(id, { clickupUserId })`, mapping `P2002` to `ConflictException('That ClickUp user is already linked to another account')`. Controller route: `@Roles(Role.OWNER, Role.ADMIN) @Patch(':id/clickup-user')`. Add `AuditLogInterceptor` to this route if the users controller doesn't already have it.
  - `InvitationRepository.findByTokenHash` / `listByOrg` include `teams: { include: { team: { select: { id: true, name: true } } } }`.

- [ ] **Step 4: Run** `npm run test && npm run build` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/auth docs/superpowers/specs/2026-09-18-team-scoped-access-design.md test
git commit -m "feat(auth): invitations carry team assignments and a ClickUp link"
```

---

### Task 17: Web: access-aware auth, navigation and cost rendering

**Files:**
- Modify: `apps/web/src/api/auth.ts` (`MeResponse.access`), `apps/web/src/hooks/useAuth.tsx` (expose `access`)
- Modify: `apps/web/src/components/layout/Sidebar.tsx`, `apps/web/src/App.tsx`, `apps/web/src/components/RequireRole.tsx`
- Modify: `apps/web/src/pages/TimesheetPage.tsx`, `apps/web/src/pages/OverviewPage.tsx`, `apps/web/src/lib/formatters.ts`
- Modify: pages/components that render cost (find with `grep -rln "costCents\|costAud\|formatCurrency\|fmt.money\|\.cost\b" apps/web/src`)

**Interfaces:**
- Consumes: `/auth/me` `access` (Task 7).
- Produces:
  ```ts
  export interface AccessSummary { scopingEnabled: boolean; unrestricted: boolean; teams: { id: string; name: string; role: 'LEAD' | 'MEMBER' }[]; canSeeCost: boolean; canSeeSprints: boolean; canEditChargeability: boolean; hasClickupLink: boolean; timesheetUserIds: string[] | null; }
  // useAuth(): { ..., access: AccessSummary | null }
  export function RequireAccess(props: { when: (a: AccessSummary) => boolean; redirect: string; children: React.ReactNode }): JSX.Element | null;
  ```

- [ ] **Step 1:** Add `access: AccessSummary` to `MeResponse`, store it in `AuthProvider` state, expose it from `useAuth`. Add `RequireAccess` next to `RequireRole` in `RequireRole.tsx`:
```tsx
export function RequireAccess({ when, redirect, children }: { when: (a: AccessSummary) => boolean; redirect: string; children: React.ReactNode }) {
  const { access, loading } = useAuth();
  if (loading) return null;
  if (!access || !when(access)) return <Navigate to={redirect} replace />;
  return <>{children}</>;
}
```
- [ ] **Step 2: Sidebar.** Build nav entries from `access`:
  - Sprints: `access.canSeeSprints`.
  - Analytics, Budgets: `access.canSeeCost`.
  - Chargeability rules: `access.canEditChargeability`.
  - Time Spikes, Missing Rates, Assignee Rates, Sync Logs: `isAdmin`. These are Owner/Admin endpoints; showing them to members was already a dead end.
  - Add **Teams** (`/teams`, icon `UsersRound` or `Network`) in the admin group, and **My team** (`/my-team`) when `access.teams.some(t => t.role === 'LEAD')`.
- [ ] **Step 3: Routes** in `App.tsx`: wrap `/sprints` in `RequireAccess when={a => a.canSeeSprints}`, `/analytics` and `/budgets` in `when={a => a.canSeeCost}`, `/chargeability-rules` in `when={a => a.canEditChargeability}`, and the admin pages in `RequireRole min="ADMIN"`, all with `redirect="/overview"`. Add lazy routes `/teams` (`RequireRole min="ADMIN"`) and `/my-team`.
- [ ] **Step 4: No-team empty state.** In `AppLayout.tsx`, when `access.scopingEnabled && !access.unrestricted && access.teams.length === 0`, render an `EmptyState` instead of the outlet: "You're not on a team yet — ask an admin to add you." If `!access.hasClickupLink`, add a note to the Timesheet page: "Your login isn't linked to a ClickUp user yet, so your own timesheet is empty."
- [ ] **Step 5: Nullable cost.** Change the money formatter(s) in `lib/formatters.ts` to accept `number | null | undefined` and return `'—'` for null. Update the TS types in `api/reports.ts` for every cost field to `number | null`, and add `costPartial?: boolean` to aggregate responses. Where a card shows a cost total and `costPartial` is true, show the caption "Cost shown for your clients only". 

  **Query gating: no page may fire a request the server will 403.** This table covers every endpoint that Tasks 8 and 10–14 restricted, plus the existing admin-only ones used on shared pages. Add the listed predicate as `enabled:` on the hook (pass it in as a hook argument), and hide the card or section that renders it:

  | Hook (`hooks/*`) | Endpoint | `enabled` when | Used on |
  |---|---|---|---|
  | `useStats` | `/reports/ops/stats` | `isAdmin` | Overview, TopBar/NotificationCenter |
  | `useSyncHealth`, `useWebhookEvents`, `useJobLogs` | `/reports/ops/*` | `isAdmin` | Overview, Sync Logs |
  | `useMissingRates` | `/reports/ops/missing-rates` | `isAdmin` | Missing Rates, Overview |
  | `useAnomalies` (`AnomaliesPanel`) | `/reports/anomalies` | `isAdmin` | Overview |
  | `useHourSpikes`, `useHourSpikeWatch` | `/reports/time-entries/hour-spikes` | `isAdmin` | Time Spikes, Overview |
  | `useBudgets` | `/admin/budgets` | `isAdmin` | Overview, Budgets |
  | `useBudgetStatus` | `/reports/budgets/status` | `access.canSeeCost` | Overview, Budgets |
  | `useOverviewDeltas` | `/reports/overview-deltas` | `access.canSeeCost` | Overview |
  | `useCostTrend`, `useAssigneeCostTrend`, `useClientCostTrend` | `/reports/time-entries/cost-trend*` | `access.canSeeCost` | Overview, Analytics |
  | `useSprintPoints`, `useSprints`, `useSprintFolders`, `useSprintVelocity`, `useSprintDetail` | `/reports/sprint*` | `access.canSeeSprints` | Sprints, Overview |
  | `useChargeabilityRules` | `/admin/chargeability-rules` | `access.canEditChargeability` | Chargeability |
  | search (`api/search.ts`) | `/admin/search` | `isAdmin` | CommandPalette: fall back to page navigation only |

  Confirm the table is complete: `grep -rn "requireLead\|@Roles(Role.OWNER, Role.ADMIN)" src/reports src/budgets` lists every restricted report route; each must map to a row. Then `grep -rln "<hook name>" apps/web/src` for each hook, so no call site is missed. Manual check: sign in as a plain member with scoping on, open every page in the sidebar with the browser Network tab open, and confirm there are **zero** 403 responses.
- [ ] **Step 6: Timesheet picker.** In `TimesheetPage.tsx`, when `access.timesheetUserIds !== null`, filter `assigneeOptions` to those ids. If there's exactly one (a plain member), preselect it and hide the picker. The xlsx export passes `includeCost: showCost && access.canSeeCost`.
- [ ] **Step 7: Chargeability controls.** Hide the chargeable toggles and bulk actions (Tasks page pill actions, task drawer per-assignee controls, Time Entries per-row toggle and bulk action) when `!access.canEditChargeability`. A lead who is only a member on some rows gets a 403 from the server for those rows. Show the server's message in the existing error toast, not a generic one.
- [ ] **Step 8: Verify** `cd apps/web && npm run lint && npm run build`. Expected: no errors. Then run the app (`npm run start:dev` + `cd apps/web && npm run dev`), create a MEMBER user in a team with scoping enabled, and check: nav trimmed, cost shows `—`, `/sprints` redirects.
- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): access-aware navigation, nullable cost, scoped timesheet picker"
```

---

### Task 18: Web: Teams page, invite-with-teams, Users ClickUp column, My team

**Files:**
- Create: `apps/web/src/api/teams.ts`, `apps/web/src/hooks/useTeams.ts`, `apps/web/src/pages/TeamsPage.tsx`, `apps/web/src/pages/MyTeamPage.tsx`, `apps/web/src/components/teams/ClientPicker.tsx`, `apps/web/src/components/teams/TeamAssignmentRows.tsx`
- Modify: `apps/web/src/components/team/InviteMembersModal.tsx` (`InvitePayload` gains `teams`, `clickupUserId`), `apps/web/src/api/users.ts`, `apps/web/src/hooks/useUsers.ts`, `apps/web/src/pages/TeamPage.tsx` (the existing Users page: ClickUp column + team chips + "Teams" action), `apps/web/src/components/team/MemberDrawer.tsx`

**Interfaces:**
- Consumes: Task 15 and Task 16 HTTP APIs; `useClickupMembers()` (existing) for the ClickUp picker.
- Produces:
  ```ts
  // api/teams.ts
  export interface TeamClient { optionId: string; name: string; archived: boolean }
  export interface TeamMemberRow { userId: string; name: string | null; email: string; role: 'LEAD' | 'MEMBER'; clickupUserId: string | null }
  export interface Team { id: string; name: string; clients: TeamClient[]; members: TeamMemberRow[]; pendingInvites: { invitationId: string; email: string; role: 'LEAD' | 'MEMBER' }[] }
  export interface ClientOption { optionId: string; fieldId: string; name: string; archived: boolean; teamId: string | null; teamName: string | null }
  export interface Readiness { unassignedClients: ClientOption[]; membersWithoutTeam: { id: string; name: string | null; email: string }[]; usersWithoutClickupLink: { id: string; name: string | null; email: string }[]; ambiguousNames: string[] }
  export const teamsApi: { list; create(name, optionIds); rename(id, name); remove(id); setClients(id, optionIds, move?); addMember(id, userId, role); setRole(id, userId, role); removeMember(id, userId); clientOptions(); readiness(); mine(); leadAddMember(teamId, userId); }
  ```

- [ ] **Step 1: API client and hooks.** Write `api/teams.ts` against the routes in Task 15 using `apiClient` (same style as `api/users.ts`). Write `hooks/useTeams.ts` with `useTeams`, `useClientOptions`, `useReadiness`, `useMyTeams`, and a `useTeamMutations` that invalidates `['teams']`, `['client-options']`, `['readiness']` on success. Also invalidate `['me']`/the auth refresh, because a membership change changes the caller's own access.
- [ ] **Step 2: `ClientPicker`.** A multi-select over `ClientOption[]`, **grouped by name**: selecting "Acme" selects every option id with that name. Non-archived only, plus archived options already on the team (shown struck through). Options owned by another team render disabled with "owned by {teamName}" and a "Move here" action that marks the group as a move. The component returns `{ optionIds: string[], move: boolean }`.
- [ ] **Step 3: `TeamsPage.tsx`**, following the spec's "Admin UI: Teams page" layout and using the existing UI kit (`PageHeader`, `Card`, `Button`, `Pill`, `EmptyState`, `Skeleton`):
  - Header with **New team** (modal: name + `ClientPicker`).
  - Readiness strip from `useReadiness()`: counts, each expandable. Unassigned clients, MEMBERs without a team, users without a ClickUp link, and ambiguous names, each linking to where you fix it.
  - Team list (name, lead names, member count, client count). Row → detail panel with: rename; delete (confirm dialog text: "Delete {name}? Its {n} clients return to Unassigned and its members lose access to them."); the clients editor (`ClientPicker` → `setClients`). If a 409 `conflicts` comes back, show a confirm: "{client} belongs to {team}. Moving it removes {team}'s access to all of its history." → retry with `move: true`. Members (add existing user via a searchable `Select` of org users; Lead/Member toggle; remove); pending invites (read-only).
- [ ] **Step 4: `TeamAssignmentRows`.** Repeatable rows of `[team Select] as [Lead|Member Select] [×]` plus "+ another team". Used by the invite modal and the Users page.
- [ ] **Step 5: Invite modal.** `InviteMembersModal` gets a **Teams** section (`TeamAssignmentRows`) and a **ClickUp user** `Select` fed by `useClickupMembers()`, preselected by a case-insensitive email match with an "auto-matched" hint. The option "Don't link" sends `null`; untouched sends `undefined`. If the org role is MEMBER and no team is selected, show the warning "This user will see no data until they're added to a team." `usersApi.invite` sends `{ email, role, teams, clickupUserId }`.
- [ ] **Step 6: Users page (`TeamPage.tsx`).** Add a "ClickUp" column (avatar + name, or "Not linked" with a link action that opens a `Select` → `PATCH /users/:id/clickup-user`) and team chips per user. `MemberDrawer` gets a "Teams" section using `TeamAssignmentRows`, which diffs and calls `addMember` / `setRole` / `removeMember`.
- [ ] **Step 7: `MyTeamPage.tsx`.** For each team where `role === 'LEAD'`: clients (read-only chips), members (read-only roles, each with a "Timesheet" link to `/timesheet?userId=<clickupUserId>` when linked), and **Add member** (searchable `Select` of active org users not already in the team → `leadAddMember`). The org user list for leads comes from `GET /my-teams` candidates. Add `candidates: {id,name,email}[]` to the `GET /my-teams` response in `MyTeamsController` (active org users not in any of the caller's led teams), since `/users` is Owner/Admin only. Make this backend addition in this task, with a test in `teams.service.spec.ts`.
- [ ] **Step 8: Verify** `cd apps/web && npm run lint && npm run build`, backend `npm run test && npm run build`. Manual run: create a team with several clients, invite a user as Lead, accept the invite in a private window, confirm the lead lands with access and `/my-team` works.
- [ ] **Step 9: Commit**

```bash
git add apps/web src/teams test
git commit -m "feat(web): Teams page, team-aware invites, ClickUp links, My team view"
```

---

### Task 19: Rollout switch, docs, final verification

**Files:**
- Modify: `apps/web/src/pages/SettingsPage.tsx` (Owner-only "Team-scoped access" toggle)
- Modify: `CLAUDE.md`, `docs/OPERATIONS.md`, `README.md` (if it lists pages/routes)

- [ ] **Step 1: Settings toggle.** In the Settings page (General or Access section), add an Owner-only switch bound to `preferences.access.teamScopingEnabled`, using the existing preferences-patch mutation. The enable confirm dialog shows the live readiness counts from `useReadiness()`: "{n} clients unassigned, {m} members without a team, {k} users not linked to ClickUp. Members will immediately see only their teams' clients." The disable confirm: "Everyone will see all data again." The existing settings update path is already audited. Confirm with `grep -n "AuditLogInterceptor" src/settings/*.controller.ts`; add it if it's missing.
- [ ] **Step 2: Docs.**
  - `CLAUDE.md` → "Data model rules": add a **Team-scoped access** subsection summarising the Global Constraints above (scope column, resolver as the single source, guardrail, cost masking, flag). Under "Already in place", add the Teams feature. Under "Known starter limitations", remove nothing (Spec 2 is still pending).
  - `docs/OPERATIONS.md`: a "Team-scoped access rollout" runbook: deploy → run `node dist/scripts/backfill-client-option-ids.js --dry-run` then without the flag on `app-worker` → `POST /admin/lists/sync` to fill the client catalog → build teams on `/teams` until readiness is clean → Owner flips the Settings toggle → how to flip back.
- [ ] **Step 3: Full verification**

Run:
```bash
npm run lint && npm run test && npm run build
cd apps/web && npm run lint && npm run build
```
Expected: all green. Then an end-to-end manual check with scoping **on**, using three users:
  1. Admin sees everything, including tasks with no client.
  2. Lead of team A (clients Acme, Bolt) sees only Acme/Bolt tasks and entries with cost. Can open member X's timesheet, where an other-team row shows its name and hours with cost "—". Can't open an outsider's timesheet (403). Can toggle chargeability on an Acme task. A bulk toggle that includes one Zulu entry fails as a whole.
  3. Member of team A sees Acme/Bolt tasks and teammates' entries, no cost anywhere, no Sprints, only their own timesheet.

Then flip the flag **off** and confirm the member sees everything with cost and still cannot change chargeability.

- [ ] **Step 4: Commit**

```bash
git add apps/web src CLAUDE.md docs README.md
git commit -m "feat(access): owner rollout switch for team scoping; docs and runbook"
```

---

## Self-Review

**Spec coverage.** Each spec section maps to these tasks:
- Decisions table: rows 1–2 → Tasks 1, 3, 15. Row 3 → Task 1 (per-client roles). Rows 4, 10 → Task 11. Row 6 → Tasks 2, 9–13, 17. Row 7 → Task 14. Row 8 → Task 15 + Task 18 (My team). Row 9 → Tasks 12, 17. Row 11 → Task 2 (NULL scope excluded). Row 12 → Task 15 (move). Row 13 → Tasks 16, 18. Row 14 → Task 6. Row 15 → Task 15. Row 16 → Tasks 14, 15, 16.
- Defaults: lead can't remove/promote → Task 15; deny by default → Tasks 1, 2; off-team cost masked → Task 11; ops/anomaly/spikes admin-only → Task 8; `ADMIN_API_KEY` unrestricted → Tasks 1, 7.
- Data model + option-id rationale → Tasks 3, 4. Verify field shape → Task 6 Step 1. `scopeClientOptionId` maintenance, guardrail comment and backfill → Task 5. Name bridge → Task 13.
- Scope resolver and guardrail → Tasks 1, 7, 8. Cost masking → Tasks 2, 9–13. Endpoint table → Tasks 8–14 (the `sprintStatus` filter keeps working because it narrows scoped rows in `buildTaskWhere`/`buildTimeEntryWhere`).
- Teams page, invitations, My team, navigation, `/auth/me` → Tasks 7, 15–18. Audit → Tasks 14–16, 19. Rollout → Tasks 7, 19.

**Deviations from the spec**
- The spec says invite team assignments are applied "in the same transaction" on accept. The plan applies them sequentially and idempotently, with failures surfaced in readiness. Task 16 updates that spec line.
- The spec says `/my-teams` lists team members. The plan also adds a `candidates` list so leads can pick existing users without access to the admin-only `/users` (Task 18 Step 7).

**Placeholder scan.** Every step that writes pure logic or a test contains the code. Tasks 9–13 (report rewiring) and 17–18 (UI) give the exact fragment to apply and a per-method table, not a full rewrite of 2,000+ existing lines. The implementer applies the fragment to each listed query, and the listed tests plus the guardrail check it.

**Type consistency**
- `AccessScope`, `resolveScope`, `visibleClientIds`, `leadClientIds`, `canSeeCost`, `canEditChargeability`, `isLeadAnywhere`, `timesheetUserIds`, `taskScopeWhere`, `timeEntryScopeWhere`, `taskScopeSql`, `leadScopeSql`, `taskIdInScopeSql`, `maskCost`, `requireLead`, `requireUnrestricted`, `Scope`/`scopeFactory` and `ChargeabilityAccessService.assertTasks`/`assertEntries` are defined once and used with the same signatures throughout.
- `scope.ledTeamIds` is defined in Task 1 and used in Tasks 13 and 15.
- `AccessSummary` has the same fields in Tasks 7 and 17.
