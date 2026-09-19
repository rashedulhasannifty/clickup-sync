# Team-scoped access — teams own clients, leads and members see only their clients

**Date:** 2026-09-18
**Status:** Approved (design), pre-implementation
**Extends:** [2026-06-06-auth-orgs-rbac-design.md](2026-06-06-auth-orgs-rbac-design.md)
**Related, not the same:** "Spec 2" (per-org tenant isolation). Spec 2 walls off
different *companies*; this spec divides people *inside one company*.

## Problem

Today every signed-in user sees every ClickUp task, time entry, sprint and cost
in the org. `User.role` (OWNER / ADMIN / MEMBER) only decides what you can
*change*, never what you can *see*.

The business is organised as clients, grouped into teams, each with a lead. We
need:

- one team cannot see another team's work;
- team members have read-only access;
- a team lead sees their clients' tasks, time entries, sprints and timesheets,
  including cost, and can mark that work chargeable or non-chargeable;
- Owner/Admin can build teams and put people into them easily, including at
  invite time.

## Decisions (confirmed)

| # | Question | Decision |
|---|---|---|
| 1 | What defines a team's work? | **By client.** A team sees all work on its clients, *whoever logged it*. |
| 2 | Can two teams share a client? | **No.** A client belongs to at most one team. |
| 3 | Can a person be in several teams? | **Yes**, with a role per team (lead of A, member of B). |
| 4 | Do members see teammates' entries? | **Yes**, all time entries on the team's clients (read-only). |
| 5 | Do leads see their members' timesheets? | **Yes.** |
| 6 | Cost visibility | **Lead: hours + cost. Member: hours only.** |
| 7 | Lead chargeability scope | **Anything on their clients**, including entries logged by people outside the team. |
| 8 | Who manages team membership? | **Owner/Admin fully. A lead can add *existing* org users** to a team they lead. |
| 9 | Sprints | **Hidden for members.** Leads see sprints filtered to their clients. |
| 10 | Timesheet vs client scope | **Revised 2026-09-19.** Two gates, both required: *whose* timesheet (self, or a member of a team you lead) and *which rows* (the viewer's own client scope, same filter as every other list read). The original decision — a lead sees a member's other-team rows, hours only — was withdrawn: it made the timesheet the only surface showing work the rest of the app hides, and since a lead can add any org user to their team (decision 8), it let any lead read a colleague's cross-client task names. Cost inside the surviving rows is still masked per client. Cost of the change: a scoped viewer's own timesheet no longer shows their own hours on clients outside their teams — consistent with their Time Entries page. |
| 11 | Tasks with no client / an unowned client | **Owner/Admin only.** |
| 12 | Client moved to another team | The old team **loses all access immediately**, history included. No dated ownership. |
| 13 | Invite with no team | **Allowed**, with a warning. The user sees nothing until assigned. |
| 14 | Source of the client list | **The ClickUp "Client" field's option list** (not distinct values from tasks). |
| 15 | Deleting a team | **Releases** its clients back to "Unassigned" and drops memberships, behind a confirm dialog. |
| 16 | Audit | Team, client-mapping and membership changes go to the admin audit log, including a lead adding a member. |

### Defaults this spec chose (not explicitly discussed; change here if wrong)

- **A lead cannot remove members or promote anyone to lead.** Adding widens
  access; removing and promoting stay Owner/Admin only.
- **Deny by default.** A MEMBER with no team, or a user with no linked ClickUp
  identity, sees no ClickUp data. Not everything.
- **Cost rows outside the lead's clients are masked.** When a lead views a
  member's full timesheet (decision 10), rows on another team's client show hours
  but no cost. One team's cost never reaches another team's lead.
- **Ops, anomaly and hour-spike reports stay Owner/Admin only.** They are
  per-person or system-wide, not per-client, and have no sensible team slice.
  They can be revisited later.
- **"Admin" means Owner or Admin** everywhere in this spec.

## Roles

The org-level `Role` enum does **not** change.

| Org role | Meaning under this spec |
|---|---|
| OWNER | Unrestricted, as today. |
| ADMIN | Unrestricted, as today. |
| MEMBER | Scoped. What they see and do comes entirely from `TeamMember` rows. |

The `ADMIN_API_KEY` machine credential authenticates as a synthetic OWNER and
is therefore **unrestricted by design**. That is intended (ops scripts,
automation), not a hole to "fix".

A "team lead" is not a new org role. It is `TeamMember.role = LEAD` on a
specific team. The same MEMBER user can be LEAD of one team and MEMBER of
another, and their rights differ **per client**.

## Data model

```prisma
enum TeamRole {
  LEAD
  MEMBER
}

/// Catalog of the ClickUp "Client" dropdown's options. Populated from ClickUp's
/// field definitions, not from tasks, so new clients appear before they have work.
model ClickupClientOption {
  optionId  String   @id @map("option_id")      // ClickUp option UUID
  fieldId   String   @map("field_id")
  name      String                               // current label; updated on rename
  archived  Boolean  @default(false)              // option removed in ClickUp
  syncedAt  DateTime @default(now()) @updatedAt @map("synced_at")

  team      TeamClient?

  @@index([fieldId])
  @@map("clickup_client_options")
}

model Team {
  id        String   @id @default(cuid())
  orgId     String   @map("org_id")
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")

  clients     TeamClient[]
  members     TeamMember[]
  invitations InvitationTeam[]

  @@unique([orgId, name])
  @@map("teams")
}

/// A client belongs to at most one team: `optionId` is the primary key.
model TeamClient {
  optionId  String   @id @map("option_id")
  teamId    String   @map("team_id")
  addedBy   String?  @map("added_by")
  createdAt DateTime @default(now()) @map("created_at")

  team   Team                @relation(fields: [teamId], references: [id], onDelete: Cascade)
  option ClickupClientOption @relation(fields: [optionId], references: [optionId])

  @@index([teamId])
  @@map("team_clients")
}

model TeamMember {
  teamId    String   @map("team_id")
  userId    String   @map("user_id")
  role      TeamRole @default(MEMBER)
  addedBy   String?  @map("added_by")
  createdAt DateTime @default(now()) @map("created_at")

  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([teamId, userId])
  @@index([userId])
  @@map("team_members")
}

/// Team assignments carried by a pending invitation, applied on accept.
model InvitationTeam {
  invitationId String   @map("invitation_id")
  teamId       String   @map("team_id")
  role         TeamRole @default(MEMBER)

  invitation Invitation @relation(fields: [invitationId], references: [id], onDelete: Cascade)
  team       Team       @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@id([invitationId, teamId])
  @@map("invitation_teams")
}
```

Changes to existing models:

- `User.clickupUserId String? @unique`: links a login to the ClickUp identity on
  `clickup_time_entries.user_id`. Needed for "my timesheet" and "my team's
  timesheets".
- `Invitation.clickupUserId String?`: chosen or auto-matched at invite time,
  copied to the user on accept.
- `ClickupTask.clientOptionId String?`: the selected option's **id**, stored next
  to the existing `client` name.
- `ClickupTask.scopeClientOptionId String?` (indexed): the **effective** client
  for access control. It is the task's own `clientOptionId`, or its parent's when
  the subtask has none. This is the only column scope filters read.

### Why option id, not name

`client` today is the option *name*. A rename in ClickUp would silently move a
client out of its team. Keying on the option id keeps the mapping stable. The
name stays on the task for display and for the existing name-based filters.

**Verify first (implementation step 1):** whether "Client" is **one**
workspace-level field or a separate field per Space or List. If there are
several fields, the same client appears under several option ids. The Teams page
then groups options by normalized name, and assigning "Acme" assigns every
option id with that name. `TeamClient` stays keyed by option id either way, so
no schema change is needed.

### Maintaining `scopeClientOptionId`

- Set by `TasksRepository.upsert` from the normalized task: its own option id,
  otherwise the parent's (the parent is already fetched-before-subtask).
- When a parent's `clientOptionId` changes, the same transaction updates the
  children whose own `clientOptionId` is null.
- It is **derived, not a local annotation**. Sync writes it, like
  `clickup_time_entries.is_chargeable`, and users never set it. The existing
  guardrail in `src/tasks/tasks.repository.spec.ts` forbids only the local
  annotation (`isChargeable`) in `upsert`, so writing this column is allowed.
  Add a comment next to the column and a positive test (`upsert` *does* write
  `scopeClientOptionId`). That way nobody "fixes" it by moving the write
  somewhere the sync doesn't reach, which would leave subtasks unscoped.
- Backfill for existing rows: a one-off script re-runs the custom-field extractor
  over the stored `clickup_tasks.raw` JSON, then fills subtasks from parents. It
  lives under `src/` so it ships in `dist/` (see the prod deploy memory).

Time entries have no client column. They are scoped through
`task.scopeClientOptionId`. An entry with no task is visible to Owner/Admin only.

### Name-keyed data: the option-id → name bridge

Several reports group by the client **name** (`clickup_tasks.client`):
`/reports/clients`, `time-entries/by-client`, `cost-trend-by-client`.
`ClientBudget` is keyed by name alone.

- **Task-derived reports scope first, group second.** They filter rows by
  `scopeClientOptionId` and only then group by name, so a name can never widen
  access. No bridge is needed.
- **`ClientBudget` is the only standalone name-keyed table.** A lead's budget
  names are the current `ClickupClientOption.name` of their LEAD option ids.
  If one name maps to options owned by **different** teams, the name is
  ambiguous: its budget is shown to neither lead (Owner/Admin only), and the
  readiness summary flags it. Keying budgets on option id would remove this
  edge case; that is a separate change.
- A client rename in ClickUp still orphans its budget row. That problem exists
  today and this spec doesn't change it.

## The scope resolver

One pure function, the only place visibility is encoded, in the same style as
`resolveChargeability`:

```ts
type AccessScope =
  | { kind: 'unrestricted' }                                   // OWNER / ADMIN
  | {
      kind: 'scoped';
      clients: Map<string, TeamRole>;   // optionId → LEAD | MEMBER (LEAD wins if both)
      ledUserClickupIds: string[];      // ClickUp ids of members of teams I LEAD (timesheets)
      selfClickupId: string | null;
    };

resolveScope(user, memberships, teamClients, teamMembers): AccessScope
```

- Built **per request**, never cached across requests. A membership change must
  apply to the very next request. It costs about two small indexed queries,
  memoized on the request object.
- Derived helpers, all pure:
  - `taskWhere(scope)`: `scopeClientOptionId IN keys(clients)`, or no filter
    when unrestricted.
  - `timeEntryWhere(scope)`: `task: taskWhere(scope)`.
  - `canSeeCost(scope, optionId)`: unrestricted, or `clients.get(optionId) === LEAD`.
  - `canEditChargeability(scope, optionId)`: same rule as `canSeeCost`.
  - `timesheetUserIds(scope)`: unrestricted = anyone; otherwise
    `selfClickupId ∪ ledUserClickupIds`.
- An empty scope (no teams) produces a `where` that matches nothing. It must
  never collapse to "no filter".

### Enforcement: guardrail test

Like the chargeability sync guardrail, a test walks every `ReportsController`
route (and every other route that returns ClickUp data). It asserts each one
either:

1. passes the resolved `AccessScope` into its service, or
2. is explicitly marked `@Roles(OWNER, ADMIN)`.

A new report endpoint that does neither fails CI. Default deny is enforced by
the test, not by reviewers remembering.

App-layer scoping was chosen over Postgres row-level security. RLS fits Prisma
and the workers badly: workers must see everything, and connection pooling
makes per-request session variables awkward. The guardrail test is what makes
app-layer scoping safe.

## Cost masking

Hours-only has to be enforced by the server. Hiding cost in the UI is not
enough, because the raw API response would still contain it.

- Cost-bearing fields: time entry `costCents`, `hourlyRateCents`, `rateId`;
  task `cost`, `estimation` (ClickUp custom fields holding quoted amounts:
  **confirmed hidden from members**, visible to leads on their clients); any
  aggregated cost total. `currency` is a label, not an amount, and is not masked.
- **List and detail endpoints** mask per row. If `!canSeeCost(scope,
  row.scopeClientOptionId)`, those fields are set to `null`, not deleted. A null
  cost is also what a lead sees for another team's rows on a member's timesheet.
- **Aggregate endpoints** sum cost only over rows whose cost the viewer can see.
  They return `costPartial: true` when rows were excluded, so the UI can say
  "cost shown for your clients only".
- **Cost-only endpoints** (`cost-trend*`, `budgets/status`, `overview-deltas`
  cost parts): scoped to the viewer's LEAD clients. A user who leads no team
  gets 403.
- Rates (`/admin/rates`, `/assignee-rates`) and Finance (`/finance`, `/xero`)
  remain Owner/Admin only.
- Test: for a MEMBER-only scope, every scoped endpoint's JSON response contains
  no non-null cost field.

## Endpoint classification

| Endpoint(s) | Owner/Admin | Lead | Member |
|---|---|---|---|
| `tasks`, `tasks/summary`, `tasks/by-space-status`, `tasks/:id/description` | all | own clients, cost visible | own clients, cost masked |
| `time-entries`, `time-entries/by-*`, `time-entries/aggregates`, `time-entries/chargeable-summary` | all | own clients, cost | own clients, hours only |
| `timesheet` | anyone, unfiltered | self + members of led teams, rows filtered to own clients, cost masked off-led-clients | self only, rows filtered to own clients, hours only |
| `work`, `work/entries` | all | own clients | own clients, hours only |
| `sprints`, `sprints/folders`, `sprints/velocity`, `sprints/:listId`, `sprint-points` | all | only sprints containing ≥1 in-scope task, totals over in-scope tasks | **403** |
| `sprintStatus=active\|completed\|all` filter on `tasks` / `time-entries` | works | works | **works**: it narrows already-scoped rows via `clickup_lists` and reveals no sprint data, so the Tasks and Time Entries pages keep their Select. Only the Sprints *pages* are hidden. |
| `cycle-time`, `time-in-status` | all | in-scope tasks | in-scope tasks |
| Facets: `clients`, `sub-projects`, `lists`, `folders`, `spaces`, `tasks/assignees`, `time-entries/assignees` | all | values that occur in scope | values that occur in scope |
| `cost-trend*`, `budgets/status`, `overview-deltas` | all | LEAD clients | **403** |
| `tasks/:taskId/assignee-chargeability`, `tasks/chargeable-preview` | all | in-scope tasks | read-only, in-scope |
| `anomalies`, `time-entries/hour-spikes`, `ops/*` | all | **403** | **403** |
| `GET /admin/chargeability-rules` | all | rules on LEAD clients | **403** |
| `PATCH /admin/tasks/chargeable`, `PATCH /admin/tasks/:taskId/assignee-chargeable`, `PATCH /admin/time-entries/chargeable-override` | all | only targets on LEAD clients | **403** |
| Every other `/admin/*`, `/users`, `/invitations`, `/finance`, `/xero` | as today | **403** | **403** |

Chargeability writes by a lead:

- The controller-level `@Roles(OWNER, ADMIN)` on `admin-tasks.controller.ts`
  becomes a scope check: Owner/Admin pass, and a MEMBER passes only when **every**
  target id resolves to a LEAD client. One out-of-scope id rejects the **whole**
  request (403, listing nothing about the other ids). Nothing is partially
  applied.
- The scoped `recalculate-costs` job, its skip-when-unchanged rule and the
  precedence stack are unchanged.
- These writes gain the `AuditLogInterceptor` so a lead's changes are attributed
  to them.

## Admin UI: Teams page (`/teams`, Owner/Admin)

```
Teams                                              [+ New team]
┌──────────────────────────────────────────────────────────────┐
│ Digital Team A     Lead: Fahim   4 members   5 clients    ›  │
│ Apps Team          Lead: Sayem   6 members   3 clients    ›  │
└──────────────────────────────────────────────────────────────┘
Unassigned clients (3): Foxtrot · Golf · Hotel        [Assign…]

Team detail: Digital Team A                      [Rename] [Delete]
  Clients   [Acme ×] [Bolt ×] [Crane ×] [Delta ×] [Echo ×]  [+ Add client]
  Members   Fahim (Lead) · Chisty · Rejaur · Ahmad          [+ Add member]
            per row: Lead/Member toggle · Remove
  Pending invites   new.person@x.com (Member) — expires in 5d
```

- **Create team:** a name plus a multi-select of clients, e.g. five clients in
  one step.
- **The client picker** lists `clickup_client_options` (non-archived). Clients
  owned by another team show "owned by Apps Team" and are disabled. They can be
  taken with an explicit **Move to this team**, whose confirm says the old team
  loses all access, history included.
- **Unassigned clients panel:** options no team owns. Work on them is
  Owner/Admin-only until assigned.
- **Refresh clients:** re-pulls the Client field's option list from ClickUp.
  This also runs with the daily 03:00 list-catalog cron. Renamed options update
  `name`; removed options become `archived` but keep their team mapping, so
  history stays visible.
- **Delete team:** a confirm dialog, then its `TeamClient` rows are deleted
  (clients return to Unassigned) and its `TeamMember` / `InvitationTeam` rows
  cascade away.
- **Members:** add existing users, set Lead/Member, remove. A team may have more
  than one lead.

## Invitations carry teams

The invite form (Owner/Admin) gains:

```
Email        [ new.person@company.com ]
Org role     (•) Member  ( ) Admin
Teams        [Digital Team A ▾]  as [Lead ▾]     [+ another team]
             ⚠ No team selected — this user will see no data until assigned.
ClickUp user [ auto-matched: new.person@company.com ✓ ▾ ]
```

- Team rows are stored as `InvitationTeam`. On accept, the `User` is created
  first (with `clickupUserId` copied), then `TeamMember` rows are added
  sequentially via `TeamsRepository.addMember` — **not** in the same
  transaction as user creation. `addMember` is idempotent, and account
  creation never fails because a team (or the ClickUp link) couldn't be
  applied: a failure is logged and the affected user simply surfaces as
  team-less, or unlinked, in the readiness summary. A lead has access at
  first sign-in.
- A team deleted before acceptance has its `InvitationTeam` row cascade-deleted,
  so the assignment is simply skipped.
- **ClickUp user:** auto-matched by email against
  `WorkspaceMembersService.getDirectory()`; the admin can override or clear it.
  A MEMBER with no ClickUp link still sees team data, but their own timesheet is
  empty, and the UI says why.
- The **Users page** gains the same team picker and a ClickUp-user column, so
  existing users can be put into teams and linked without re-inviting.

## Lead UI: "My team"

A lead sees, for each team they lead:

- the member list (read-only roles) and **Add member**, a picker over existing
  active org users not already in the team, always added as MEMBER;
- the team's clients (read-only);
- links to each member's timesheet.

No invite, remove, promote or client editing.

## Navigation and session payload

`GET /auth/me` gains a summary so the web app can shape navigation without
guessing:

```json
{
  "access": {
    "unrestricted": false,
    "teams": [{ "id": "…", "name": "Digital Team A", "role": "LEAD" }],
    "canSeeCost": true,
    "canSeeSprints": true,
    "hasClickupLink": true
  }
}
```

`canSeeCost` / `canSeeSprints` are true when the user leads at least one team.
The sidebar hides Sprints, cost cards, Rates, Finance, Ops and Admin pages
accordingly. This is presentation only; the server rules above are the
enforcement. A scoped user with no teams gets an empty state: "You're not on a
team yet — ask an admin."

## Audit

Every write goes through `AuditLogInterceptor` with the session user as actor:

- team create / rename / delete;
- client assign / move / unassign (a move records from-team and to-team);
- member add / remove / role change, including a lead adding a member;
- ClickUp-user link changes;
- invitation team assignments (as part of the invitation create).

## Rollout

Scoping changes what existing MEMBER users see, so it ships dark:

1. Deploy schema, client catalog sync, `clientOptionId` / `scopeClientOptionId`
   and the backfill, the Teams page, invites with teams, and the user↔ClickUp
   link. `settings.access.teamScopingEnabled = false`: MEMBERs behave exactly as
   today.
2. Admins create teams, map every client, assign leads and members, and link
   ClickUp users. The Teams page shows a readiness summary: unassigned clients,
   MEMBERs with no team, users with no ClickUp link.
3. Owner flips `teamScopingEnabled` on in Settings (audited). It takes effect on
   the next request, with no redeploy. Flipping it off reverts immediately.

## Implementation order

1. **Verify the Client field shape** (one field vs several). Add the
   `ClickupClientOption` catalog and its sync (`clickup.client.ts` field
   endpoint + daily cron + refresh endpoint).
2. Schema + migration. Store `clientOptionId` in the custom-field extractor
   (tests for the dropdown branch), maintain `scopeClientOptionId` in
   `TasksRepository`, and run the backfill script.
3. `resolveScope` and its helpers, pure and fully unit-tested. `GET /auth/me`
   access summary.
4. Scope every report service, with the endpoint-classification guardrail test.
5. Cost masking, with the no-cost-for-members response test.
6. Chargeability write checks for leads (all-or-nothing), plus audit.
7. Teams page, invite-with-teams, Users page team picker and ClickUp link,
   lead "My team" view, and sidebar gating.
8. Readiness summary and the `teamScopingEnabled` flag, then rollout.

## Testing

- `resolveScope`: unrestricted roles; no teams; one team as MEMBER; one as LEAD;
  LEAD of A + MEMBER of B (per-client role); lead with no ClickUp link.
- `taskWhere` on an empty scope matches **zero** rows (a regression test
  against "no filter").
- Subtask inheritance: a subtask with no client is scoped by its parent's; a
  parent's client change moves those subtasks.
- Guardrail: every data route is scoped or `@Roles(OWNER, ADMIN)`.
- Cost masking: a member sees no non-null cost anywhere; a lead sees cost on
  their clients only; `costPartial` is set when rows were excluded.
- Timesheet: rows outside the viewer's client scope are **absent**, not merely
  cost-masked (revised decision 10) — including on the viewer's own timesheet; a
  lead **cannot** fetch the timesheet of anyone outside the teams they lead, not
  even someone who logged time on the lead's clients; a member cannot fetch a
  teammate's timesheet.
- Chargeability: a lead's bulk request with one out-of-scope id is rejected
  whole and nothing changes; an in-scope request enqueues the scoped recalc.
- Invitations: accept creates memberships and the ClickUp link; a deleted team
  is skipped.
- Team delete releases clients; a client move removes the old team's access on
  the next request.
- Flag off: a MEMBER sees everything, as today.

## Out of scope

- Per-org tenant isolation (Spec 2).
- Dated client ownership ("team A owned it until June").
- Leads removing members, promoting leads, inviting, or editing client mappings.
- Postgres row-level security.
- Team slices of ops, anomaly and hour-spike reports.
- Scoping Grafana: it reads Postgres with its own read-only credentials and is
  outside this app's access control.
