# Auth, Orgs & RBAC — Design Spec

**Date:** 2026-06-06
**Branch:** `feat/auth-orgs-rbac`
**Status:** Approved design, pre-implementation

## Purpose

Replace the single shared `ADMIN_API_KEY` access model with per-user authentication
and role-based access control, organized around a tenant **Organization**. This is
**Spec 1 of a two-spec SaaS shift**:

- **Spec 1 (this doc): Identity, Orgs & RBAC.** Users with email/password, sessions,
  one Organization tenant, three roles (Owner/Admin/Member), invitations with email
  delivery, and role enforcement on every endpoint. Existing ClickUp data is attached
  to a single seed org.
- **Spec 2 (future): Tenant data isolation.** Add `org_id` across all ClickUp data
  tables, scope every query/sync/worker/webhook per org, and enable true multi-org
  self-serve signup.

This spec deliberately structures the schema for multi-tenancy (every identity table
carries `orgId` from day one) while remaining honest that only **one live org** is
supported until Spec 2 isolates data.

## Approved decisions

| Decision | Choice |
|---|---|
| Scope of this spec | Identity layer first; data isolation deferred to Spec 2 |
| Signup model | Self-serve signup + invites |
| Session transport | HTTP-only cookie sessions, DB-backed |
| Existing `ADMIN_API_KEY` | Kept as a machine/automation credential → synthetic Owner |
| Invitation delivery | Email now (`nodemailer` + SMTP, dev fallback logs the link) |
| Password hashing | Node built-in `crypto.scrypt` (no new dependency) |
| Role storage | `User.role` (single org per user for now) |

## Roles & permission matrix

- **Owner** — the company. Full control. There is always ≥1 Owner; the last Owner
  cannot be removed or demoted.
- **Admin** — operations. Runs syncs, manages rates/mappings, invites people. Cannot
  touch org secrets or Owners.
- **Member** — read-only. Sees dashboards and reports; changes nothing.

| Capability | Owner | Admin | Member |
|---|:---:|:---:|:---:|
| View dashboards / reports / tasks / time entries | ✅ | ✅ | ✅ |
| Org secrets & connection (ClickUp API token, webhook secret, team ID, register webhook) | ✅ | ❌ | ❌ |
| Operational settings — rates CRUD, tag→assignee mappings, recalc | ✅ | ✅ | ❌ |
| Trigger sync / backfill / replacement backfill | ✅ | ✅ | ❌ |
| Retry failed webhooks / dead-letter jobs | ✅ | ✅ | ❌ |
| View audit log | ✅ | ✅ | ❌ |
| Invite users | ✅ | ✅ (Member/Admin only) | ❌ |
| Change a user's role | ✅ (any) | ✅ (Member↔Admin only) | ❌ |
| Remove / disable a user | ✅ (anyone but last Owner) | ✅ (Members/Admins only) | ❌ |
| Promote/demote Owner, transfer ownership | ✅ | ❌ | ❌ |
| Delete the org / billing (future) | ✅ | ❌ | ❌ |

Confirmed exceptions:
- Admins **can** invite other Admins (never Owners).
- Members **cannot** see the audit log (it exposes who-did-what + IPs).

## Data model

New Prisma enums:

```prisma
enum Role            { OWNER ADMIN MEMBER }
enum UserStatus      { ACTIVE DISABLED }
enum InvitationStatus { PENDING ACCEPTED REVOKED EXPIRED }
```

New tables (snake_case `@map` per existing convention):

```prisma
model Organization {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")
  users       User[]
  invitations Invitation[]
  @@map("organizations")
}

model User {
  id           String     @id @default(cuid())
  orgId        String     @map("org_id")
  email        String     @unique
  passwordHash String     @map("password_hash")
  name         String?
  role         Role       @default(MEMBER)
  status       UserStatus @default(ACTIVE)
  lastLoginAt  DateTime?  @map("last_login_at")
  createdAt    DateTime   @default(now()) @map("created_at")
  updatedAt    DateTime   @default(now()) @updatedAt @map("updated_at")
  org      Organization @relation(fields: [orgId], references: [id])
  sessions Session[]
  @@index([orgId])
  @@map("users")
}

model Invitation {
  id              String           @id @default(cuid())
  orgId           String           @map("org_id")
  email           String
  role            Role             // ADMIN | MEMBER only — never OWNER
  tokenHash       String           @unique @map("token_hash")
  invitedByUserId String?          @map("invited_by_user_id")
  status          InvitationStatus @default(PENDING)
  expiresAt       DateTime         @map("expires_at")
  acceptedAt      DateTime?        @map("accepted_at")
  createdAt       DateTime         @default(now()) @map("created_at")
  org Organization @relation(fields: [orgId], references: [id])
  @@index([email])
  @@index([orgId, status])
  @@map("invitations")
}

model Session {
  id         String   @id @default(cuid())
  userId     String   @map("user_id")
  tokenHash  String   @unique @map("token_hash")
  expiresAt  DateTime @map("expires_at")
  lastSeenAt DateTime? @map("last_seen_at")
  ip         String?
  userAgent  String?  @map("user_agent")
  createdAt  DateTime @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("sessions")
}
```

