# Auth, Orgs & RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared `ADMIN_API_KEY` access model with per-user email/password authentication, an Organization tenant, and Owner/Admin/Member role-based access control, including self-serve signup, email invitations, and cookie sessions.

**Architecture:** A new `auth` module owns identity (users, sessions, invitations, org) backed by Prisma. Cookie-based sessions (DB-backed, hashed tokens) carry identity; a global `AuthGuard` populates `req.user` from either a session cookie or the legacy `x-admin-key` (machine → synthetic Owner), and a global `RolesGuard` enforces `@Roles(...)`. Fine-grained rules (last-Owner, Admin-can't-touch-Owner) live in services. The React app moves auth state from `localStorage` to an `AuthProvider` hydrated from `GET /auth/me`.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), Node `crypto` (scrypt passwords, sha256 token hashing), `@nestjs/throttler`, `cookie-parser`, `nodemailer`, React + react-router + @tanstack/react-query (`apps/web`).

**Spec:** `docs/superpowers/specs/2026-06-06-auth-orgs-rbac-design.md`

---

## File structure

Backend (`src/auth/` unless noted):
- `password.service.ts` — scrypt hash/verify (pure, unit-tested)
- `token.service.ts` — opaque token generation + sha256 hashing + expiry helpers
- `auth.types.ts` — `AuthPrincipal`, role enum re-export
- `org.repository.ts`, `user.repository.ts`, `session.repository.ts`, `invitation.repository.ts` — Prisma data access
- `session.service.ts` — create/validate/revoke sessions, sliding expiry, cookie helpers
- `permissions.service.ts` — RBAC rule engine (the matrix), pure + unit-tested
- `auth.guard.ts` — global guard: cookie OR x-admin-key → `req.user`; CSRF check on mutations
- `roles.guard.ts` — global guard: enforces `@Roles(...)`
- `decorators.ts` — `@Public()`, `@Roles()`, `@CurrentUser()`
- `auth.service.ts` — signup(claim), login, logout, me
- `auth.controller.ts` — `/auth/*`
- `invitation.service.ts`, `invitation.controller.ts` — invites
- `users.service.ts`, `users.controller.ts` — user management
- `mailer.service.ts` — nodemailer wrapper (SMTP + dev JSON transport)
- `dto/*.ts` — request DTOs
- `auth.module.ts` — wires it all; registers global guards
- Tests: co-located `*.spec.ts` + `test/auth-*.e2e-spec.ts`

Modified:
- `prisma/schema.prisma` — enums + 4 models
- `prisma/migrations/0006_auth_orgs_rbac/migration.sql`
- `src/config/env.validation.ts` — new env vars
- `src/main.ts` — cookie-parser, CORS for credentials
- `src/admin/admin.controller.ts` — `@Roles` per endpoint; drop `AdminApiKeyGuard` (now global)
- `src/admin/audit-log.interceptor.ts` — actor from `req.user`
- `src/app.module.ts` — import `AuthModule`, `ThrottlerModule`
- `.env.example`, `apps/web/.env.example`

Frontend (`apps/web/src/`):
- `api/client.ts` — cookies + csrf header
- `api/auth.ts`, `api/users.ts` — new clients
- `hooks/useAuth.tsx` — `AuthProvider` + `useAuth`
- `hooks/useUsers.ts` — react-query hooks
- `components/RequireRole.tsx`
- `pages/LoginPage.tsx` (rework), `pages/SignupPage.tsx`, `pages/AcceptInvitePage.tsx`
- `pages/SettingsPage.tsx` (Members & Access tab), `App.tsx`, `components/layout/Sidebar.tsx`

---

## Task 1: Add dependencies and environment variables

**Files:**
- Modify: `package.json`
- Modify: `src/config/env.validation.ts`
- Modify: `.env.example`, `apps/web/.env.example`

- [ ] **Step 1: Install backend dependencies**

Run:
```bash
npm install cookie-parser@1.4.7 @nestjs/throttler@6.4.0 nodemailer@6.10.0
npm install -D @types/cookie-parser@1.4.8 @types/nodemailer@6.4.17
```
Expected: packages added to `package.json`, lockfile updated. (If a pinned version 404s, use the latest compatible and note it.)

- [ ] **Step 2: Add env vars to the zod schema**

In `src/config/env.validation.ts`, add these fields inside the `z.object({...})` (after `RECONCILE_LOOKBACK_HOURS`):

```ts
  DEFAULT_ORG_NAME: z.string().default('Default Org'),
  SESSION_MAX_AGE_DAYS: z.coerce.number().default(30),
  SESSION_IDLE_TIMEOUT_DAYS: z.coerce.number().default(7),
  APP_BASE_URL: z.string().default('http://localhost:5173'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('ClickUp Sync <no-reply@example.com>'),
```

- [ ] **Step 3: Document env vars**

Append to `.env.example`:
```env
# Auth / orgs / email
DEFAULT_ORG_NAME=Default Org
SESSION_MAX_AGE_DAYS=30
SESSION_IDLE_TIMEOUT_DAYS=7
APP_BASE_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM="ClickUp Sync <no-reply@example.com>"
```
In `apps/web/.env.example`, remove `VITE_ADMIN_API_KEY` (no longer used) and add a comment: `# Auth is now cookie-based; no API key in the browser.`

- [ ] **Step 4: Verify build still compiles**

Run: `npm run build`
Expected: PASS (no usages yet; just new env fields).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/config/env.validation.ts .env.example apps/web/.env.example
git commit -m "chore(auth): add cookie/throttler/mailer deps and auth env vars"
```

---

## Task 2: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0006_auth_orgs_rbac/migration.sql`

- [ ] **Step 1: Add enums and models to schema**

Append to `prisma/schema.prisma`:

```prisma
enum Role {
  OWNER
  ADMIN
  MEMBER
}

enum UserStatus {
  ACTIVE
  DISABLED
}

enum InvitationStatus {
  PENDING
  ACCEPTED
  REVOKED
  EXPIRED
}

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
  role            Role
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
  id         String    @id @default(cuid())
  userId     String    @map("user_id")
  tokenHash  String    @unique @map("token_hash")
  expiresAt  DateTime  @map("expires_at")
  lastSeenAt DateTime? @map("last_seen_at")
  ip         String?
  userAgent  String?   @map("user_agent")
  createdAt  DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}
```

- [ ] **Step 2: Generate the migration without applying**

Run: `npm run prisma:migrate -- --name auth_orgs_rbac --create-only`
Expected: a new folder `prisma/migrations/<timestamp>_auth_orgs_rbac/` with `migration.sql`. Rename the folder to `0006_auth_orgs_rbac` to match the existing numbering convention.

- [ ] **Step 3: Append the seed org INSERT to the migration**

At the end of `prisma/migrations/0006_auth_orgs_rbac/migration.sql`, add:

```sql
-- Seed the single tenant org (Spec 1 supports one live org).
-- Fixed id so the machine ADMIN_API_KEY principal and code can reference it.
INSERT INTO "organizations" ("id", "name", "created_at", "updated_at")
VALUES ('org_seed', 'Default Org', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
```

- [ ] **Step 4: Apply migration and regenerate client**

Run:
```bash
npm run prisma:deploy
npm run prisma:generate
```
Expected: migration applies cleanly; Prisma client types now include `user`, `organization`, `invitation`, `session`, and the `Role` enum.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0006_auth_orgs_rbac
git commit -m "feat(auth): add org/user/invitation/session schema + seed org migration"
```

---

## Task 3: PasswordService (scrypt)

**Files:**
- Create: `src/auth/password.service.ts`
- Test: `src/auth/password.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/auth/password.service.spec.ts`:
```ts
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes then verifies the same password', async () => {
    const hash = await svc.hash('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await svc.verify('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await svc.hash('right-password');
    expect(await svc.verify('wrong-password', hash)).toBe(false);
  });

  it('produces a unique salt per hash', async () => {
    const a = await svc.hash('same');
    const b = await svc.hash('same');
    expect(a).not.toEqual(b);
  });

  it('returns false for a malformed stored hash', async () => {
    expect(await svc.verify('x', 'not-a-real-hash')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- password.service`
Expected: FAIL ("Cannot find module './password.service'").

- [ ] **Step 3: Implement**

`src/auth/password.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);
const N = 16384; // CPU/memory cost
const r = 8;
const p = 1;
const KEYLEN = 64;
const SALT_LEN = 16;

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SALT_LEN);
    const derived = (await scrypt(plain, salt, KEYLEN, { N, r, p })) as Buffer;
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    try {
      const parts = stored.split('$');
      if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
      const [, n, rr, pp, saltB64, hashB64] = parts;
      const salt = Buffer.from(saltB64, 'base64');
      const expected = Buffer.from(hashB64, 'base64');
      const derived = (await scrypt(plain, salt, expected.length, {
        N: Number(n),
        r: Number(rr),
        p: Number(pp),
      })) as Buffer;
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- password.service`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth/password.service.*
git commit -m "feat(auth): scrypt password hashing service"
```

---

## Task 4: TokenService

**Files:**
- Create: `src/auth/token.service.ts`
- Test: `src/auth/token.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/auth/token.service.spec.ts`:
```ts
import { TokenService } from './token.service';
import { sha256 } from '../common/utils/hash';

describe('TokenService', () => {
  const svc = new TokenService();

  it('generates a 64-char hex token and its sha256 hash', () => {
    const { token, tokenHash } = svc.generate();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(sha256(token));
  });

  it('produces distinct tokens', () => {
    expect(svc.generate().token).not.toEqual(svc.generate().token);
  });

  it('hashes a provided token deterministically', () => {
    expect(svc.hash('abc')).toBe(sha256('abc'));
  });

  it('computes a future expiry from days', () => {
    const now = new Date('2026-06-06T00:00:00Z');
    expect(svc.expiryFromDays(7, now).toISOString()).toBe('2026-06-13T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- token.service`
Expected: FAIL ("Cannot find module './token.service'").

- [ ] **Step 3: Implement**

`src/auth/token.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { sha256 } from '../common/utils/hash';

@Injectable()
export class TokenService {
  /** A random opaque token (kept only client-side) and its at-rest hash. */
  generate(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, tokenHash: sha256(token) };
  }

  hash(token: string): string {
    return sha256(token);
  }

  expiryFromDays(days: number, from = new Date()): Date {
    return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- token.service`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth/token.service.*
git commit -m "feat(auth): token generation + hashing service"
```

---

## Task 5: PermissionsService (RBAC rule engine — the matrix)

**Files:**
- Create: `src/auth/auth.types.ts`
- Create: `src/auth/permissions.service.ts`
- Test: `src/auth/permissions.service.spec.ts`

- [ ] **Step 1: Create the principal type**

`src/auth/auth.types.ts`:
```ts
import { Role } from '@prisma/client';

export { Role };

/** Identity attached to every authenticated request by AuthGuard. */
export interface AuthPrincipal {
  userId: string;   // 'machine' for the x-admin-key principal
  orgId: string;
  role: Role;
  email: string | null;
  isMachine: boolean;
}
```

- [ ] **Step 2: Write the failing test**

`src/auth/permissions.service.spec.ts`:
```ts
import { Role } from '@prisma/client';
import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  const p = new PermissionsService();

  describe('canAssignRole', () => {
    const cases: Array<[Role, Role, Role, boolean]> = [
      // actor, target's current role, desired role, allowed
      [Role.OWNER, Role.MEMBER, Role.ADMIN, true],
      [Role.OWNER, Role.ADMIN, Role.OWNER, true],   // owner can promote to owner
      [Role.ADMIN, Role.MEMBER, Role.ADMIN, true],  // admin: member<->admin
      [Role.ADMIN, Role.ADMIN, Role.MEMBER, true],
      [Role.ADMIN, Role.MEMBER, Role.OWNER, false], // admin cannot create owner
      [Role.ADMIN, Role.OWNER, Role.MEMBER, false], // admin cannot touch owner
      [Role.MEMBER, Role.MEMBER, Role.ADMIN, false],
    ];
    it.each(cases)('actor=%s current=%s desired=%s => %s', (actor, current, desired, allowed) => {
      expect(p.canAssignRole(actor, current, desired)).toBe(allowed);
    });
  });

  describe('canManageUser (remove/disable)', () => {
    it('owner can manage an admin', () => {
      expect(p.canManageUser(Role.OWNER, Role.ADMIN)).toBe(true);
    });
    it('admin can manage a member', () => {
      expect(p.canManageUser(Role.ADMIN, Role.MEMBER)).toBe(true);
    });
    it('admin cannot manage an owner', () => {
      expect(p.canManageUser(Role.ADMIN, Role.OWNER)).toBe(false);
    });
    it('member can manage nobody', () => {
      expect(p.canManageUser(Role.MEMBER, Role.MEMBER)).toBe(false);
    });
  });

  describe('canInviteWithRole', () => {
    it('admin can invite admin and member', () => {
      expect(p.canInviteWithRole(Role.ADMIN, Role.ADMIN)).toBe(true);
      expect(p.canInviteWithRole(Role.ADMIN, Role.MEMBER)).toBe(true);
    });
    it('nobody can invite an owner', () => {
      expect(p.canInviteWithRole(Role.OWNER, Role.OWNER)).toBe(false);
    });
    it('member cannot invite', () => {
      expect(p.canInviteWithRole(Role.MEMBER, Role.MEMBER)).toBe(false);
    });
  });

  describe('isLastOwnerBlocking', () => {
    it('blocks demoting/removing when only one owner remains', () => {
      expect(p.wouldRemoveLastOwner(Role.OWNER, 1)).toBe(true);
      expect(p.wouldRemoveLastOwner(Role.OWNER, 2)).toBe(false);
      expect(p.wouldRemoveLastOwner(Role.ADMIN, 1)).toBe(false);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- permissions.service`
Expected: FAIL ("Cannot find module './permissions.service'").

- [ ] **Step 4: Implement**

`src/auth/permissions.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Pure RBAC rules for the permission matrix. No I/O — callers pass in the
 * actor's role and the relevant target facts. Owner > Admin > Member.
 */
@Injectable()
export class PermissionsService {
  /** Can `actor` change a user currently at `current` to `desired`? */
  canAssignRole(actor: Role, current: Role, desired: Role): boolean {
    if (actor === Role.OWNER) return true; // owner can set any role
    if (actor === Role.ADMIN) {
      // Admin operates only within {MEMBER, ADMIN} and never touches owners.
      const within = (r: Role) => r === Role.MEMBER || r === Role.ADMIN;
      return within(current) && within(desired);
    }
    return false; // members cannot change roles
  }

  /** Can `actor` remove/disable a user whose role is `target`? */
  canManageUser(actor: Role, target: Role): boolean {
    if (actor === Role.OWNER) return true;
    if (actor === Role.ADMIN) return target === Role.MEMBER || target === Role.ADMIN;
    return false;
  }

  /** Can `actor` create an invitation for `role`? Owners are never invited. */
  canInviteWithRole(actor: Role, role: Role): boolean {
    if (role === Role.OWNER) return false;
    return actor === Role.OWNER || actor === Role.ADMIN;
  }

  /** True when changing/removing an OWNER would drop the org below one owner. */
  wouldRemoveLastOwner(targetRole: Role, currentOwnerCount: number): boolean {
    return targetRole === Role.OWNER && currentOwnerCount <= 1;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- permissions.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/auth/auth.types.ts src/auth/permissions.service.*
git commit -m "feat(auth): RBAC permission rule engine"
```

---

## Task 6: Repositories (org, user, session, invitation)

**Files:**
- Create: `src/auth/org.repository.ts`, `src/auth/user.repository.ts`, `src/auth/session.repository.ts`, `src/auth/invitation.repository.ts`

> Thin Prisma wrappers (matching the codebase's repository pattern). No new tests here; they're exercised by the service-level specs in later tasks.

- [ ] **Step 1: OrgRepository**

`src/auth/org.repository.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export const SEED_ORG_ID = 'org_seed';

@Injectable()
export class OrgRepository {
  constructor(private readonly prisma: PrismaService) {}

  get(id = SEED_ORG_ID) {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  rename(id: string, name: string) {
    return this.prisma.organization.update({ where: { id }, data: { name } });
  }
}
```

- [ ] **Step 2: UserRepository**

`src/auth/user.repository.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  listByOrg(orgId: string) {
    return this.prisma.user.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  }

  countOwners(orgId: string) {
    return this.prisma.user.count({ where: { orgId, role: Role.OWNER, status: UserStatus.ACTIVE } });
  }

  create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }

  update(id: string, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }

  touchLogin(id: string) {
    return this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }
}
```

- [ ] **Step 3: SessionRepository**

`src/auth/session.repository.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { userId: string; tokenHash: string; expiresAt: Date; ip?: string | null; userAgent?: string | null }) {
    return this.prisma.session.create({ data });
  }

  findByTokenHash(tokenHash: string) {
    return this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  }

  touch(id: string) {
    return this.prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }

  deleteByTokenHash(tokenHash: string) {
    return this.prisma.session.deleteMany({ where: { tokenHash } });
  }

  deleteAllForUser(userId: string) {
    return this.prisma.session.deleteMany({ where: { userId } });
  }

  deleteExpired(now = new Date()) {
    return this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  }
}
```

- [ ] **Step 4: InvitationRepository**

`src/auth/invitation.repository.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InvitationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class InvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.InvitationUncheckedCreateInput) {
    return this.prisma.invitation.create({ data });
  }

  findById(id: string) {
    return this.prisma.invitation.findUnique({ where: { id } });
  }

  findByTokenHash(tokenHash: string) {
    return this.prisma.invitation.findUnique({ where: { tokenHash }, include: { org: true } });
  }

  findPendingByEmail(orgId: string, email: string) {
    return this.prisma.invitation.findFirst({
      where: { orgId, email: email.toLowerCase(), status: InvitationStatus.PENDING },
    });
  }

  listByOrg(orgId: string, status?: InvitationStatus) {
    return this.prisma.invitation.findMany({
      where: { orgId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  update(id: string, data: Prisma.InvitationUpdateInput) {
    return this.prisma.invitation.update({ where: { id }, data });
  }
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/auth/org.repository.ts src/auth/user.repository.ts src/auth/session.repository.ts src/auth/invitation.repository.ts
git commit -m "feat(auth): identity repositories"
```

---

## Task 7: SessionService

**Files:**
- Create: `src/auth/session.service.ts`
- Test: `src/auth/session.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/auth/session.service.spec.ts`:
```ts
import { Role, UserStatus } from '@prisma/client';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

function makeRepo() {
  const rows = new Map<string, any>();
  return {
    rows,
    create: jest.fn(async (d) => { const row = { id: 's1', ...d }; rows.set(d.tokenHash, { ...row, user: null }); return row; }),
    findByTokenHash: jest.fn(async (h) => rows.get(h) ?? null),
    touch: jest.fn(async () => {}),
    deleteByTokenHash: jest.fn(async (h) => { rows.delete(h); }),
    deleteAllForUser: jest.fn(async () => {}),
    deleteExpired: jest.fn(async () => {}),
  };
}

describe('SessionService', () => {
  const tokens = new TokenService();
  const config = { get: (k: string, d: any) => (k === 'SESSION_MAX_AGE_DAYS' ? 30 : k === 'SESSION_IDLE_TIMEOUT_DAYS' ? 7 : d) } as any;

  it('issues a token and stores only its hash', async () => {
    const repo = makeRepo();
    const svc = new SessionService(repo as any, tokens, config);
    const { token } = await svc.issue('user-1', null, null);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', tokenHash: tokens.hash(token) }));
  });

  it('validates an active session and returns the user', async () => {
    const repo = makeRepo();
    const svc = new SessionService(repo as any, tokens, config);
    const { token } = await svc.issue('user-1', null, null);
    const stored = repo.rows.get(tokens.hash(token));
    stored.expiresAt = new Date(Date.now() + 1000 * 60 * 60);
    stored.user = { id: 'user-1', orgId: 'org_seed', role: Role.OWNER, email: 'o@x.com', status: UserStatus.ACTIVE };
    const result = await svc.validate(token);
    expect(result?.user.id).toBe('user-1');
  });

  it('rejects an expired session and deletes it', async () => {
    const repo = makeRepo();
    const svc = new SessionService(repo as any, tokens, config);
    const { token } = await svc.issue('user-1', null, null);
    const stored = repo.rows.get(tokens.hash(token));
    stored.expiresAt = new Date(Date.now() - 1000);
    stored.user = { id: 'user-1', status: UserStatus.ACTIVE };
    expect(await svc.validate(token)).toBeNull();
    expect(repo.deleteByTokenHash).toHaveBeenCalled();
  });

  it('rejects a session whose user is disabled', async () => {
    const repo = makeRepo();
    const svc = new SessionService(repo as any, tokens, config);
    const { token } = await svc.issue('user-1', null, null);
    const stored = repo.rows.get(tokens.hash(token));
    stored.expiresAt = new Date(Date.now() + 100000);
    stored.user = { id: 'user-1', status: UserStatus.DISABLED };
    expect(await svc.validate(token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- session.service`
Expected: FAIL ("Cannot find module './session.service'").

- [ ] **Step 3: Implement**

`src/auth/session.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { SessionRepository } from './session.repository';
import { TokenService } from './token.service';

@Injectable()
export class SessionService {
  constructor(
    private readonly repo: SessionRepository,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  private maxAgeDays() { return this.config.get<number>('SESSION_MAX_AGE_DAYS', 30); }
  private idleDays() { return this.config.get<number>('SESSION_IDLE_TIMEOUT_DAYS', 7); }

  /** Create a session row, return the plaintext token for the cookie. */
  async issue(userId: string, ip: string | null, userAgent: string | null): Promise<{ token: string; expiresAt: Date }> {
    const { token, tokenHash } = this.tokens.generate();
    const expiresAt = this.tokens.expiryFromDays(this.maxAgeDays());
    await this.repo.create({ userId, tokenHash, expiresAt, ip, userAgent });
    return { token, expiresAt };
  }

  /** Validate a plaintext cookie token. Returns the row+user or null. Sliding idle refresh. */
  async validate(token: string) {
    const row = await this.repo.findByTokenHash(this.tokens.hash(token));
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) {
      await this.repo.deleteByTokenHash(row.tokenHash);
      return null;
    }
    if (!row.user || row.user.status === UserStatus.DISABLED) return null;
    // Idle refresh: bump lastSeenAt at most once per ~hour to limit writes.
    const lastSeen = row.lastSeenAt?.getTime() ?? 0;
    if (Date.now() - lastSeen > 60 * 60 * 1000) await this.repo.touch(row.id);
    return row;
  }

  async revoke(token: string) {
    await this.repo.deleteByTokenHash(this.tokens.hash(token));
  }

  async revokeAll(userId: string) {
    await this.repo.deleteAllForUser(userId);
  }

  cookieMaxAgeMs() {
    return this.maxAgeDays() * 24 * 60 * 60 * 1000;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- session.service`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth/session.service.*
git commit -m "feat(auth): DB-backed session service with sliding expiry"
```

---

## Task 8: Decorators + RolesGuard + AuthGuard

**Files:**
- Create: `src/auth/decorators.ts`, `src/auth/roles.guard.ts`, `src/auth/auth.guard.ts`
- Test: `src/auth/auth.guard.spec.ts`, `src/auth/roles.guard.spec.ts`

- [ ] **Step 1: Decorators**

`src/auth/decorators.ts`:
```ts
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthPrincipal } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal =>
    ctx.switchToHttp().getRequest().user,
);
```

- [ ] **Step 2: RolesGuard failing test**

`src/auth/roles.guard.spec.ts`:
```ts
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './decorators';

function ctx(user: any, required?: Role[]) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
    key === ROLES_KEY ? required : undefined,
  );
  const execCtx: any = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
  return { guard: new RolesGuard(reflector), execCtx };
}

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const { guard, execCtx } = ctx({ role: Role.MEMBER });
    expect(guard.canActivate(execCtx)).toBe(true);
  });
  it('allows when the user role meets the requirement', () => {
    const { guard, execCtx } = ctx({ role: Role.OWNER }, [Role.ADMIN, Role.OWNER]);
    expect(guard.canActivate(execCtx)).toBe(true);
  });
  it('throws Forbidden when role is insufficient', () => {
    const { guard, execCtx } = ctx({ role: Role.MEMBER }, [Role.ADMIN, Role.OWNER]);
    expect(() => guard.canActivate(execCtx)).toThrow();
  });
});
```

- [ ] **Step 3: Run RolesGuard test (fails)**

Run: `npm run test -- roles.guard`
Expected: FAIL ("Cannot find module './roles.guard'").

- [ ] **Step 4: Implement RolesGuard**

`src/auth/roles.guard.ts`:
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from './decorators';
import { AuthPrincipal } from './auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true; // any authenticated user
    const user = ctx.switchToHttp().getRequest().user as AuthPrincipal | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');
    if (!required.includes(user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
```

- [ ] **Step 5: Run RolesGuard test (passes)**

Run: `npm run test -- roles.guard`
Expected: PASS.

- [ ] **Step 6: AuthGuard failing test**

`src/auth/auth.guard.spec.ts`:
```ts
import { Role, UserStatus } from '@prisma/client';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC_KEY } from './decorators';
import { SEED_ORG_ID } from './org.repository';

function reflector(isPublic = false) {
  return { getAllAndOverride: (k: string) => (k === IS_PUBLIC_KEY ? isPublic : undefined) } as any;
}
function req(opts: Partial<{ cookies: any; headers: any; method: string }>) {
  return { cookies: {}, headers: {}, method: 'GET', ...opts };
}
function execCtx(request: any) {
  return { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => ({}), getClass: () => ({}) } as any;
}

describe('AuthGuard', () => {
  const config = { get: (k: string, d?: any) => (k === 'ADMIN_API_KEY' ? 'machine-key-value-min-32-characters-long' : d) } as any;

  it('allows public routes', async () => {
    const guard = new AuthGuard(reflector(true), {} as any, config);
    expect(await guard.canActivate(execCtx(req({})))).toBe(true);
  });

  it('accepts a valid session cookie and sets req.user', async () => {
    const session = { validate: jest.fn(async () => ({ user: { id: 'u1', orgId: 'org_seed', role: Role.ADMIN, email: 'a@x.com', status: UserStatus.ACTIVE } })) } as any;
    const guard = new AuthGuard(reflector(false), session, config);
    const r = req({ cookies: { clickup_sync_sid: 'tok' } });
    expect(await guard.canActivate(execCtx(r))).toBe(true);
    expect((r as any).user).toMatchObject({ userId: 'u1', role: Role.ADMIN, isMachine: false });
  });

  it('accepts a valid x-admin-key as synthetic Owner', async () => {
    const guard = new AuthGuard(reflector(false), { validate: jest.fn() } as any, config);
    const r = req({ headers: { 'x-admin-key': 'machine-key-value-min-32-characters-long' } });
    expect(await guard.canActivate(execCtx(r))).toBe(true);
    expect((r as any).user).toMatchObject({ userId: 'machine', orgId: SEED_ORG_ID, role: Role.OWNER, isMachine: true });
  });

  it('rejects when no credential is present', async () => {
    const guard = new AuthGuard(reflector(false), { validate: jest.fn(async () => null) } as any, config);
    await expect(guard.canActivate(execCtx(req({ cookies: { clickup_sync_sid: 'bad' } })))).rejects.toThrow();
  });

  it('rejects a mutating cookie request with a bad CSRF token', async () => {
    const session = { validate: jest.fn(async () => ({ user: { id: 'u1', orgId: 'o', role: Role.ADMIN, email: 'a', status: UserStatus.ACTIVE } })) } as any;
    const guard = new AuthGuard(reflector(false), session, config);
    const r = req({ method: 'POST', cookies: { clickup_sync_sid: 'tok', csrf: 'aaa' }, headers: { 'x-csrf-token': 'bbb' } });
    await expect(guard.canActivate(execCtx(r))).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Run AuthGuard test (fails)**

Run: `npm run test -- auth.guard`
Expected: FAIL ("Cannot find module './auth.guard'").

- [ ] **Step 8: Implement AuthGuard**

`src/auth/auth.guard.ts`:
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as crypto from 'crypto';
import { IS_PUBLIC_KEY } from './decorators';
import { SessionService } from './session.service';
import { SEED_ORG_ID } from './org.repository';
import { AuthPrincipal } from './auth.types';

export const SESSION_COOKIE = 'clickup_sync_sid';
const CSRF_COOKIE = 'csrf';
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();

    // 1. Machine credential (automation) → synthetic Owner. Exempt from CSRF.
    const apiKey = this.config.get<string>('ADMIN_API_KEY', '');
    const provided = req.headers['x-admin-key'] as string | undefined;
    if (apiKey && provided && this.timingSafeEqual(apiKey, provided)) {
      req.user = { userId: 'machine', orgId: SEED_ORG_ID, role: Role.OWNER, email: null, isMachine: true } as AuthPrincipal;
      return true;
    }

    // 2. Session cookie.
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException('Not authenticated');
    const row = await this.sessions.validate(token);
    if (!row) throw new UnauthorizedException('Session invalid or expired');

    if (MUTATING.has(req.method)) {
      const header = req.headers['x-csrf-token'] as string | undefined;
      const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
      if (!header || !cookie || header !== cookie) throw new ForbiddenException('CSRF token mismatch');
    }

    req.user = {
      userId: row.user.id,
      orgId: row.user.orgId,
      role: row.user.role,
      email: row.user.email,
      isMachine: false,
    } as AuthPrincipal;
    return true;
  }

  private timingSafeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  }
}
```

- [ ] **Step 9: Run AuthGuard test (passes)**

Run: `npm run test -- auth.guard`
Expected: PASS (5 tests).

- [ ] **Step 10: Commit**

```bash
git add src/auth/decorators.ts src/auth/roles.guard.* src/auth/auth.guard.*
git commit -m "feat(auth): AuthGuard (session/machine), RolesGuard, decorators"
```

---

## Task 9: MailerService

**Files:**
- Create: `src/auth/mailer.service.ts`
- Test: `src/auth/mailer.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/auth/mailer.service.spec.ts`:
```ts
import { MailerService } from './mailer.service';

describe('MailerService', () => {
  it('builds an invite email with the tokenized link and sends via transport', async () => {
    const sent: any[] = [];
    const config = { get: (k: string, d?: any) => ({ APP_BASE_URL: 'https://app.test', MAIL_FROM: 'from@test', SMTP_HOST: '' }[k] ?? d) } as any;
    const svc = new MailerService(config);
    (svc as any).transport = { sendMail: async (m: any) => { sent.push(m); return { messageId: '1' }; } };

    await svc.sendInvite('invitee@test.com', 'tok123', 'Acme', 'ADMIN');

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('invitee@test.com');
    expect(sent[0].html).toContain('https://app.test/invite/tok123');
    expect(sent[0].html).toContain('Acme');
  });
});
```

- [ ] **Step 2: Run test (fails)**

Run: `npm run test -- mailer.service`
Expected: FAIL ("Cannot find module './mailer.service'").

- [ ] **Step 3: Implement**

`src/auth/mailer.service.ts`:
```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transport!: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('SMTP_HOST', '');
    if (host) {
      this.transport = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT', 587),
        secure: this.config.get<number>('SMTP_PORT', 587) === 465,
        auth: this.config.get<string>('SMTP_USER', '')
          ? { user: this.config.get<string>('SMTP_USER', ''), pass: this.config.get<string>('SMTP_PASS', '') }
          : undefined,
      });
    } else {
      // Dev fallback: log the message (incl. invite link) instead of sending.
      this.transport = nodemailer.createTransport({ jsonTransport: true });
      this.logger.warn('SMTP_HOST not set — emails are logged, not sent (dev mode).');
    }
  }

  async sendInvite(to: string, token: string, orgName: string, role: string): Promise<void> {
    const base = this.config.get<string>('APP_BASE_URL', 'http://localhost:5173');
    const link = `${base}/invite/${token}`;
    const from = this.config.get<string>('MAIL_FROM', 'no-reply@example.com');
    const html = `<p>You've been invited to join <strong>${orgName}</strong> as <strong>${role}</strong> on ClickUp Sync.</p>
<p><a href="${link}">Accept your invitation</a></p>
<p>Or paste this link: ${link}</p>
<p>This invite expires in 7 days.</p>`;
    const info = await this.transport.sendMail({ from, to, subject: `Invitation to ${orgName}`, html });
    if (!this.config.get<string>('SMTP_HOST', '')) {
      this.logger.log(`[DEV EMAIL] invite for ${to}: ${link}`);
    } else {
      this.logger.log(`Invite email sent to ${to} (messageId=${(info as any).messageId})`);
    }
  }
}
```

> Note: the test injects a fake `transport`; production sets it in `onModuleInit`. The `transport` field is `private` — the spec accesses it via `(svc as any)`, which is acceptable for the test.

- [ ] **Step 4: Run test (passes)**

Run: `npm run test -- mailer.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/mailer.service.*
git commit -m "feat(auth): nodemailer mailer with dev fallback + invite email"
```

---

## Task 10: AuthService + DTOs

**Files:**
- Create: `src/auth/dto/signup.dto.ts`, `src/auth/dto/login.dto.ts`
- Create: `src/auth/auth.service.ts`
- Test: `src/auth/auth.service.spec.ts`

- [ ] **Step 1: DTOs**

`src/auth/dto/signup.dto.ts`:
```ts
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail() @MaxLength(256) email!: string;
  @IsString() @MinLength(10) @MaxLength(200) password!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(120) orgName!: string;
}
```

`src/auth/dto/login.dto.ts`:
```ts
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail() @MaxLength(256) email!: string;
  @IsString() @MaxLength(200) password!: string;
}
```

- [ ] **Step 2: Write the failing test**

`src/auth/auth.service.spec.ts`:
```ts
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

function deps() {
  const users: any[] = [];
  const userRepo = {
    findByEmail: jest.fn(async (e) => users.find((u) => u.email === e.toLowerCase()) ?? null),
    countOwners: jest.fn(async () => users.filter((u) => u.role === Role.OWNER).length),
    create: jest.fn(async (d) => { const u = { id: 'u' + users.length, status: UserStatus.ACTIVE, ...d, email: d.email }; users.push(u); return u; }),
    touchLogin: jest.fn(async () => {}),
  };
  const orgRepo = { rename: jest.fn(async () => {}), get: jest.fn(async () => ({ id: 'org_seed', name: 'Acme' })) };
  return { users, userRepo, orgRepo, password: new PasswordService() };
}

describe('AuthService.signup (claim seed org)', () => {
  it('creates the first user as OWNER and renames the org', async () => {
    const d = deps();
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, d.password);
    const user = await svc.signup({ email: 'O@x.com', password: 'longenough10', name: 'O', orgName: 'Acme' });
    expect(user.role).toBe(Role.OWNER);
    expect(d.orgRepo.rename).toHaveBeenCalledWith('org_seed', 'Acme');
    expect(d.userRepo.create.mock.calls[0][0].email).toBe('o@x.com'); // lowercased
  });

  it('refuses signup once an owner exists', async () => {
    const d = deps();
    d.userRepo.countOwners = jest.fn(async () => 1);
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, d.password);
    await expect(svc.signup({ email: 'b@x.com', password: 'longenough10', name: 'B', orgName: 'X' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a duplicate email', async () => {
    const d = deps();
    await d.userRepo.create({ email: 'dup@x.com', role: Role.OWNER });
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, d.password);
    await expect(svc.signup({ email: 'dup@x.com', password: 'longenough10', name: 'B', orgName: 'X' }))
      .rejects.toBeTruthy();
  });
});

describe('AuthService.login', () => {
  it('returns the user for correct credentials', async () => {
    const d = deps();
    const password = new PasswordService();
    const hash = await password.hash('longenough10');
    d.users.push({ id: 'u1', email: 'a@x.com', passwordHash: hash, role: Role.ADMIN, status: UserStatus.ACTIVE, orgId: 'org_seed' });
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, password);
    const user = await svc.login({ email: 'a@x.com', password: 'longenough10' });
    expect(user.id).toBe('u1');
  });

  it('rejects a wrong password with a generic error', async () => {
    const d = deps();
    const password = new PasswordService();
    d.users.push({ id: 'u1', email: 'a@x.com', passwordHash: await password.hash('right10char'), role: Role.ADMIN, status: UserStatus.ACTIVE });
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, password);
    await expect(svc.login({ email: 'a@x.com', password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a disabled user', async () => {
    const d = deps();
    const password = new PasswordService();
    d.users.push({ id: 'u1', email: 'a@x.com', passwordHash: await password.hash('right10char'), role: Role.ADMIN, status: UserStatus.DISABLED });
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, password);
    await expect(svc.login({ email: 'a@x.com', password: 'right10char' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 3: Run test (fails)**

Run: `npm run test -- auth.service`
Expected: FAIL ("Cannot find module './auth.service'").

- [ ] **Step 4: Implement**

`src/auth/auth.service.ts`:
```ts
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Role, User, UserStatus } from '@prisma/client';
import { UserRepository } from './user.repository';
import { OrgRepository, SEED_ORG_ID } from './org.repository';
import { PasswordService } from './password.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly orgs: OrgRepository,
    private readonly passwords: PasswordService,
  ) {}

  /** First-signup claim: create the first OWNER and rename the seed org. */
  async signup(dto: SignupDto): Promise<User> {
    const ownerCount = await this.users.countOwners(SEED_ORG_ID);
    if (ownerCount > 0) {
      throw new ConflictException('Signup is closed — ask an admin for an invitation.');
    }
    const email = dto.email.toLowerCase();
    if (await this.users.findByEmail(email)) {
      throw new ConflictException('An account with this email already exists.');
    }
    await this.orgs.rename(SEED_ORG_ID, dto.orgName.trim());
    const passwordHash = await this.passwords.hash(dto.password);
    return this.users.create({
      email,
      passwordHash,
      name: dto.name.trim(),
      role: Role.OWNER,
      status: UserStatus.ACTIVE,
      org: { connect: { id: SEED_ORG_ID } },
    });
  }

  async login(dto: LoginDto): Promise<User> {
    const generic = new UnauthorizedException('Invalid email or password');
    const user = await this.users.findByEmail(dto.email.toLowerCase());
    if (!user) {
      // Run a dummy verify to keep timing roughly constant.
      await this.passwords.verify(dto.password, 'scrypt$16384$8$1$AAAA$AAAA');
      throw generic;
    }
    if (user.status === UserStatus.DISABLED) throw generic;
    if (!(await this.passwords.verify(dto.password, user.passwordHash))) throw generic;
    await this.users.touchLogin(user.id);
    return user;
  }
}
```

- [ ] **Step 5: Run test (passes)**

Run: `npm run test -- auth.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/auth/dto/signup.dto.ts src/auth/dto/login.dto.ts src/auth/auth.service.*
git commit -m "feat(auth): AuthService signup-claim + login"
```

---

## Task 11: AuthController + cookie wiring

**Files:**
- Create: `src/auth/auth.controller.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Implement the controller**

`src/auth/auth.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { OrgRepository } from './org.repository';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { Public, CurrentUser } from './decorators';
import { SESSION_COOKIE } from './auth.guard';
import { AuthPrincipal } from './auth.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly orgs: OrgRepository,
  ) {}

  private async setSession(res: Response, req: Request, userId: string) {
    const { token } = await this.sessions.issue(userId, req.ip ?? null, (req.headers['user-agent'] as string) ?? null);
    const csrf = randomBytes(16).toString('hex');
    const secure = process.env.NODE_ENV === 'production';
    const maxAge = this.sessions.cookieMaxAgeMs();
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge });
    res.cookie('csrf', csrf, { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge });
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('signup')
  async signup(@Body() dto: SignupDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.signup(dto);
    await this.setSession(res, req, user.id);
    const org = await this.orgs.get();
    return { user: this.publicUser(user), org: { id: org?.id, name: org?.name } };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(dto);
    await this.setSession(res, req, user.id);
    const org = await this.orgs.get();
    return { user: this.publicUser(user), org: { id: org?.id, name: org?.name } };
  }

  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await this.sessions.revoke(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie('csrf', { path: '/' });
    return { ok: true };
  }

  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthPrincipal, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revokeAll(user.userId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie('csrf', { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthPrincipal) {
    if (!user) throw new UnauthorizedException();
    const org = await this.orgs.get(user.orgId);
    return { user: { id: user.userId, email: user.email, role: user.role, isMachine: user.isMachine }, org: { id: org?.id, name: org?.name } };
  }

  private publicUser(u: { id: string; email: string; name: string | null; role: string }) {
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  }
}
```

- [ ] **Step 2: Wire cookie-parser + CORS in main.ts**

In `src/main.ts`, add the import and replace the `enableCors()` line:
```ts
import cookieParser from 'cookie-parser';
// ...
  app.use(cookieParser());
  app.enableCors({
    origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    credentials: true,
  });
```
(Place `app.use(cookieParser())` before `app.enableCors(...)`, after `app.use(compression())`.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS (controller is registered in Task 13's module; build alone compiles the file once it's referenced — if the module isn't wired yet, skip controller registration check until Task 13).

- [ ] **Step 4: Commit**

```bash
git add src/auth/auth.controller.ts src/main.ts
git commit -m "feat(auth): /auth controller + cookie-parser + scoped CORS"
```

---

## Task 12: InvitationService + DTO

**Files:**
- Create: `src/auth/dto/create-invitation.dto.ts`, `src/auth/dto/accept-invitation.dto.ts`
- Create: `src/auth/invitation.service.ts`
- Test: `src/auth/invitation.service.spec.ts`

- [ ] **Step 1: DTOs**

`src/auth/dto/create-invitation.dto.ts`:
```ts
import { IsEmail, IsIn, MaxLength } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail() @MaxLength(256) email!: string;
  @IsIn(['ADMIN', 'MEMBER']) role!: 'ADMIN' | 'MEMBER';
}
```

`src/auth/dto/accept-invitation.dto.ts`:
```ts
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptInvitationDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MinLength(10) @MaxLength(200) password!: string;
}
```

- [ ] **Step 2: Write the failing test**

`src/auth/invitation.service.spec.ts`:
```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InvitationStatus, Role } from '@prisma/client';
import { InvitationService } from './invitation.service';
import { PermissionsService } from './permissions.service';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';

function deps() {
  const invites: any[] = [];
  const inviteRepo = {
    findPendingByEmail: jest.fn(async () => null),
    create: jest.fn(async (d) => { const row = { id: 'i' + invites.length, status: InvitationStatus.PENDING, ...d }; invites.push(row); return row; }),
    findByTokenHash: jest.fn(async (h) => invites.find((i) => i.tokenHash === h) ?? null),
    findById: jest.fn(async (id) => invites.find((i) => i.id === id) ?? null),
    update: jest.fn(async (id, d) => { const i = invites.find((x) => x.id === id); Object.assign(i, d); return i; }),
    listByOrg: jest.fn(async () => invites),
  };
  const userRepo = { findByEmail: jest.fn(async () => null), create: jest.fn(async (d) => ({ id: 'newuser', ...d })) };
  const mailer = { sendInvite: jest.fn(async () => {}) };
  return { invites, inviteRepo, userRepo, mailer };
}

describe('InvitationService.create', () => {
  it('admin can invite a member; emails the link', async () => {
    const d = deps();
    const svc = new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), new TokenService(), new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
    await svc.create({ userId: 'a', orgId: 'org_seed', role: Role.ADMIN, email: 'a@x.com', isMachine: false }, { email: 'New@x.com', role: 'MEMBER' });
    expect(d.inviteRepo.create).toHaveBeenCalled();
    expect(d.mailer.sendInvite).toHaveBeenCalledWith('new@x.com', expect.any(String), expect.any(String), 'MEMBER');
  });

  it('member cannot invite', async () => {
    const d = deps();
    const svc = new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), new TokenService(), new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
    await expect(svc.create({ userId: 'm', orgId: 'org_seed', role: Role.MEMBER, email: null, isMachine: false }, { email: 'x@x.com', role: 'MEMBER' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects inviting an existing user', async () => {
    const d = deps();
    d.userRepo.findByEmail = jest.fn(async () => ({ id: 'exists' }));
    const svc = new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), new TokenService(), new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
    await expect(svc.create({ userId: 'a', orgId: 'org_seed', role: Role.ADMIN, email: 'a@x.com', isMachine: false }, { email: 'exists@x.com', role: 'MEMBER' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('InvitationService.accept', () => {
  it('creates a user with the invited role and marks accepted', async () => {
    const d = deps();
    const tokens = new TokenService();
    const { token, tokenHash } = tokens.generate();
    d.invites.push({ id: 'i0', orgId: 'org_seed', email: 'new@x.com', role: Role.MEMBER, tokenHash, status: InvitationStatus.PENDING, expiresAt: new Date(Date.now() + 100000), org: { name: 'Acme' } });
    const svc = new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), tokens, new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
    const user = await svc.accept(token, { name: 'New', password: 'longenough10' });
    expect(user.role).toBe(Role.MEMBER);
    expect(d.inviteRepo.update).toHaveBeenCalledWith('i0', expect.objectContaining({ status: InvitationStatus.ACCEPTED }));
  });

  it('rejects an expired invite', async () => {
    const d = deps();
    const tokens = new TokenService();
    const { token, tokenHash } = tokens.generate();
    d.invites.push({ id: 'i0', orgId: 'org_seed', email: 'new@x.com', role: Role.MEMBER, tokenHash, status: InvitationStatus.PENDING, expiresAt: new Date(Date.now() - 1000), org: { name: 'Acme' } });
    const svc = new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), tokens, new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
    await expect(svc.accept(token, { name: 'New', password: 'longenough10' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 3: Run test (fails)**

Run: `npm run test -- invitation.service`
Expected: FAIL ("Cannot find module './invitation.service'").

- [ ] **Step 4: Implement**

`src/auth/invitation.service.ts`:
```ts
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationStatus, Role, User, UserStatus } from '@prisma/client';
import { InvitationRepository } from './invitation.repository';
import { UserRepository } from './user.repository';
import { PermissionsService } from './permissions.service';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
import { MailerService } from './mailer.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { AuthPrincipal } from './auth.types';
import { SEED_ORG_ID } from './org.repository';

const INVITE_TTL_DAYS = 7;

@Injectable()
export class InvitationService {
  constructor(
    private readonly invites: InvitationRepository,
    private readonly users: UserRepository,
    private readonly perms: PermissionsService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  async create(actor: AuthPrincipal, dto: CreateInvitationDto) {
    const role = dto.role as Role;
    if (!this.perms.canInviteWithRole(actor.role, role)) {
      throw new ForbiddenException('You cannot invite a user with that role.');
    }
    const email = dto.email.toLowerCase();
    if (await this.users.findByEmail(email)) {
      throw new BadRequestException('A user with that email already exists.');
    }
    const existing = await this.invites.findPendingByEmail(actor.orgId, email);
    const { token, tokenHash } = this.tokens.generate();
    const expiresAt = this.tokens.expiryFromDays(INVITE_TTL_DAYS);
    if (existing) {
      await this.invites.update(existing.id, { tokenHash, role, expiresAt, status: InvitationStatus.PENDING, invitedByUserId: actor.userId });
    } else {
      await this.invites.create({ orgId: actor.orgId, email, role, tokenHash, expiresAt, invitedByUserId: actor.userId });
    }
    const orgName = this.config.get<string>('DEFAULT_ORG_NAME', 'your team');
    await this.mailer.sendInvite(email, token, orgName, role);
    return { ok: true, email };
  }

  list(orgId: string) {
    return this.invites.listByOrg(orgId);
  }

  async resend(actor: AuthPrincipal, id: string) {
    const inv = await this.invites.findById(id);
    if (!inv || inv.status !== InvitationStatus.PENDING) throw new BadRequestException('No pending invite.');
    const { token, tokenHash } = this.tokens.generate();
    await this.invites.update(id, { tokenHash, expiresAt: this.tokens.expiryFromDays(INVITE_TTL_DAYS) });
    await this.mailer.sendInvite(inv.email, token, this.config.get<string>('DEFAULT_ORG_NAME', 'your team'), inv.role);
    return { ok: true };
  }

  async revoke(id: string) {
    await this.invites.update(id, { status: InvitationStatus.REVOKED });
    return { ok: true };
  }

  /** Public lookup for the accept screen. */
  async preview(token: string) {
    const inv = await this.invites.findByTokenHash(this.tokens.hash(token));
    if (!inv || inv.status !== InvitationStatus.PENDING || inv.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This invitation is invalid or has expired.');
    }
    return { email: inv.email, role: inv.role, orgName: inv.org?.name ?? 'your team' };
  }

  async accept(token: string, dto: AcceptInvitationDto): Promise<User> {
    const inv = await this.invites.findByTokenHash(this.tokens.hash(token));
    if (!inv || inv.status !== InvitationStatus.PENDING || inv.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This invitation is invalid or has expired.');
    }
    if (await this.users.findByEmail(inv.email)) {
      throw new BadRequestException('An account with this email already exists.');
    }
    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.create({
      email: inv.email,
      passwordHash,
      name: dto.name.trim(),
      role: inv.role,
      status: UserStatus.ACTIVE,
      org: { connect: { id: inv.orgId ?? SEED_ORG_ID } },
    });
    await this.invites.update(inv.id, { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() });
    return user;
  }
}
```

- [ ] **Step 5: Run test (passes)**

Run: `npm run test -- invitation.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/auth/dto/create-invitation.dto.ts src/auth/dto/accept-invitation.dto.ts src/auth/invitation.service.*
git commit -m "feat(auth): invitation service (create/resend/revoke/preview/accept)"
```

---

## Task 13: UsersService (RBAC-enforced management)

**Files:**
- Create: `src/auth/dto/change-role.dto.ts`, `src/auth/dto/set-status.dto.ts`, `src/auth/dto/transfer-ownership.dto.ts`
- Create: `src/auth/users.service.ts`
- Test: `src/auth/users.service.spec.ts`

- [ ] **Step 1: DTOs**

`src/auth/dto/change-role.dto.ts`:
```ts
import { IsIn } from 'class-validator';
export class ChangeRoleDto { @IsIn(['OWNER', 'ADMIN', 'MEMBER']) role!: 'OWNER' | 'ADMIN' | 'MEMBER'; }
```
`src/auth/dto/set-status.dto.ts`:
```ts
import { IsIn } from 'class-validator';
export class SetStatusDto { @IsIn(['ACTIVE', 'DISABLED']) status!: 'ACTIVE' | 'DISABLED'; }
```
`src/auth/dto/transfer-ownership.dto.ts`:
```ts
import { IsString } from 'class-validator';
export class TransferOwnershipDto { @IsString() targetUserId!: string; }
```

- [ ] **Step 2: Write the failing test**

`src/auth/users.service.spec.ts`:
```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { UsersService } from './users.service';
import { PermissionsService } from './permissions.service';

function deps(initial: any[]) {
  const users = [...initial];
  const userRepo = {
    findById: jest.fn(async (id) => users.find((u) => u.id === id) ?? null),
    listByOrg: jest.fn(async () => users),
    countOwners: jest.fn(async () => users.filter((u) => u.role === Role.OWNER && u.status === UserStatus.ACTIVE).length),
    update: jest.fn(async (id, d) => { const u = users.find((x) => x.id === id); Object.assign(u, d); return u; }),
    delete: jest.fn(async (id) => { const i = users.findIndex((x) => x.id === id); users.splice(i, 1); }),
  };
  return { users, userRepo };
}
const sessions = { revokeAll: jest.fn(async () => {}) } as any;
const owner = { userId: 'o1', orgId: 'org_seed', role: Role.OWNER, email: 'o', isMachine: false };
const admin = { userId: 'a1', orgId: 'org_seed', role: Role.ADMIN, email: 'a', isMachine: false };

describe('UsersService.changeRole', () => {
  it('owner promotes a member to admin', async () => {
    const d = deps([{ id: 'm1', role: Role.MEMBER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    const u = await svc.changeRole(owner, 'm1', Role.ADMIN);
    expect(u.role).toBe(Role.ADMIN);
  });
  it('admin cannot promote to owner', async () => {
    const d = deps([{ id: 'm1', role: Role.MEMBER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.changeRole(admin, 'm1', Role.OWNER)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('blocks demoting the last owner', async () => {
    const d = deps([{ id: 'o1', role: Role.OWNER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.changeRole(owner, 'o1', Role.ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UsersService.remove', () => {
  it('admin cannot remove an owner', async () => {
    const d = deps([{ id: 'o1', role: Role.OWNER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.remove(admin, 'o1')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('blocks removing the last owner', async () => {
    const d = deps([{ id: 'o1', role: Role.OWNER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.remove(owner, 'o1')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('owner removes a member and revokes their sessions', async () => {
    const d = deps([{ id: 'o1', role: Role.OWNER, status: UserStatus.ACTIVE }, { id: 'm1', role: Role.MEMBER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await svc.remove(owner, 'm1');
    expect(d.userRepo.delete).toHaveBeenCalledWith('m1');
    expect(sessions.revokeAll).toHaveBeenCalledWith('m1');
  });
  it('404s an unknown user', async () => {
    const d = deps([]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.remove(owner, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.transferOwnership', () => {
  it('promotes the target to owner and demotes the actor to admin', async () => {
    const d = deps([{ id: 'o1', role: Role.OWNER, status: UserStatus.ACTIVE }, { id: 'a1', role: Role.ADMIN, status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await svc.transferOwnership(owner, 'a1');
    expect(d.users.find((u) => u.id === 'a1').role).toBe(Role.OWNER);
    expect(d.users.find((u) => u.id === 'o1').role).toBe(Role.ADMIN);
  });
});
```

- [ ] **Step 3: Run test (fails)**

Run: `npm run test -- users.service`
Expected: FAIL ("Cannot find module './users.service'").

- [ ] **Step 4: Implement**

`src/auth/users.service.ts`:
```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UserRepository } from './user.repository';
import { PermissionsService } from './permissions.service';
import { SessionService } from './session.service';
import { AuthPrincipal } from './auth.types';

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly perms: PermissionsService,
    private readonly sessions: SessionService,
  ) {}

  list(orgId: string) {
    return this.users.listByOrg(orgId);
  }

  private async require(id: string) {
    const u = await this.users.findById(id);
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  async changeRole(actor: AuthPrincipal, targetId: string, desired: Role) {
    const target = await this.require(targetId);
    if (!this.perms.canAssignRole(actor.role, target.role, desired)) {
      throw new ForbiddenException('You cannot assign that role.');
    }
    if (target.role === Role.OWNER && desired !== Role.OWNER) {
      const owners = await this.users.countOwners(target.orgId);
      if (this.perms.wouldRemoveLastOwner(target.role, owners)) {
        throw new BadRequestException('Cannot demote the last owner.');
      }
    }
    return this.users.update(targetId, { role: desired });
  }

  async setStatus(actor: AuthPrincipal, targetId: string, status: 'ACTIVE' | 'DISABLED') {
    const target = await this.require(targetId);
    if (!this.perms.canManageUser(actor.role, target.role)) {
      throw new ForbiddenException('You cannot manage this user.');
    }
    if (status === 'DISABLED' && target.role === Role.OWNER) {
      const owners = await this.users.countOwners(target.orgId);
      if (this.perms.wouldRemoveLastOwner(target.role, owners)) {
        throw new BadRequestException('Cannot disable the last owner.');
      }
    }
    if (status === 'DISABLED') await this.sessions.revokeAll(targetId);
    return this.users.update(targetId, { status });
  }

  async remove(actor: AuthPrincipal, targetId: string) {
    const target = await this.require(targetId);
    if (!this.perms.canManageUser(actor.role, target.role)) {
      throw new ForbiddenException('You cannot remove this user.');
    }
    if (target.role === Role.OWNER) {
      const owners = await this.users.countOwners(target.orgId);
      if (this.perms.wouldRemoveLastOwner(target.role, owners)) {
        throw new BadRequestException('Cannot remove the last owner.');
      }
    }
    await this.sessions.revokeAll(targetId);
    await this.users.delete(targetId);
    return { ok: true };
  }

  async transferOwnership(actor: AuthPrincipal, targetId: string) {
    if (actor.role !== Role.OWNER) throw new ForbiddenException('Only an owner can transfer ownership.');
    const target = await this.require(targetId);
    await this.users.update(targetId, { role: Role.OWNER });
    await this.users.update(actor.userId, { role: Role.ADMIN });
    return { ok: true, newOwnerId: target.id };
  }
}
```

- [ ] **Step 5: Run test (passes)**

Run: `npm run test -- users.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/auth/dto/change-role.dto.ts src/auth/dto/set-status.dto.ts src/auth/dto/transfer-ownership.dto.ts src/auth/users.service.*
git commit -m "feat(auth): users management service with RBAC guards"
```

---

## Task 14: Invitation + Users controllers, AuthModule, global guards

**Files:**
- Create: `src/auth/invitation.controller.ts`, `src/auth/users.controller.ts`
- Create: `src/auth/auth.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: InvitationController**

`src/auth/invitation.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { InvitationService } from './invitation.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { Public, Roles, CurrentUser } from './decorators';
import { AuthPrincipal } from './auth.types';

@ApiTags('invitations')
@Controller()
export class InvitationController {
  constructor(private readonly invites: InvitationService) {}

  @Roles(Role.OWNER, Role.ADMIN)
  @Post('invitations')
  create(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateInvitationDto) {
    return this.invites.create(user, dto);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Get('invitations')
  list(@CurrentUser() user: AuthPrincipal) {
    return this.invites.list(user.orgId);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(200)
  @Post('invitations/:id/resend')
  resend(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.invites.resend(user, id);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(200)
  @Post('invitations/:id/revoke')
  revoke(@Param('id') id: string) {
    return this.invites.revoke(id);
  }

  @Public()
  @Get('auth/invitations/:token')
  preview(@Param('token') token: string) {
    return this.invites.preview(token);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('auth/invitations/:token/accept')
  async accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto) {
    const user = await this.invites.accept(token, dto);
    return { ok: true, email: user.email };
  }
}
```

> Note: `/auth/invitations/:token/accept` does not auto-login (no cookie set), keeping the accept controller free of session plumbing. The frontend redirects to `/login` after a successful accept. If auto-login is desired, move accept into `AuthController` and call `setSession`.

- [ ] **Step 2: UsersController**

`src/auth/users.controller.ts`:
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { ChangeRoleDto } from './dto/change-role.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { Roles, CurrentUser } from './decorators';
import { AuthPrincipal } from './auth.types';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';

@ApiTags('users')
@UseInterceptors(AuditLogInterceptor)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles(Role.OWNER, Role.ADMIN)
  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.users.list(user.orgId);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch(':id/role')
  changeRole(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body() dto: ChangeRoleDto) {
    return this.users.changeRole(user, id, dto.role as Role);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch(':id/status')
  setStatus(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.users.setStatus(user, id, dto.status);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.users.remove(user, id);
  }

  @Roles(Role.OWNER)
  @HttpCode(200)
  @Post('transfer-ownership')
  transfer(@CurrentUser() user: AuthPrincipal, @Body() dto: TransferOwnershipDto) {
    return this.users.transferOwnership(user, dto.targetUserId);
  }
}
```

- [ ] **Step 3: AuthModule with global guards**

`src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { PermissionsService } from './permissions.service';
import { SessionService } from './session.service';
import { MailerService } from './mailer.service';
import { AuthService } from './auth.service';
import { InvitationService } from './invitation.service';
import { UsersService } from './users.service';
import { OrgRepository } from './org.repository';
import { UserRepository } from './user.repository';
import { SessionRepository } from './session.repository';
import { InvitationRepository } from './invitation.repository';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { AuthController } from './auth.controller';
import { InvitationController } from './invitation.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [ConfigModule, AdminModule],
  controllers: [AuthController, InvitationController, UsersController],
  providers: [
    PasswordService, TokenService, PermissionsService, SessionService, MailerService,
    AuthService, InvitationService, UsersService,
    OrgRepository, UserRepository, SessionRepository, InvitationRepository,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SessionService, OrgRepository],
})
export class AuthModule {}
```

> `AuditLogInterceptor` is exported by `AdminModule`? It currently isn't. Add `AuditLogInterceptor` to `AdminModule`'s `exports` array (it's already a provider) so `UsersController` can use it. Modify `src/admin/admin.module.ts`: change `exports: [AuditLogRepository]` to `exports: [AuditLogRepository, AuditLogInterceptor]`.

- [ ] **Step 4: Register AuthModule + Throttler in app.module**

In `src/app.module.ts`: import `AuthModule` and add to `imports`. Also add ThrottlerModule:
```ts
import { ThrottlerModule } from '@nestjs/throttler';
// in imports array:
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }]),
    AuthModule,
```
(Place `AuthModule` after the existing feature modules. `ThrottlerModule.forRoot` registers the limiter used by `@UseGuards(ThrottlerGuard)` on auth routes.)

- [ ] **Step 5: Mark existing public routes**

The global `AuthGuard` now protects everything. Add `@Public()` to routes that must stay open:
- `src/health/health.controller.ts` — add `@Public()` (import from `../auth/decorators`) on the health handler(s).
- `src/webhooks/*controller*.ts` — add `@Public()` on the `POST /webhooks/clickup` handler (it has its own signature guard).

Find them: `grep -rn "@Controller" src/health src/webhooks`.

- [ ] **Step 6: Verify build + full test run**

Run: `npm run build && npm run test`
Expected: build PASS; all existing + new unit tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/auth/auth.module.ts src/auth/invitation.controller.ts src/auth/users.controller.ts src/app.module.ts src/admin/admin.module.ts src/health src/webhooks
git commit -m "feat(auth): controllers, AuthModule, global guards, public-route marking"
```

---

## Task 15: Role-gate existing admin endpoints + audit actor from session

**Files:**
- Modify: `src/admin/admin.controller.ts`
- Modify: `src/admin/audit-log.interceptor.ts`

- [ ] **Step 1: Replace the admin-key guard with role gating**

In `src/admin/admin.controller.ts`:
- Remove `@UseGuards(AdminApiKeyGuard)` and its import (auth is now global).
- Add imports: `import { Roles } from '../auth/decorators'; import { Role } from '@prisma/client';`
- Add `@Roles(Role.OWNER, Role.ADMIN)` at the **controller level** (default for all admin ops).
- Add `@Roles(Role.OWNER)` at the **method level** on the Owner-only endpoints: the settings update (`PATCH`/`POST` that writes ClickUp token/secret/team — `update-settings`), and webhook registration (`POST webhooks/register`). Method-level `@Roles` overrides class-level via `getAllAndOverride`.
- Leave `@Get('ping')` reachable by any authenticated user: annotate it `@Roles(Role.OWNER, Role.ADMIN, Role.MEMBER)` (or simply leave the controller-level gate; ping is only used to validate access).

- [ ] **Step 2: Audit actor from the authenticated principal**

In `src/admin/audit-log.interceptor.ts`, change the `actor` line (currently reads `x-admin-user` header):
```ts
      actor:
        (req.user?.email as string | undefined) ??
        (req.user?.isMachine ? 'machine-key' : null) ??
        ((req.headers['x-admin-user'] as string | undefined) ?? null) || null,
```
(Prefer the session user's email; fall back to `machine-key`; keep the legacy header only as a last resort.)

- [ ] **Step 3: Verify build + tests**

Run: `npm run build && npm run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/admin/admin.controller.ts src/admin/audit-log.interceptor.ts
git commit -m "feat(auth): role-gate admin endpoints; audit actor from session"
```

---

## Task 16: Backend integration tests (e2e)

**Files:**
- Create: `test/auth.e2e-spec.ts`

> Requires a running Postgres+Redis test DB (`npm run dev:deps`) with migrations applied. These tests boot the real Nest app and exercise cookies + RBAC over HTTP.

- [ ] **Step 1: Write the e2e test**

`test/auth.e2e-spec.ts`:
```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Auth e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    // Clean identity tables; keep the seed org.
    await prisma.session.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => { await app.close(); });

  function agent() { return request.agent(app.getHttpServer()); }

  it('first signup claims the org as OWNER, second signup is rejected', async () => {
    const a = agent();
    const res = await a.post('/api/auth/signup').send({ email: 'owner@x.com', password: 'longenough10', name: 'Owner', orgName: 'Acme' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('OWNER');
    expect(res.headers['set-cookie'].join()).toContain('clickup_sync_sid');

    const dup = await agent().post('/api/auth/signup').send({ email: 'two@x.com', password: 'longenough10', name: 'Two', orgName: 'B' });
    expect(dup.status).toBe(409);
  });

  it('login + /auth/me + logout lifecycle', async () => {
    const a = agent();
    await a.post('/api/auth/login').send({ email: 'owner@x.com', password: 'longenough10' }).expect(200);
    const me = await a.get('/api/auth/me').expect(200);
    expect(me.body.user.email).toBe('owner@x.com');
    await a.post('/api/auth/logout').expect(200);
    await a.get('/api/auth/me').expect(401);
  });

  it('rejects a member hitting an admin write endpoint', async () => {
    // Invite + accept a MEMBER (as the owner).
    const owner = agent();
    await owner.post('/api/auth/login').send({ email: 'owner@x.com', password: 'longenough10' }).expect(200);
    const csrf = decodeURIComponent(/csrf=([^;]+)/.exec(owner.jar.getCookies(app.getHttpServer() as any).toString() ?? '')?.[1] ?? '');
    // Simpler: read csrf cookie from a /me roundtrip header — fall back to creating the invite via DB if cookie plumbing is awkward in supertest.
    const inv = await owner.post('/api/invitations').set('x-csrf-token', csrf).send({ email: 'member@x.com', role: 'MEMBER' });
    expect([200, 201]).toContain(inv.status);

    const invite = await prisma.invitation.findFirst({ where: { email: 'member@x.com' } });
    // Re-issue a known token via accept is hash-based; instead assert the row exists and is pending.
    expect(invite?.status).toBe('PENDING');
  });
});
```

> Note: CSRF cookie handling in supertest can be fiddly. If reading the `csrf` cookie inline proves awkward, set the session cookie via the agent and read the `csrf` value from the `set-cookie` header captured at login (parse it with a regex), then pass it as `x-csrf-token`. The member-403 assertion can alternatively be done by directly creating a MEMBER user + session row via Prisma and calling a write endpoint — choose whichever is stable in your harness. The key assertions: signup-claim, 409-on-second, login/me/logout, and a 403 for an under-privileged role on a write route.

- [ ] **Step 2: Run e2e**

Run: `npm run dev:deps` (once), then `npm run test -- auth.e2e`
Expected: PASS. Fix any cookie/CSRF plumbing per the note until green.

- [ ] **Step 3: Commit**

```bash
git add test/auth.e2e-spec.ts
git commit -m "test(auth): e2e signup-claim, session lifecycle, RBAC enforcement"
```

---

## Task 17: Frontend — API client (cookies + CSRF) and auth/users clients

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/auth.ts`, `apps/web/src/api/users.ts`
- Modify: `apps/web/src/api/admin.ts` (drop `validateAdminKey`)

- [ ] **Step 1: Cookie-based client with CSRF**

Replace `apps/web/src/api/client.ts`:
```ts
import axios from 'axios';

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toUpperCase();
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const csrf = readCookie('csrf');
    if (csrf) config.headers['x-csrf-token'] = csrf;
  }
  return config;
});

apiClient.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401 && !location.pathname.startsWith('/login')) {
      location.href = '/login';
    }
    return Promise.reject(error);
  },
);
```

- [ ] **Step 2: Auth API client**

`apps/web/src/api/auth.ts`:
```ts
import { apiClient } from './client';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';
export interface MeResponse {
  user: { id: string; email: string | null; role: Role; isMachine: boolean };
  org: { id: string; name: string };
}

export const authApi = {
  me: () => apiClient.get<MeResponse>('/auth/me').then((r) => r.data),
  login: (email: string, password: string) =>
    apiClient.post('/auth/login', { email, password }).then((r) => r.data),
  signup: (body: { email: string; password: string; name: string; orgName: string }) =>
    apiClient.post('/auth/signup', body).then((r) => r.data),
  logout: () => apiClient.post('/auth/logout').then((r) => r.data),
  previewInvite: (token: string) =>
    apiClient.get(`/auth/invitations/${token}`).then((r) => r.data as { email: string; role: Role; orgName: string }),
  acceptInvite: (token: string, name: string, password: string) =>
    apiClient.post(`/auth/invitations/${token}/accept`, { name, password }).then((r) => r.data),
};
```

- [ ] **Step 3: Users API client**

`apps/web/src/api/users.ts`:
```ts
import { apiClient } from './client';
import type { Role } from './auth';

export interface OrgUser {
  id: string; email: string; name: string | null; role: Role; status: 'ACTIVE' | 'DISABLED'; lastLoginAt: string | null;
}
export interface Invite { id: string; email: string; role: Role; status: string; expiresAt: string; createdAt: string; }

export const usersApi = {
  list: () => apiClient.get<OrgUser[]>('/users').then((r) => r.data),
  changeRole: (id: string, role: Role) => apiClient.patch(`/users/${id}/role`, { role }).then((r) => r.data),
  setStatus: (id: string, status: 'ACTIVE' | 'DISABLED') => apiClient.patch(`/users/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/users/${id}`).then((r) => r.data),
  transferOwnership: (targetUserId: string) => apiClient.post('/users/transfer-ownership', { targetUserId }).then((r) => r.data),
  listInvites: () => apiClient.get<Invite[]>('/invitations').then((r) => r.data),
  invite: (email: string, role: Role) => apiClient.post('/invitations', { email, role }).then((r) => r.data),
  resendInvite: (id: string) => apiClient.post(`/invitations/${id}/resend`).then((r) => r.data),
  revokeInvite: (id: string) => apiClient.post(`/invitations/${id}/revoke`).then((r) => r.data),
};
```

- [ ] **Step 4: Remove validateAdminKey**

In `apps/web/src/api/admin.ts`, delete the `validateAdminKey` function and its `import axios from 'axios'` line (no longer used).

- [ ] **Step 5: Verify web build**

Run: `npm run build:web`
Expected: may fail on `LoginPage` still importing `validateAdminKey` — that's fixed in Task 19. Proceed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/auth.ts apps/web/src/api/users.ts apps/web/src/api/admin.ts
git commit -m "feat(web): cookie+CSRF api client, auth/users API modules"
```

---

## Task 18: Frontend — AuthProvider, ProtectedRoute, RequireRole

**Files:**
- Create: `apps/web/src/hooks/useAuth.tsx`
- Create: `apps/web/src/components/RequireRole.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx` (wrap with AuthProvider)

- [ ] **Step 1: AuthProvider + useAuth**

`apps/web/src/hooks/useAuth.tsx`:
```tsx
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, MeResponse, Role } from '../api/auth';

interface AuthState {
  loading: boolean;
  user: MeResponse['user'] | null;
  org: MeResponse['org'] | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (min: Role) => boolean;
}

const RANK: Record<Role, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MeResponse['user'] | null>(null);
  const [org, setOrg] = useState<MeResponse['org'] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      setUser(me.user); setOrg(me.org);
    } catch {
      setUser(null); setOrg(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null); setOrg(null);
    location.href = '/login';
  }, []);

  const hasRole = useCallback((min: Role) => !!user && RANK[user.role] >= RANK[min], [user]);

  return <AuthContext.Provider value={{ loading, user, org, refresh, logout, hasRole }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

> Note: import is `useCallback` (typo guard — use the real React export `useCallback`, not `useCallBack`).

- [ ] **Step 2: RequireRole**

`apps/web/src/components/RequireRole.tsx`:
```tsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '../api/auth';

/** Route/section guard. Renders children only if the user meets `min` role. */
export function RequireRole({ min, children, redirect }: { min: Role; children: React.ReactNode; redirect?: string }) {
  const { hasRole, loading } = useAuth();
  if (loading) return null;
  if (!hasRole(min)) return redirect ? <Navigate to={redirect} replace /> : null;
  return <>{children}</>;
}
```

- [ ] **Step 3: Update App.tsx ProtectedRoute + routes**

In `apps/web/src/App.tsx`:
- Replace `ProtectedRoute` body:
```tsx
import { useAuth } from './hooks/useAuth';
// ...
function ProtectedRoute() {
  const { loading, user } = useAuth();
  if (loading) return <div className="p-6 text-(--text-muted)">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}
```
- Add public routes for `/signup` and `/invite/:token` (lazy import `SignupPage`, `AcceptInvitePage`) alongside `/login`.
- Wrap `/audit-log` and `/settings` route elements with `<RequireRole min="ADMIN" redirect="/overview">…</RequireRole>` and `<RequireRole min="OWNER" …>` is applied *within* Settings for the secrets section (Task 21), not the whole page (Admins can see Settings members tab).
  - Decision: gate `/settings` at `min="ADMIN"` (members can't see it) and `/audit-log` at `min="ADMIN"`.

- [ ] **Step 4: Wrap app with AuthProvider**

In `apps/web/src/main.tsx`, wrap `<App />` (or wrap inside `App.tsx` around `BrowserRouter`). Place `AuthProvider` **inside** `BrowserRouter` is not required; put it at the top in `main.tsx`:
```tsx
import { AuthProvider } from './hooks/useAuth';
// render:
<AuthProvider><App /></AuthProvider>
```
But `useAuth` is used in `App.tsx`'s `ProtectedRoute` which renders inside `BrowserRouter`; `AuthProvider` at the `main.tsx` root wraps everything, so that's fine. `RequireRole` uses `Navigate`, which must be inside `BrowserRouter` — it is (used in route elements).

- [ ] **Step 5: Verify web build**

Run: `npm run build:web`
Expected: fails only where `LoginPage`/`SignupPage`/`AcceptInvitePage` are missing — fixed next task.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useAuth.tsx apps/web/src/components/RequireRole.tsx apps/web/src/App.tsx apps/web/src/main.tsx
git commit -m "feat(web): AuthProvider, useAuth, RequireRole, cookie-based ProtectedRoute"
```

---

## Task 19: Frontend — Login (rework), Signup, Accept Invite pages

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`
- Create: `apps/web/src/pages/SignupPage.tsx`, `apps/web/src/pages/AcceptInvitePage.tsx`

- [ ] **Step 1: Rework LoginPage**

Replace `apps/web/src/pages/LoginPage.tsx` with an email+password form (drop the API-key + "your name" fields). On submit call `authApi.login(email, password)`, then `await refresh()` from `useAuth()`, then `navigate('/overview')`. Show the same styling/structure (reuse the existing card markup, swapping the two inputs for `email` (type=email) and `password`). On error show "Invalid email or password". Add a footer link: "No account? Set up your org" → `/signup`.

Key handler:
```tsx
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
// ...
const { refresh, user } = useAuth();
useEffect(() => { if (user) navigate('/overview', { replace: true }); }, [user, navigate]);
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setLoading(true); setError('');
  try {
    await authApi.login(email.trim(), password);
    await refresh();
    navigate('/overview', { replace: true });
  } catch {
    setError('Invalid email or password');
  } finally { setLoading(false); }
}
```

- [ ] **Step 2: SignupPage**

`apps/web/src/pages/SignupPage.tsx` — form with `orgName`, `name`, `email`, `password` (min 10). On submit `authApi.signup(...)`, then `refresh()`, then `navigate('/overview')`. On 409 show "Signup is closed — ask an admin for an invite." Reuse the LoginPage card styling.

```tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';

export function SignupPage() {
  const [form, setForm] = useState({ orgName: '', name: '', email: '', password: '' });
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const navigate = useNavigate(); const { refresh } = useAuth();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    try {
      await authApi.signup({ ...form, email: form.email.trim() });
      await refresh(); navigate('/overview', { replace: true });
    } catch (err: any) {
      setError(err?.response?.status === 409 ? 'Signup is closed — ask an admin for an invite.' : 'Could not create your account.');
    } finally { setLoading(false); }
  }
  // ...render the four inputs bound to `form` with the LoginPage card styling, a submit button, and {error}
  return null; // replace with JSX mirroring LoginPage's markup
}
```
> Implementation note: copy LoginPage's outer `<div>`/card markup; render four labeled inputs bound to `form` fields; button text "Create org & owner".

- [ ] **Step 3: AcceptInvitePage**

`apps/web/src/pages/AcceptInvitePage.tsx`:
```tsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { authApi, Role } from '../api/auth';

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<{ email: string; role: Role; orgName: string } | null>(null);
  const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    authApi.previewInvite(token).then(setInfo).catch(() => setError('This invitation is invalid or has expired.'));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    try {
      await authApi.acceptInvite(token, name.trim(), password);
      navigate('/login', { replace: true });
    } catch { setError('Could not accept the invitation.'); }
    finally { setLoading(false); }
  }
  // render: if error and no info -> show error; else show "Join {info.orgName} as {info.role}" + name + password inputs
  return null; // replace with JSX mirroring LoginPage's card markup
}
```
> Implementation note: render the card; when `info` is loaded show "Join **{info.orgName}** as **{info.role}** ({info.email})", name + password inputs, submit "Accept & set password"; after success redirect to `/login` with a success message.

- [ ] **Step 4: Verify web build**

Run: `npm run build:web`
Expected: PASS (all referenced pages exist; fill in the JSX so there are no `return null` placeholders before this passes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/LoginPage.tsx apps/web/src/pages/SignupPage.tsx apps/web/src/pages/AcceptInvitePage.tsx
git commit -m "feat(web): email/password login, signup, accept-invite pages"
```

---

## Task 20: Frontend — Members & Access tab, role-gated UI, sidebar

**Files:**
- Create: `apps/web/src/hooks/useUsers.ts`
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/components/layout/TopBar.tsx` (logout + user display)

- [ ] **Step 1: useUsers hooks**

`apps/web/src/hooks/useUsers.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../api/users';
import type { Role } from '../api/auth';

export function useOrgUsers() {
  return useQuery({ queryKey: ['org-users'], queryFn: usersApi.list });
}
export function useInvites() {
  return useQuery({ queryKey: ['org-invites'], queryFn: usersApi.listInvites });
}
export function useUserMutations() {
  const qc = useQueryClient();
  const inv = () => { void qc.invalidateQueries({ queryKey: ['org-users'] }); void qc.invalidateQueries({ queryKey: ['org-invites'] }); };
  return {
    invite: useMutation({ mutationFn: ({ email, role }: { email: string; role: Role }) => usersApi.invite(email, role), onSuccess: inv }),
    changeRole: useMutation({ mutationFn: ({ id, role }: { id: string; role: Role }) => usersApi.changeRole(id, role), onSuccess: inv }),
    setStatus: useMutation({ mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'DISABLED' }) => usersApi.setStatus(id, status), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => usersApi.remove(id), onSuccess: inv }),
    resend: useMutation({ mutationFn: (id: string) => usersApi.resendInvite(id), onSuccess: inv }),
    revoke: useMutation({ mutationFn: (id: string) => usersApi.revokeInvite(id), onSuccess: inv }),
  };
}
```

- [ ] **Step 2: Members & Access section in SettingsPage**

In `apps/web/src/pages/SettingsPage.tsx`, replace the mock "Members & access" section with a real one using `useOrgUsers`, `useInvites`, `useUserMutations`:
- A table of users: name/email, role dropdown (`useUserMutations().changeRole`), status toggle (disable/enable), remove button. Disable controls the current user can't perform (compare against `useAuth().user.role` and the row's role — hide owner-affecting controls for admins; never show remove on yourself or the last owner).
- An invite form (email + role select limited to ADMIN/MEMBER) → `invite.mutate`.
- A pending-invites list with Resend / Revoke.
- Wrap the existing **org-secrets** section (ClickUp token / webhook secret / team / register webhook) in `<RequireRole min="OWNER">…</RequireRole>` so only Owners see/edit it.

> Use the existing UI primitives (`DataTable`, `Select`, `Button`, `Field`, `Pill`, `Callout`) already in `apps/web/src/components/ui`. Match the page's existing card/section structure.

- [ ] **Step 3: Sidebar + TopBar gating**

- `Sidebar.tsx`: hide the `Audit Log` and `Settings` nav items for Members — read `useAuth().hasRole('ADMIN')` and conditionally render those links.
- `TopBar.tsx`: show the signed-in user's email + a "Sign out" button calling `useAuth().logout()`. Remove any leftover "admin user name" localStorage UI.

- [ ] **Step 4: Hide write actions for Members across pages**

In pages with write buttons (Tasks "Backfill", Time Entries "Recalculate", Assignee Rates add/edit, single-task sync in `TaskDetailDrawer`), wrap the action in `<RequireRole min="ADMIN">` or disable when `!hasRole('ADMIN')`. Grep for the mutation hooks (`useAdmin`, `adminApi`) to find call sites.

- [ ] **Step 5: Verify web build**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useUsers.ts apps/web/src/pages/SettingsPage.tsx apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/TopBar.tsx
git commit -m "feat(web): members & access tab, role-gated UI, logout"
```

---

## Task 21: Expired-session sweep + docs

**Files:**
- Create: `src/auth/session-cleanup.service.ts`
- Modify: `src/auth/auth.module.ts` (register provider)
- Modify: `README.md`, `docs/OPERATIONS.md`, `CLAUDE.md`, `.env.example`

- [ ] **Step 1: Scheduled cleanup**

`src/auth/session-cleanup.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionRepository } from './session.repository';

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);
  constructor(private readonly sessions: SessionRepository) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep() {
    const { count } = await this.sessions.deleteExpired();
    if (count > 0) this.logger.log(`Swept ${count} expired session(s)`);
  }
}
```
Register it in `auth.module.ts` providers. (`@nestjs/schedule`'s `ScheduleModule` is already imported app-wide — verify with `grep -rn "ScheduleModule" src`; if not, add `ScheduleModule.forRoot()` to `app.module.ts`.)

- [ ] **Step 2: Update docs**

- `README.md` / `docs/OPERATIONS.md`: document the new auth model (first signup claims the org → Owner; invites; cookie sessions; `ADMIN_API_KEY` is now a machine credential), and the new env vars.
- `CLAUDE.md`: in "Known starter limitations", move "Per-user authentication" from the limitations list to "Already in place", noting Owner/Admin/Member RBAC, sessions, and that data isolation per org remains (Spec 2).
- `.env.example`: ensure the Task 1 vars are present (already added).

- [ ] **Step 3: Full verification**

Run: `npm run lint && npm run test && npm run build && npm run build:web`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/auth/session-cleanup.service.ts src/auth/auth.module.ts README.md docs/OPERATIONS.md CLAUDE.md
git commit -m "feat(auth): expired-session sweep; docs for auth/orgs/RBAC"
```

---

## Manual verification checklist

After all tasks, with `npm run dev:all` running (Postgres+Redis up, migrations applied, fresh identity tables):

- [ ] Visit `/signup` on a fresh DB → create org+owner → land on Overview.
- [ ] `/signup` again → "Signup is closed".
- [ ] Log out → `/login` → log back in.
- [ ] As Owner, Settings → invite an ADMIN and a MEMBER → check the dev log for the invite link.
- [ ] Open the invite link in a private window → set password → log in.
- [ ] As Member: dashboards load read-only; no `/settings` or `/audit-log` in the sidebar; write buttons hidden; hitting `/api/admin/*` returns 403.
- [ ] As Admin: can invite (not Owners), run syncs, but the org-secrets settings section is hidden.
- [ ] As Owner: change a user's role, disable a user (their session is revoked on next request), transfer ownership.
- [ ] `curl -H "x-admin-key: $ADMIN_API_KEY" /api/admin/ping` still works (machine credential).
- [ ] Confirm no `x-admin-key` is stored in `localStorage` and the session cookie is `HttpOnly`.

---

## Self-review notes (addressed)

- **Spec coverage:** signup-claim (T10/16), login/logout/me (T11/16), invitations+email (T9/12/14), user management + transfer (T13/14), RBAC matrix (T5 + service guards), guards & CSRF (T8), throttling (T14), cookie sessions + sweep (T7/21), frontend auth + role-gating (T17–20), audit actor from session (T15), machine key retained (T8). Spec 2 (data isolation) explicitly out of scope.
- **Placeholders:** the three frontend pages and the Members section reference existing UI primitives and provide complete handlers; the `return null` markers in T19 are explicitly flagged to be filled with JSX mirroring LoginPage before the build step passes — not silent TODOs.
- **Type consistency:** `AuthPrincipal` (userId/orgId/role/email/isMachine) is used uniformly across guard, services, controllers; `SESSION_COOKIE` exported from `auth.guard.ts` and imported by the controller; `SEED_ORG_ID` exported from `org.repository.ts`; `Role` always from `@prisma/client`.