Design notes:
- **Role on `User`** — single org per user; no membership join table (YAGNI; Spec 2
  revisits if multi-org-per-user is needed).
- **Passwords** — `crypto.scrypt` with a random per-user salt, stored as
  `scrypt$<params>$<salt_b64>$<hash_b64>`, verified with `timingSafeEqual`.
- **Sessions DB-backed** — durable across Redis restarts, listable, individually
  revocable. Cookie holds a 32-byte random token; only its SHA-256 hash is stored.
- **Tokens never stored plaintext** — invite and session tokens are SHA-256 hashed at
  rest. Plaintext exists only in the email link / cookie.
- **Existing tables unchanged.** `AppSettings` stays the singleton (belongs to the seed
  org implicitly). `AdminAuditLog.actor` is now populated from the authenticated session
  user instead of the spoofable `x-admin-user` header.

### Migration / bootstrap

A new migration `0006_auth_orgs_rbac`:
1. Creates the enums + four tables.
2. Seeds one `Organization` row (name from `DEFAULT_ORG_NAME` env, fallback "Default Org").
3. No users are seeded.

The **first signup claims this seed org**: it attaches the new Owner to the existing
org row and renames it from the submitted `orgName` — it does **not** create a second
org. Once an Owner exists, public signup is closed (403) and everyone else joins by
invitation. Creating *new* orgs via signup is Spec 2 behavior (after data isolation).
The machine `ADMIN_API_KEY` principal is also scoped to this seed org.

## Authentication mechanics

**Session cookie**
- Name `clickup_sync_sid`; **HttpOnly**, **Secure** (prod only), **SameSite=Lax**, **Path=/**.
- 32-byte random opaque token; only its SHA-256 hash is in `sessions`.
- Absolute max lifetime 30 days; idle timeout 7 days (refresh `lastSeenAt` on each authed
  request). Logout deletes the session row + clears the cookie. "Sign out everywhere"
  deletes all of the user's sessions.

**CSRF** — double-submit token. On login the server also sets a readable (non-HttpOnly)
`csrf` cookie; the SPA echoes its value in an `x-csrf-token` header on every mutating
request (POST/PATCH/DELETE). Server rejects mismatches. SameSite=Lax + this token is the
standard protection for cookie auth.

**Brute-force** — add `@nestjs/throttler`, scoped tightly to `/auth/*`
(e.g. 5 attempts/min/IP on login + accept). Login returns a generic
"invalid email or password" (no user-existence disclosure). Password policy: min 10
chars, no forced composition (NIST-style).

## API endpoints

### Public / auth (`/auth`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup` | `{ email, password, name, orgName }`. **Claims the seed org** as Owner and sets its name from `orgName` (does not create a second org row in Spec 1). Allowed only while no Owner exists (claim window); else 403 "signup closed — request an invite." Sets session + csrf cookies. |
| POST | `/auth/login` | Verify password → set cookies; return `{ user, org }`. |
| POST | `/auth/logout` | Revoke current session, clear cookie. |
| POST | `/auth/logout-all` | Revoke all sessions for the current user. |
| GET | `/auth/me` | Current `{ user, org, role }`; 401 if no session. |
| GET | `/auth/invitations/:token` | Validate invite token → `{ email, orgName, role }`. |
| POST | `/auth/invitations/:token/accept` | `{ name, password }` → create user with invited role, mark accepted, log in. |

### User & invite management (session + RBAC)

| Method | Path | Min role | Notes |
|---|---|---|---|
| GET | `/users` | Admin | List org users. |
| POST | `/invitations` | Admin | `{ email, role }`; Admin can't invite OWNER; sends email. |
| GET | `/invitations` | Admin | List pending invites. |
| POST | `/invitations/:id/resend` | Admin | Re-send email. |
| POST | `/invitations/:id/revoke` | Admin | Cancel pending invite. |
| PATCH | `/users/:id/role` | Admin* | Owner→any; Admin→Member↔Admin only; last-Owner guard. |
| PATCH | `/users/:id/status` | Admin* | Enable/disable; can't disable last Owner; Admin can't touch Owners. |
| DELETE | `/users/:id` | Admin* | Same role rules; can't remove last Owner. |
| POST | `/org/transfer-ownership` | Owner | Promote target to Owner (optionally demote self to Admin). |

`*` = base guard is Admin; finer rules (last-Owner, Admin-can't-touch-Owner) enforced in
the service layer with precise errors.

### Existing endpoints — guarded, not changed

- **Owner only:** org-secret settings (ClickUp token / webhook secret / team ID) and
  webhook registration.
- **Admin+:** rates CRUD, tag-mapping CRUD, recalc, sync/backfill/replacement-backfill,
  retry-failed-webhooks, dead-letter retry, view audit log.
- **Any authenticated role:** reports / reads.

## Guards (RBAC core)

- **`AuthGuard`** — accepts *either* a valid session cookie *or* a valid `x-admin-key`
  (machine credential → synthetic Owner principal scoped to the seed org). Sets
  `req.user = { id, orgId, role, email }`. For mutating methods it also validates the CSRF
  token when the request authenticated via cookie (the machine-key path is exempt).
- **`RolesGuard`** + `@Roles(Role.OWNER, …)` decorator — reads `req.user.role`.
- **Audit interceptor** — `actor` now derives from `req.user.email` (or `machine-key`);
  the `x-admin-user` header is retired.

This replaces the `AdminApiKeyGuard`-only model; the API key still works for automation.

## Frontend (`apps/web`)

- **`apiClient`** — `withCredentials: true`, drop `x-admin-key`/`x-admin-user` injection,
  add `x-csrf-token` header (from the `csrf` cookie) on mutating requests. Keep the 401 →
  `/login` redirect.
- **`AuthProvider` + `useAuth()`** — hydrate `{ user, org, role }` from `GET /auth/me`;
  expose `login`, `logout`, `signup`. `ProtectedRoute` gates on `useAuth().user` (with a
  loading state) instead of the localStorage key.
- **`RequireRole`** — route/action guard by minimum role; drives routing and button-level
  gating.

New / reworked screens:

| Screen | Route | Notes |
|---|---|---|
| Login (rework) | `/login` | email + password; remove API-key + "your name" fields. |
| Signup | `/signup` | email, password, name, org name; only in the Owner-claim window. |
| Accept invite | `/invite/:token` | validate token, show org+role, collect name+password. |
| Members & Access | `/settings` (new tab) | replaces the mock Members section: user list with role, invite form, role dropdown, disable/remove, pending invites with resend/revoke — all role-gated. |

Role-driven UI: Members get read-only dashboards (write actions hidden/disabled); the
org-secrets section of Settings is Owner-only; sidebar hides `/audit-log` and `/settings`
for Members. New client modules: `api/auth.ts`, `api/users.ts`; hooks `useAuth`, `useUsers`.

## Email

`nodemailer` with SMTP configured via env (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `MAIL_FROM`). A dev/test transport (JSON/console) logs the invite link so
local dev needs no real SMTP. The invite email contains the tokenized
`/invite/:token` link. Structured behind a `MailerService` interface so a hosted API
(Resend/SES) can replace SMTP later without touching callers.

## Testing strategy

**Unit (Jest, backend):**
- Password service — `scrypt` hash/verify round-trip, wrong password fails, salt
  uniqueness, timing-safe compare.
- Token service — invite/session generation, SHA-256 hashing, expiry checks.
- RBAC rules — table-driven over the permission matrix: last-Owner guard,
  Admin-can't-touch-Owner, Admin-can't-invite-Owner, role-change legality. **Highest-value
  suite.**
- `AuthGuard` — valid/expired/missing session; `x-admin-key` → synthetic Owner; CSRF
  mismatch rejected.

**Integration (Nest `Testing` + supertest, real test DB):**
- Signup claims org → second signup is 403.
- Login sets cookie; `/auth/me` works with it; logout revokes it (next call 401).
- Invite → accept creates user with correct role.
- Authorization: Member → write endpoint = 403; Admin → Owner-only settings = 403; Owner
  succeeds.
- Throttle returns 429 after N login attempts.

**Frontend:** light — `RequireRole` unit test, `AuthProvider` hydration test. Full E2E
deferred (no harness today).

**Email:** stubbed transport in tests; dev transport logs the link.

## New environment variables

```env
DEFAULT_ORG_NAME=Default Org
SESSION_MAX_AGE_DAYS=30
SESSION_IDLE_TIMEOUT_DAYS=7
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM="ClickUp Sync <no-reply@example.com>"
APP_BASE_URL=http://localhost:5173   # for building invite links
```

`ADMIN_API_KEY` is retained (machine credential). `CLICKUP_*` secrets stay as-is.

## Out of scope (this spec)

- Per-org data isolation (`org_id` on ClickUp data tables, per-org sync) → Spec 2.
- Password reset / forgot-password flow (easy follow-up given email infra now exists;
  pull into v1 only if desired).
- SSO / OAuth / 2FA.
- Billing / subscriptions.
- Multiple orgs per user.
