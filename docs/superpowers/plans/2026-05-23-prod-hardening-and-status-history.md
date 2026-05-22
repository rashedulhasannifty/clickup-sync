# Production Hardening + Status-Change History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three internal-only features for the ClickUp sync service in one production-readiness pass: (1) hard-fail in production when secrets are missing, (2) admin audit log via NestJS interceptor, (3) status-change history v1 captured into a new `clickup_task_events` table with a cycle-time card on the Overview page.

**Architecture:** All three features land in their existing modules — no new NestJS modules, no new BullMQ queues, no new workers. The audit log uses a NestJS interceptor registered on `AdminController` that captures `POST | PATCH | DELETE` requests, redacts secrets in request bodies, and writes to a new `admin_audit_log` table. The status-change feature subscribes to ClickUp's `taskStatusUpdated` webhook event, extends the existing `webhook-parser.service` and `clickup-event.processor` to extract and persist each `history_items[]` status change with sha256 fingerprint dedupe.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL, BullMQ, Jest + Supertest, React 19 + Vite + TanStack Query, Tailwind/CSS-in-JS via existing design tokens. Spec: `docs/superpowers/specs/2026-05-23-prod-hardening-and-status-history-design.md`.

---

## File Structure

**New files (backend):**
- `src/admin/audit-log.repository.ts` — write + paginated read for `AdminAuditLog`
- `src/admin/audit-log.interceptor.ts` — NestJS interceptor on `AdminController` (POST/PATCH/DELETE only; redaction; truncation; fire-and-forget)
- `prisma/migrations/0004_admin_audit_and_task_events/migration.sql` — additive: two new tables

**New files (frontend):**
- `apps/web/src/pages/AuditLogPage.tsx` — read-only paginated viewer
- `apps/web/src/api/auditLog.ts` — `auditLogApi` (list)
- `apps/web/src/hooks/useAuditLog.ts` — `useAuditLog(...)` TanStack Query hook
- `apps/web/src/components/AuditLogDrawer.tsx` — full-row drawer
- `apps/web/src/components/charts/CycleTimeCard.tsx` — tabbed Cycle Time / Time in Status card on Overview
- `apps/web/src/api/reports.ts` — *extend* (add `cycleTime`, `timeInStatus`)
- `apps/web/src/hooks/useReports.ts` — *extend* (add `useCycleTime`, `useTimeInStatus`)

**New files (tests):**
- `test/audit-log.interceptor.spec.ts`
- `test/audit-log.repository.spec.ts`
- `test/webhook-parser.service.spec.ts`
- `test/clickup-event.processor.spec.ts`
- `test/fixtures/clickup-status-update.fixture.json`

**Modified files (backend):**
- `src/config/env.validation.ts` — Zod superRefine for prod requiredness; add `taskStatusUpdated` to default events
- `src/webhooks/webhook-signature.guard.ts` — prod-aware bypass branch
- `src/admin/admin-api-key.guard.ts` — prod-aware bypass branch
- `src/admin/admin.controller.ts` — register `@UseInterceptors(AuditLogInterceptor)`; add `@Get('audit-log')` endpoint
- `src/admin/admin.module.ts` — register `AuditLogRepository` + `AuditLogInterceptor` providers
- `src/clickup/clickup-webhooks.service.ts` — no logic change (default list change is in env.validation.ts)
- `src/webhooks/webhook-parser.service.ts` — add `extractStatusChanges(payload)`
- `src/workers/clickup-event.processor.ts` — add `taskStatusUpdated` branch
- `src/reports/reports.service.ts` — add `cycleTime()`, `timeInStatus()`
- `src/reports/reports.controller.ts` — add `GET /reports/cycle-time`, `GET /reports/time-in-status`
- `prisma/schema.prisma` — add `AdminAuditLog`, `ClickupTaskEvent` models

**Modified files (tests):**
- `test/env.validation.spec.ts` — extend with prod-mode cases
- `test/admin-api-key.guard.spec.ts` — add prod-mode case
- `test/webhook-signature.guard.spec.ts` — add prod-mode case
- `test/reports.service.spec.ts` — add `cycleTime` + `timeInStatus` describes

**Modified files (frontend):**
- `apps/web/src/api/client.ts` — add `X-Admin-User` header from `localStorage.getItem('adminUserName')`
- `apps/web/src/components/layout/Sidebar.tsx` — add "Audit Log" nav item; make footer name clickable to edit
- `apps/web/src/App.tsx` — add lazy import + route for `/audit-log`
- `apps/web/src/pages/OverviewPage.tsx` — drop `<CycleTimeCard />` into the chart row

---

## Phasing (commit boundaries)

You can stop after any phase and the app stays consistent.

- **Phase 1 — Hardening** (Tasks 1–3): env validation + both guards.
- **Phase 2 — Schema migration** (Task 4): both new tables in one migration. Decouples DB schema from any code that uses it.
- **Phase 3 — Admin audit log** (Tasks 5–11): backend then frontend.
- **Phase 4 — Status-change history** (Tasks 12–18): webhook subscription, parser, processor, reports, UI.
- **Phase 5 — Cleanup** (Tasks 19–20): manual verification + CLAUDE.md update.

---

# Phase 1 — Hardening

### Task 1: Env validation requires secrets in production

**Files:**
- Modify: `src/config/env.validation.ts`
- Modify: `test/env.validation.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append these cases to `test/env.validation.spec.ts` inside the existing `describe('validateEnv', …)` block:

```ts
  describe('production mode requirements', () => {
    const prodBase = {
      ...base,
      NODE_ENV: 'production',
      CLICKUP_WEBHOOK_SECRET: 'wh-secret-value',
      ADMIN_API_KEY: 'admin-key-min-32-chars-long-padding',
    };

    it('accepts production when CLICKUP_WEBHOOK_SECRET and ADMIN_API_KEY are present', () => {
      const result = validateEnv(prodBase);
      expect(result.NODE_ENV).toBe('production');
      expect(result.CLICKUP_WEBHOOK_SECRET).toBe('wh-secret-value');
    });

    it('rejects production when CLICKUP_WEBHOOK_SECRET is missing', () => {
      expect(() => validateEnv({ ...prodBase, CLICKUP_WEBHOOK_SECRET: '' }))
        .toThrow(/CLICKUP_WEBHOOK_SECRET/);
    });

    it('rejects production when ADMIN_API_KEY is missing', () => {
      expect(() => validateEnv({ ...prodBase, ADMIN_API_KEY: '' }))
        .toThrow(/ADMIN_API_KEY/);
    });

    it('rejects production when ADMIN_API_KEY is too short (< 32 chars)', () => {
      expect(() => validateEnv({ ...prodBase, ADMIN_API_KEY: 'short' }))
        .toThrow(/ADMIN_API_KEY/);
    });

    it('allows empty secrets in development (preserves dev-mode bypass)', () => {
      const result = validateEnv({
        ...base,
        NODE_ENV: 'development',
        CLICKUP_WEBHOOK_SECRET: '',
        ADMIN_API_KEY: '',
      });
      expect(result.CLICKUP_WEBHOOK_SECRET).toBe('');
      expect(result.ADMIN_API_KEY).toBe('');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/env.validation.spec.ts`
Expected: the 3 prod-rejection cases FAIL ("Expected to throw"); the prod-accept case may PASS by luck.

- [ ] **Step 3: Implement the `superRefine` in `src/config/env.validation.ts`**

Replace the entire file with:

```ts
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CLICKUP_API_TOKEN: z.string().min(1),
  CLICKUP_TEAM_ID: z.string().default('3450636'),
  CLICKUP_WEBHOOK_ENDPOINT: z.string().optional().default(''),
  CLICKUP_WEBHOOK_SECRET: z.string().optional().default(''),
  CLICKUP_WEBHOOK_EVENTS: z.string().default(
    'taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated,taskStatusUpdated'
  ),
  CLICKUP_AGENCY_USER_ID: z.string().default('3584055'),
  ADMIN_API_KEY: z.string().optional().default(''),
  JOB_ATTEMPTS: z.coerce.number().default(5),
  JOB_BACKOFF_DELAY_MS: z.coerce.number().default(30000),
  RECONCILE_EVERY_MINUTES: z.coerce.number().default(15),
  RECONCILE_LOOKBACK_HOURS: z.coerce.number().default(2),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.CLICKUP_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['CLICKUP_WEBHOOK_SECRET'],
      message: 'CLICKUP_WEBHOOK_SECRET is required when NODE_ENV=production',
    });
  }
  if (!env.ADMIN_API_KEY || env.ADMIN_API_KEY.length < 32) {
    ctx.addIssue({
      code: 'custom',
      path: ['ADMIN_API_KEY'],
      message: 'ADMIN_API_KEY (min 32 chars) is required when NODE_ENV=production',
    });
  }
});

export type Env = z.infer<typeof schema>;
export function validateEnv(config: Record<string, unknown>) {
  const result = schema.safeParse(config);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.message}`);
  return result.data;
}
```

This also adds `taskStatusUpdated` to the default events list — used by `clickup-webhooks.service.ts:register()` (no code change there).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/env.validation.spec.ts`
Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.validation.ts test/env.validation.spec.ts
git commit -m "feat(config): require CLICKUP_WEBHOOK_SECRET + ADMIN_API_KEY in production; subscribe to taskStatusUpdated by default"
```

---

### Task 2: Webhook signature guard hard-fails in production

**Files:**
- Modify: `src/webhooks/webhook-signature.guard.ts`
- Modify: `test/webhook-signature.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

Append this `it()` block to `test/webhook-signature.guard.spec.ts` inside the existing `describe('WebhookSignatureGuard', …)`:

```ts
  it('throws InternalServerErrorException in production when secret is empty', () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => makeGuard('').canActivate(makeCtx(undefined, undefined)))
        .toThrow(/Webhook secret missing in production/);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
```

Also import `InternalServerErrorException` at the top:

```ts
import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/webhook-signature.guard.spec.ts`
Expected: the new case FAILs (currently bypasses with a warning).

- [ ] **Step 3: Implement the prod-aware bypass**

Replace `src/webhooks/webhook-signature.guard.ts` with:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Request } from 'express';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const secret = this.config.get<string>('CLICKUP_WEBHOOK_SECRET', '');

    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        // Env validation catches this at boot; this is defense-in-depth.
        throw new InternalServerErrorException('Webhook secret missing in production');
      }
      this.logger.warn('CLICKUP_WEBHOOK_SECRET not set — skipping signature verification (dev mode)');
      return true;
    }

    const signature = req.headers['x-signature'] as string | undefined;
    if (!signature) throw new UnauthorizedException('Missing X-Signature header');

    const rawBody = req.rawBody;
    if (!rawBody) throw new UnauthorizedException('Raw body unavailable');

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(signature);

    if (expectedBuf.length !== signatureBuf.length || !crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/webhook-signature.guard.spec.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webhooks/webhook-signature.guard.ts test/webhook-signature.guard.spec.ts
git commit -m "feat(webhooks): hard-fail signature guard in production when secret missing"
```

---

### Task 3: Admin API key guard hard-fails in production

**Files:**
- Modify: `src/admin/admin-api-key.guard.ts`
- Modify: `test/admin-api-key.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

Append this `it()` block to `test/admin-api-key.guard.spec.ts`:

```ts
  it('throws InternalServerErrorException in production when key is empty', () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => makeGuard('').canActivate(makeCtx(undefined)))
        .toThrow(/Admin API key missing in production/);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
```

Update the top import:

```ts
import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/admin-api-key.guard.spec.ts`
Expected: the new case FAILs.

- [ ] **Step 3: Implement the prod-aware bypass**

Replace `src/admin/admin-api-key.guard.ts` with:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Request } from 'express';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(AdminApiKeyGuard.name);
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const apiKey = this.config.get<string>('ADMIN_API_KEY', '');

    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new InternalServerErrorException('Admin API key missing in production');
      }
      this.logger.warn('ADMIN_API_KEY not set — skipping admin auth (dev mode)');
      return true;
    }

    const provided = req.headers['x-admin-key'] as string | undefined;
    if (!provided) throw new UnauthorizedException('Missing x-admin-key header');

    const keyBuf = Buffer.from(apiKey);
    const providedBuf = Buffer.from(provided);
    if (keyBuf.length !== providedBuf.length || !crypto.timingSafeEqual(keyBuf, providedBuf)) {
      throw new UnauthorizedException('Invalid admin API key');
    }

    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/admin-api-key.guard.spec.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/admin-api-key.guard.ts test/admin-api-key.guard.spec.ts
git commit -m "feat(admin): hard-fail admin guard in production when key missing"
```

---

# Phase 2 — Schema migration

### Task 4: Add AdminAuditLog + ClickupTaskEvent to schema & migrate

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0004_admin_audit_and_task_events/migration.sql`

- [ ] **Step 1: Append both models to `prisma/schema.prisma`**

Append at the end of the file (after the existing `TimeEntryReplacement` model):

```prisma
model AdminAuditLog {
  id           BigInt   @id @default(autoincrement())
  occurredAt   DateTime @default(now()) @map("occurred_at")
  actor        String?
  method       String
  path         String
  routePattern String?  @map("route_pattern")
  statusCode   Int      @map("status_code")
  durationMs   Int?     @map("duration_ms")
  ip           String?
  userAgent    String?  @map("user_agent")
  requestBody  Json?    @map("request_body")
  errorMessage String?  @map("error_message")

  @@index([occurredAt])
  @@index([actor, occurredAt])
  @@index([routePattern, occurredAt])
  @@map("admin_audit_log")
}

model ClickupTaskEvent {
  id                BigInt   @id @default(autoincrement())
  taskId            String   @map("task_id")
  eventType         String   @map("event_type")
  occurredAt        DateTime @map("occurred_at")
  changedByUserId   String?  @map("changed_by_user_id")
  changedByUserName String?  @map("changed_by_user_name")
  before            Json?
  after             Json?
  fingerprint       String   @unique
  raw               Json?

  @@index([taskId, occurredAt])
  @@index([eventType, occurredAt])
  @@map("clickup_task_events")
}
```

- [ ] **Step 2: Create the migration directory and SQL**

Create `prisma/migrations/0004_admin_audit_and_task_events/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "route_pattern" TEXT,
    "status_code" INTEGER NOT NULL,
    "duration_ms" INTEGER,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_body" JSONB,
    "error_message" TEXT,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clickup_task_events" (
    "id" BIGSERIAL NOT NULL,
    "task_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "changed_by_user_id" TEXT,
    "changed_by_user_name" TEXT,
    "before" JSONB,
    "after" JSONB,
    "fingerprint" TEXT NOT NULL,
    "raw" JSONB,

    CONSTRAINT "clickup_task_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_log_occurred_at_idx" ON "admin_audit_log"("occurred_at");
CREATE INDEX "admin_audit_log_actor_occurred_at_idx" ON "admin_audit_log"("actor", "occurred_at");
CREATE INDEX "admin_audit_log_route_pattern_occurred_at_idx" ON "admin_audit_log"("route_pattern", "occurred_at");

CREATE UNIQUE INDEX "clickup_task_events_fingerprint_key" ON "clickup_task_events"("fingerprint");
CREATE INDEX "clickup_task_events_task_id_occurred_at_idx" ON "clickup_task_events"("task_id", "occurred_at");
CREATE INDEX "clickup_task_events_event_type_occurred_at_idx" ON "clickup_task_events"("event_type", "occurred_at");
```

- [ ] **Step 3: Apply the migration and regenerate the Prisma client**

```bash
npm run prisma:deploy
npm run prisma:generate
```

Expected output (`prisma:deploy`): `Applying migration '0004_admin_audit_and_task_events'` followed by `The following migration(s) have been applied`.

- [ ] **Step 4: Smoke check the tables exist**

```bash
psql "$DATABASE_URL" -c "\d admin_audit_log" -c "\d clickup_task_events"
```

(Or use your preferred DB client — `npm run dev:psql` if defined.) Expected: both `\d` commands print the column lists matching the SQL above.

- [ ] **Step 5: Build to verify generated client compiles**

Run: `npm run build`
Expected: clean build (no TS errors). Prisma now exports `AdminAuditLog` and `ClickupTaskEvent` types.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0004_admin_audit_and_task_events
git commit -m "feat(db): add admin_audit_log and clickup_task_events tables"
```

---

# Phase 3 — Admin audit log

### Task 5: AuditLogRepository (write + paginated read)

**Files:**
- Create: `src/admin/audit-log.repository.ts`
- Create: `test/audit-log.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/audit-log.repository.spec.ts`:

```ts
import { AuditLogRepository } from '../src/admin/audit-log.repository';

function makePrisma(over: Partial<Record<string, any>> = {}) {
  return {
    adminAuditLog: {
      create: jest.fn().mockResolvedValue({ id: BigInt(1) }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    ...over,
  } as any;
}

describe('AuditLogRepository', () => {
  describe('create', () => {
    it('writes a row with all captured fields', async () => {
      const prisma = makePrisma();
      const repo = new AuditLogRepository(prisma);
      await repo.create({
        actor: 'rashedul',
        method: 'POST',
        path: '/admin/rates',
        routePattern: '/admin/rates',
        statusCode: 201,
        durationMs: 42,
        ip: '127.0.0.1',
        userAgent: 'jest',
        requestBody: { foo: 'bar' },
        errorMessage: null,
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actor: 'rashedul',
          method: 'POST',
          path: '/admin/rates',
          routePattern: '/admin/rates',
          statusCode: 201,
          requestBody: { foo: 'bar' },
        }),
      });
    });

    it('allows null actor (no X-Admin-User header)', async () => {
      const prisma = makePrisma();
      await new AuditLogRepository(prisma).create({
        actor: null, method: 'DELETE', path: '/admin/rates/3',
        routePattern: '/admin/rates/:id', statusCode: 204, durationMs: 10,
        ip: null, userAgent: null, requestBody: null, errorMessage: null,
      });
      expect(prisma.adminAuditLog.create.mock.calls[0][0].data.actor).toBeNull();
    });
  });

  describe('findMany', () => {
    it('filters by actor and date range, paginates, returns { items, total }', async () => {
      const prisma = makePrisma();
      prisma.adminAuditLog.findMany.mockResolvedValue([
        { id: BigInt(7), occurredAt: new Date(), actor: 'rashedul', method: 'POST', path: '/admin/rates', routePattern: '/admin/rates', statusCode: 201, durationMs: 11, ip: null, userAgent: null, requestBody: null, errorMessage: null },
      ]);
      prisma.adminAuditLog.count.mockResolvedValue(1);
      const out = await new AuditLogRepository(prisma).findMany({
        actor: 'rashedul', routePattern: undefined,
        from: new Date('2026-05-01'), to: new Date('2026-05-31'),
        limit: 50, offset: 0,
      });
      expect(out.total).toBe(1);
      expect(out.items[0].id).toBe('7');
      const call = prisma.adminAuditLog.findMany.mock.calls[0][0];
      expect(call.where.actor).toBe('rashedul');
      expect(call.where.occurredAt).toEqual({ gte: new Date('2026-05-01'), lte: new Date('2026-05-31') });
      expect(call.take).toBe(50);
      expect(call.orderBy).toEqual({ occurredAt: 'desc' });
    });

    it('caps limit at 200', async () => {
      const prisma = makePrisma();
      await new AuditLogRepository(prisma).findMany({ limit: 9999, offset: 0 });
      expect(prisma.adminAuditLog.findMany.mock.calls[0][0].take).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/audit-log.repository.spec.ts`
Expected: FAIL with "Cannot find module '../src/admin/audit-log.repository'".

- [ ] **Step 3: Implement the repository**

Create `src/admin/audit-log.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface AuditLogCreateInput {
  actor: string | null;
  method: string;
  path: string;
  routePattern: string | null;
  statusCode: number;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
  requestBody: unknown;
  errorMessage: string | null;
}

export interface AuditLogFindManyInput {
  actor?: string;
  routePattern?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: AuditLogCreateInput) {
    return this.prisma.adminAuditLog.create({
      data: {
        actor: input.actor,
        method: input.method,
        path: input.path,
        routePattern: input.routePattern,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        ip: input.ip,
        userAgent: input.userAgent,
        requestBody: input.requestBody as any,
        errorMessage: input.errorMessage,
      },
    });
  }

  async findMany(input: AuditLogFindManyInput) {
    const limit = Math.min(input.limit, 200);
    const where: any = {};
    if (input.actor) where.actor = input.actor;
    if (input.routePattern) where.routePattern = input.routePattern;
    if (input.from || input.to) {
      where.occurredAt = {};
      if (input.from) where.occurredAt.gte = input.from;
      if (input.to) where.occurredAt.lte = input.to;
    }
    const [rows, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: limit,
        skip: input.offset,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({ ...r, id: r.id.toString() })),
      total,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/audit-log.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/audit-log.repository.ts test/audit-log.repository.spec.ts
git commit -m "feat(admin): add AuditLogRepository for admin_audit_log writes and queries"
```

---

### Task 6: AuditLogInterceptor — write actions only, redaction, truncation

**Files:**
- Create: `src/admin/audit-log.interceptor.ts`
- Create: `test/audit-log.interceptor.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/audit-log.interceptor.spec.ts`:

```ts
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditLogInterceptor } from '../src/admin/audit-log.interceptor';

function makeRepo() {
  return { create: jest.fn().mockResolvedValue(undefined) };
}

function makeCtx(opts: {
  method: string;
  path: string;
  routePath?: string;
  body?: unknown;
  headers?: Record<string, string>;
  statusCode?: number;
}) {
  const req = {
    method: opts.method,
    path: opts.path,
    route: opts.routePath ? { path: opts.routePath } : undefined,
    headers: opts.headers ?? {},
    body: opts.body,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = { statusCode: opts.statusCode ?? 200 };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

function makeNext(result: unknown | Error) {
  return {
    handle: () =>
      result instanceof Error ? throwError(() => result) : of(result),
  };
}

describe('AuditLogInterceptor', () => {
  it('does not write for GET requests', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(makeCtx({ method: 'GET', path: '/admin/audit-log' }), makeNext({ ok: 1 })));
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('writes a row on POST success with status, duration, redacted body', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(
      makeCtx({
        method: 'POST',
        path: '/admin/rates',
        routePath: '/admin/rates',
        body: { secret: 'pk_should_redact', amountCents: 12345 },
        headers: { 'x-admin-user': 'rashedul', 'user-agent': 'jest' },
        statusCode: 201,
      }),
      makeNext({ ok: 1 }),
    ));
    expect(repo.create).toHaveBeenCalledTimes(1);
    const call = repo.create.mock.calls[0][0];
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/admin/rates');
    expect(call.statusCode).toBe(201);
    expect(call.actor).toBe('rashedul');
    expect(call.userAgent).toBe('jest');
    expect(call.errorMessage).toBeNull();
    expect(call.requestBody.secret).toBe('[REDACTED]');
    expect(call.requestBody.amountCents).toBe(12345);
    expect(typeof call.durationMs).toBe('number');
  });

  it('writes a row on error with errorMessage and non-2xx status', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    const err = Object.assign(new Error('boom'), { status: 400 });
    await expect(lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/admin/rates', body: {} }),
      makeNext(err),
    ))).rejects.toThrow('boom');
    const call = repo.create.mock.calls[0][0];
    expect(call.errorMessage).toBe('boom');
    expect(call.statusCode).toBe(400);
  });

  it('redacts nested keys matching the pattern', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'PATCH', path: '/x', body: { outer: { apiKey: 'k', token: 't', name: 'ok' } } }),
      makeNext({}),
    ));
    const body = repo.create.mock.calls[0][0].requestBody;
    expect(body.outer.apiKey).toBe('[REDACTED]');
    expect(body.outer.token).toBe('[REDACTED]');
    expect(body.outer.name).toBe('ok');
  });

  it('handles cyclic body without throwing', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    const cyclic: any = { a: 1 };
    cyclic.self = cyclic;
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/x', body: cyclic }),
      makeNext({}),
    ));
    const body = repo.create.mock.calls[0][0].requestBody;
    expect(body._redactionError).toBe(true);
  });

  it('truncates bodies > 16 KB', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    const big = 'x'.repeat(20000);
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/x', body: { blob: big } }),
      makeNext({}),
    ));
    const body = repo.create.mock.calls[0][0].requestBody;
    expect(body._truncated).toBe(true);
    expect(typeof body.preview).toBe('string');
    expect(body.preview.length).toBeLessThanOrEqual(16384);
  });

  it('omits actor when X-Admin-User header is absent', async () => {
    const repo = makeRepo();
    const interceptor = new AuditLogInterceptor(repo as any);
    await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'DELETE', path: '/admin/rates/9', body: {} }),
      makeNext({}),
    ));
    expect(repo.create.mock.calls[0][0].actor).toBeNull();
  });

  it('does not throw user-visible error when repo.create rejects', async () => {
    const repo = { create: jest.fn().mockRejectedValue(new Error('db down')) };
    const interceptor = new AuditLogInterceptor(repo as any);
    const out = await lastValueFrom(interceptor.intercept(
      makeCtx({ method: 'POST', path: '/x', body: {} }),
      makeNext({ ok: 1 }),
    ));
    expect(out).toEqual({ ok: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/audit-log.interceptor.spec.ts`
Expected: FAIL with "Cannot find module '../src/admin/audit-log.interceptor'".

- [ ] **Step 3: Implement the interceptor**

Create `src/admin/audit-log.interceptor.ts`:

```ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { AuditLogRepository } from './audit-log.repository';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const REDACT_RE = /(secret|token|api[_-]?key|password|signature)/i;
const MAX_BODY_BYTES = 16 * 1024;

function redact(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) throw new Error('cyclic');
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_RE.test(k)) out[k] = '[REDACTED]';
    else out[k] = redact(v, seen);
  }
  return out;
}

function prepareBody(raw: unknown): unknown {
  if (raw === undefined || raw === null) return null;
  let processed: unknown;
  try {
    processed = redact(raw);
  } catch {
    return { _redactionError: true };
  }
  try {
    const json = JSON.stringify(processed);
    if (json.length <= MAX_BODY_BYTES) return processed;
    return { _truncated: true, preview: json.slice(0, MAX_BODY_BYTES) };
  } catch {
    return { _redactionError: true };
  }
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);
  constructor(private readonly repo: AuditLogRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!WRITE_METHODS.has(req.method)) return next.handle();

    const startedAt = Date.now();
    const meta = {
      method: req.method as string,
      path: req.path as string,
      routePattern: (req.route?.path as string | undefined) ?? null,
      actor: ((req.headers['x-admin-user'] as string | undefined) ?? null) || null,
      ip:
        ((req.ip as string | undefined) ??
          (req.socket?.remoteAddress as string | undefined) ??
          null) || null,
      userAgent: ((req.headers['user-agent'] as string | undefined) ?? null) || null,
      requestBody: prepareBody(req.body),
    };

    const write = (statusCode: number, errorMessage: string | null) => {
      this.repo
        .create({ ...meta, statusCode, durationMs: Date.now() - startedAt, errorMessage })
        .catch((err) => this.logger.error('Failed to write audit log row', err));
    };

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        write(res.statusCode ?? 200, null);
      }),
      catchError((err) => {
        const statusCode = typeof err?.status === 'number' ? err.status : 500;
        const message =
          (typeof err?.message === 'string' ? err.message : String(err)) || 'error';
        write(statusCode, message);
        return throwError(() => err);
      }),
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/audit-log.interceptor.spec.ts`
Expected: all 8 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/audit-log.interceptor.ts test/audit-log.interceptor.spec.ts
git commit -m "feat(admin): add AuditLogInterceptor with redaction, truncation, fire-and-forget writes"
```

---

### Task 7: Wire interceptor + repository into AdminModule and AdminController

**Files:**
- Modify: `src/admin/admin.module.ts`
- Modify: `src/admin/admin.controller.ts`

- [ ] **Step 1: Update `src/admin/admin.module.ts`**

Replace the file with:

```ts
import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { JobsModule } from '../jobs/jobs.module';
import { ClickupModule } from '../clickup/clickup.module';
import { TimeEntriesModule } from '../time-entries/time-entries.module';
import { RatesModule } from '../rates/rates.module';
import { TasksModule } from '../tasks/tasks.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { AdminController } from './admin.controller';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogInterceptor } from './audit-log.interceptor';

@Module({
  imports: [QueuesModule, JobsModule, ClickupModule, TimeEntriesModule, RatesModule, TasksModule, WebhooksModule],
  providers: [AdminApiKeyGuard, AuditLogRepository, AuditLogInterceptor],
  controllers: [AdminController],
  exports: [AuditLogRepository],
})
export class AdminModule {}
```

- [ ] **Step 2: Wire the interceptor + new GET endpoint in `src/admin/admin.controller.ts`**

At the top of the file, add to the existing imports:

```ts
import { UseInterceptors } from '@nestjs/common';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLogRepository } from './audit-log.repository';
```

Update the controller decorators (right above `@Controller('admin')`):

```ts
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@UseGuards(AdminApiKeyGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminController {
```

Add `AuditLogRepository` to the constructor dependency list:

```ts
  constructor(
    private readonly queues: QueueService,
    private readonly deadLetters: DeadLetterRepository,
    private readonly clickup: ClickupClient,
    private readonly webhooks: ClickupWebhooksService,
    private readonly timeEntriesRepo: TimeEntriesRepository,
    private readonly ratesRepo: RatesRepository,
    private readonly tagAssigneeRepo: TagAssigneeMapRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly ratesService: RatesService,
    private readonly webhookEvents: WebhookEventsRepository,
    private readonly webhookParser: WebhookParserService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogRepository,
  ) {}
```

Add a new GET endpoint at the bottom of the controller, just before the closing `}`:

```ts
  // ── Audit log viewer ───────────────────────────────────────────────────────

  @Get('audit-log')
  @ApiOperation({ summary: 'Paginated admin audit log (write actions only).' })
  async listAuditLog(
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
    @Query('actor') actor?: string,
    @Query('routePattern') routePattern?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditLog.findMany({
      actor: actor?.trim() || undefined,
      routePattern: routePattern?.trim() || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });
  }
```

- [ ] **Step 3: Build and run all existing tests**

Run: `npm run build && npm test`
Expected: clean build, no new test failures. (The new GET endpoint is auto-skipped by the interceptor's `WRITE_METHODS` guard.)

- [ ] **Step 4: Integration smoke (manual, optional)**

Boot the app (`npm run start:dev`) and curl:

```bash
curl -X POST http://localhost:3000/api/admin/tasks/sync \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "x-admin-user: smoke-test" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"abc"}'
curl -H "x-admin-key: $ADMIN_API_KEY" "http://localhost:3000/api/admin/audit-log?limit=5"
```

Expected: second call returns `{ items: [{ actor: 'smoke-test', method: 'POST', path: '/admin/tasks/sync', ... }], total: 1 }`.

- [ ] **Step 5: Commit**

```bash
git add src/admin/admin.module.ts src/admin/admin.controller.ts
git commit -m "feat(admin): wire AuditLogInterceptor and GET /admin/audit-log viewer endpoint"
```

---

### Task 8: Frontend — send X-Admin-User header from apiClient

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/LoginPage.tsx`

- [ ] **Step 1: Update `apps/web/src/api/client.ts`**

Replace the file with:

```ts
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const key = localStorage.getItem('adminApiKey') ?? (import.meta.env.VITE_ADMIN_API_KEY as string) ?? '';
  if (key) config.headers['x-admin-key'] = key;
  const userName = localStorage.getItem('adminUserName')?.trim() ?? '';
  if (userName) config.headers['x-admin-user'] = userName;
  return config;
});

apiClient.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('adminApiKey');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
```

- [ ] **Step 2: Add an optional "Your name" field to `apps/web/src/pages/LoginPage.tsx`**

Above the API-key `<div>`, add:

```tsx
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">
              Your name (for audit log) <span className="text-[var(--text-faint)]">— optional</span>
            </label>
            <input
              type="text"
              defaultValue={localStorage.getItem('adminUserName') ?? ''}
              onChange={e => {
                const v = e.target.value.trim();
                if (v) localStorage.setItem('adminUserName', v);
                else localStorage.removeItem('adminUserName');
              }}
              placeholder="e.g. rashedul"
              autoComplete="name"
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
```

(Place between the existing logo block and the API key input.)

- [ ] **Step 3: Build the frontend to verify no TS errors**

```bash
npm run -w apps/web build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/pages/LoginPage.tsx
git commit -m "feat(web): send X-Admin-User header from apiClient; capture optional name at login"
```

---

### Task 9: Frontend — auditLog API client + hook

**Files:**
- Create: `apps/web/src/api/auditLog.ts`
- Create: `apps/web/src/hooks/useAuditLog.ts`

- [ ] **Step 1: Create `apps/web/src/api/auditLog.ts`**

```ts
import { apiClient } from './client';

export interface AuditLogRow {
  id: string;
  occurredAt: string;
  actor: string | null;
  method: string;
  path: string;
  routePattern: string | null;
  statusCode: number;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
  requestBody: unknown;
  errorMessage: string | null;
}

export interface AuditLogListResponse {
  items: AuditLogRow[];
  total: number;
}

export interface AuditLogQuery {
  limit?: number;
  offset?: number;
  actor?: string;
  routePattern?: string;
  from?: string;
  to?: string;
}

export const auditLogApi = {
  list: (query: AuditLogQuery = {}): Promise<AuditLogListResponse> =>
    apiClient
      .get('/admin/audit-log', {
        params: {
          limit: query.limit ?? 50,
          offset: query.offset ?? 0,
          actor: query.actor || undefined,
          routePattern: query.routePattern || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
      })
      .then((r) => r.data),
};
```

- [ ] **Step 2: Create `apps/web/src/hooks/useAuditLog.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { auditLogApi, AuditLogQuery } from '../api/auditLog';

export function useAuditLog(query: AuditLogQuery = {}) {
  return useQuery({
    queryKey: ['audit-log', query],
    queryFn: () => auditLogApi.list(query),
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 3: Verify the frontend still builds**

```bash
npm run -w apps/web build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/auditLog.ts apps/web/src/hooks/useAuditLog.ts
git commit -m "feat(web): add auditLog API client + useAuditLog hook"
```

---

### Task 10: Frontend — AuditLogPage + Drawer

**Files:**
- Create: `apps/web/src/components/AuditLogDrawer.tsx`
- Create: `apps/web/src/pages/AuditLogPage.tsx`

- [ ] **Step 1: Create the drawer**

`apps/web/src/components/AuditLogDrawer.tsx`:

```tsx
import { Drawer } from './ui/Drawer';
import type { AuditLogRow } from '../api/auditLog';
import { fmt } from '../lib/formatters';

export function AuditLogDrawer({ item, onClose }: { item: AuditLogRow | null; onClose: () => void }) {
  if (!item) return null;
  return (
    <Drawer open={!!item} onClose={onClose} title={`${item.method} ${item.path}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
        <Field label="Occurred" value={fmt.dateTime(item.occurredAt)} />
        <Field label="Actor" value={item.actor ?? '— (no X-Admin-User header)'} />
        <Field label="Status" value={String(item.statusCode)} />
        <Field label="Duration" value={item.durationMs != null ? `${item.durationMs} ms` : '—'} />
        <Field label="Route" value={item.routePattern ?? item.path} />
        <Field label="IP" value={item.ip ?? '—'} />
        <Field label="User-Agent" value={item.userAgent ?? '—'} />
        {item.errorMessage && <Field label="Error" value={item.errorMessage} />}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Request body</div>
          <pre style={{
            background: 'var(--muted-bg)', border: '1px solid var(--border)', borderRadius: 6,
            padding: 10, fontSize: 11, lineHeight: 1.5,
            maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>{JSON.stringify(item.requestBody ?? null, null, 2)}</pre>
        </div>
      </div>
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ color: 'var(--text)', marginTop: 2 }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

`apps/web/src/pages/AuditLogPage.tsx`:

```tsx
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuditLog } from '../hooks/useAuditLog';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';
import { QueryError } from '../components/ui/QueryError';
import { Skeleton } from '../components/ui/Skeleton';
import { Input } from '../components/ui/Input';
import { AuditLogDrawer } from '../components/AuditLogDrawer';
import type { AuditLogRow } from '../api/auditLog';
import { fmt } from '../lib/formatters';

function methodTone(m: string): 'green' | 'amber' | 'red' | 'blue' {
  if (m === 'POST') return 'green';
  if (m === 'PATCH' || m === 'PUT') return 'amber';
  if (m === 'DELETE') return 'red';
  return 'blue';
}

function statusTone(code: number): 'green' | 'amber' | 'red' {
  if (code >= 500) return 'red';
  if (code >= 400) return 'amber';
  return 'green';
}

export function AuditLogPage() {
  const [actor, setActor] = useState('');
  const [selected, setSelected] = useState<AuditLogRow | null>(null);
  const query = useAuditLog({ actor: actor || undefined, limit: 100 });
  const items: AuditLogRow[] = query.data?.items ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Audit Log"
        description="Admin actions (POST / PATCH / DELETE on /admin endpoints). Reads are not audited."
      />

      <QueryError query={query} what="audit log" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <ShieldCheck size={14} style={{ color: 'var(--text-muted)' }} />
        <div style={{ flex: 1, maxWidth: 280 }}>
          <Input placeholder="Filter by actor (X-Admin-User)…" value={actor} onChange={(e) => setActor(e.target.value)} />
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {query.data?.total ?? 0} total
        </span>
      </div>

      {query.isLoading ? (
        <Skeleton height={320} />
      ) : (
        <Card padding={0}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--muted-bg)', textTransform: 'uppercase', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', fontWeight: 600 }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', width: 130 }}>When</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Actor</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', width: 80 }}>Method</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Path</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', width: 80 }}>Status</th>
                <th style={{ textAlign: 'right', padding: '10px 16px', width: 90 }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No audit log entries</td></tr>
              ) : (
                items.map((row, i) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    style={{ borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined, cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt.relative(row.occurredAt)}</td>
                    <td style={{ padding: '12px', color: 'var(--text)' }}>{row.actor ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                    <td style={{ padding: '12px' }}><Pill tone={methodTone(row.method)} size="xs">{row.method}</Pill></td>
                    <td style={{ padding: '12px', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text)' }}>{row.path}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}><Pill tone={statusTone(row.statusCode)} size="xs">{row.statusCode}</Pill></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{row.durationMs != null ? `${row.durationMs}ms` : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}

      <AuditLogDrawer item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
```

- [ ] **Step 3: Verify the frontend builds**

```bash
npm run -w apps/web build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AuditLogDrawer.tsx apps/web/src/pages/AuditLogPage.tsx
git commit -m "feat(web): add AuditLogPage with drawer for full request body"
```

---

### Task 11: Frontend — route + Sidebar entry

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add the lazy import + route to `apps/web/src/App.tsx`**

Add to the lazy imports block (right after `SettingsPage`):

```tsx
const AuditLogPage = React.lazy(() =>
  import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
```

Add this route inside the protected `AppLayout` route block (right after the `/sync-logs` route):

```tsx
<Route
  path="/audit-log"
  element={
    <React.Suspense fallback={Fallback}>
      <AuditLogPage />
    </React.Suspense>
  }
/>
```

- [ ] **Step 2: Add the Sidebar nav item**

In `apps/web/src/components/layout/Sidebar.tsx`, update the `lucide-react` import to include `ShieldCheck`:

```ts
import {
  Home, CheckSquare, Clock, AlertTriangle, DollarSign,
  Layers, Webhook, ShieldCheck, Settings, PanelLeft, type LucideIcon,
} from 'lucide-react';
```

Then add an entry to the `navItems` array, immediately after `Sync Logs` and before `Settings`:

```ts
    { to: '/sync-logs',      label: 'Sync Logs',      icon: Webhook },
    { to: '/audit-log',      label: 'Audit Log',      icon: ShieldCheck },
    { to: '/settings',       label: 'Settings',       icon: Settings },
```

- [ ] **Step 3: Verify the frontend builds**

```bash
npm run -w apps/web build
```

Expected: clean. The route now resolves; visiting `/audit-log` renders the page.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(web): route /audit-log and add Sidebar entry"
```

---

# Phase 4 — Status-change history

### Task 12: Extend webhook-parser.service to extract status changes

**Files:**
- Modify: `src/webhooks/webhook-parser.service.ts`
- Create: `test/webhook-parser.service.spec.ts`
- Create: `test/fixtures/clickup-status-update.fixture.json`

- [ ] **Step 1: Create the fixture**

`test/fixtures/clickup-status-update.fixture.json`:

```json
{
  "event": "taskStatusUpdated",
  "task_id": "86abcdef0",
  "history_items": [
    {
      "id": "hist_1",
      "type": 1,
      "date": "1716470400000",
      "field": "status",
      "parent_id": "list_1",
      "data": {},
      "source": null,
      "user": { "id": 12345, "username": "Rashedul Hasan", "email": "r@example.com" },
      "before": { "status": "open",       "color": "#94a3b8", "type": "open"   },
      "after":  { "status": "in progress","color": "#3b82f6", "type": "custom" }
    },
    {
      "id": "hist_2",
      "type": 1,
      "date": "1716470500000",
      "field": "priority",
      "parent_id": "list_1",
      "user": { "id": 12345 },
      "before": { "priority": null },
      "after":  { "priority": "high" }
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Create `test/webhook-parser.service.spec.ts`:

```ts
import * as path from 'path';
import * as fs from 'fs';
import { WebhookParserService } from '../src/webhooks/webhook-parser.service';

const fixturePath = path.join(__dirname, 'fixtures', 'clickup-status-update.fixture.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

describe('WebhookParserService.extractStatusChanges', () => {
  const svc = new WebhookParserService();

  it('emits one record per status history_item, ignoring non-status items', () => {
    const out = svc.extractStatusChanges(fixture);
    expect(out).toHaveLength(1);
    expect(out[0].before).toEqual({ status: 'open', color: '#94a3b8', type: 'open' });
    expect(out[0].after).toEqual({ status: 'in progress', color: '#3b82f6', type: 'custom' });
    expect(out[0].changedByUserId).toBe('12345');
    expect(out[0].changedByUserName).toBe('Rashedul Hasan');
    expect(out[0].occurredAt.getTime()).toBe(1716470400000);
  });

  it('coerces integer user.id to string', () => {
    const out = svc.extractStatusChanges(fixture);
    expect(typeof out[0].changedByUserId).toBe('string');
  });

  it('returns [] when history_items is missing', () => {
    expect(svc.extractStatusChanges({ event: 'taskStatusUpdated' })).toEqual([]);
  });

  it('returns [] when history_items is empty', () => {
    expect(svc.extractStatusChanges({ event: 'taskStatusUpdated', history_items: [] })).toEqual([]);
  });

  it('tolerates before or after missing (initial status assignment)', () => {
    const out = svc.extractStatusChanges({
      event: 'taskStatusUpdated',
      history_items: [{
        date: '1716470400000', field: 'status',
        user: { id: 9 }, before: null, after: { status: 'open' },
      }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].before).toBeNull();
    expect(out[0].after).toEqual({ status: 'open' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- test/webhook-parser.service.spec.ts`
Expected: FAIL with "extractStatusChanges is not a function".

- [ ] **Step 4: Implement `extractStatusChanges`**

Replace `src/webhooks/webhook-parser.service.ts` with:

```ts
import { Injectable } from '@nestjs/common';
import { sha256 } from '../common/utils/hash';

export interface ParsedWebhook { eventType: string | null; taskId: string | null; loggedUserId: string | null; fingerprint: string; payload: unknown; }

export interface StatusChangeRecord {
  occurredAt: Date;
  changedByUserId: string | null;
  changedByUserName: string | null;
  before: unknown;
  after: unknown;
  raw: unknown;
}

@Injectable()
export class WebhookParserService {
  parse(payload: any): ParsedWebhook {
    const body = payload?.body || payload || {};
    const eventType = body.event || payload?.event || null;
    const taskId = body.task_id || payload?.task_id || payload?.data?.task_id || payload?.history_items?.[0]?.task_id || body.history_items?.[0]?.task_id || null;
    const eventId = body.history_items?.[0]?.id || body.event_id || body.id || payload?.history_items?.[0]?.id || payload?.event_id || payload?.id;
    const fingerprint = eventId ? `id:${eventId}` : taskId && eventType ? `event:${eventType}:${taskId}:${body.date || body.timestamp || sha256(payload).slice(0, 12)}` : `hash:${sha256(payload)}`;
    // n8n source-of-truth: the taskTimeTrackedUpdated webhook carries the user who logged
    // the time in history_items[0].user.id — ClickUp's time_entries endpoint needs it as `assignee`.
    const rawLoggedUserId = body.history_items?.[0]?.user?.id ?? payload?.history_items?.[0]?.user?.id ?? null;
    const loggedUserId = rawLoggedUserId != null ? String(rawLoggedUserId) : null;
    return { eventType, taskId, loggedUserId, fingerprint, payload };
  }

  extractStatusChanges(payload: any): StatusChangeRecord[] {
    const body = payload?.body ?? payload ?? {};
    const items: any[] = Array.isArray(body.history_items) ? body.history_items : [];
    const out: StatusChangeRecord[] = [];
    for (const item of items) {
      if (!item || item.field !== 'status') continue;
      const rawDate = item.date;
      const occurredAt = new Date(typeof rawDate === 'string' ? Number(rawDate) : rawDate);
      if (Number.isNaN(occurredAt.getTime())) continue;
      const userId = item.user?.id ?? null;
      out.push({
        occurredAt,
        changedByUserId: userId != null ? String(userId) : null,
        changedByUserName: item.user?.username ?? null,
        before: item.before ?? null,
        after: item.after ?? null,
        raw: item,
      });
    }
    return out;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/webhook-parser.service.spec.ts`
Expected: all 5 cases PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webhooks/webhook-parser.service.ts test/webhook-parser.service.spec.ts test/fixtures/clickup-status-update.fixture.json
git commit -m "feat(webhooks): extractStatusChanges() parser for taskStatusUpdated history_items"
```

---

### Task 13: Persist status changes in the webhook event processor

**Files:**
- Modify: `src/workers/clickup-event.processor.ts`
- Create: `test/clickup-event.processor.spec.ts`
- Modify: `src/workers/workers.module.ts` (only if WebhookParserService/PrismaService aren't already imported there — verify and adjust)

- [ ] **Step 1: Write the failing tests**

Create `test/clickup-event.processor.spec.ts`:

```ts
import { ClickupEventProcessor } from '../src/workers/clickup-event.processor';

function makeQueues() {
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  return {
    get: jest.fn().mockReturnValue(queue),
    defaultJobOptions: jest.fn().mockReturnValue({}),
    _queue: queue,
  } as any;
}

function makeEvents() {
  return { markProcessed: jest.fn().mockResolvedValue(undefined) } as any;
}

function makePrisma() {
  return {
    clickupTaskEvent: { upsert: jest.fn().mockResolvedValue(undefined) },
  } as any;
}

function makeParser(records: any[] = []) {
  return { extractStatusChanges: jest.fn().mockReturnValue(records) } as any;
}

describe('ClickupEventProcessor — taskStatusUpdated', () => {
  it('upserts one row per status change with deterministic fingerprint', async () => {
    const prisma = makePrisma();
    const parser = makeParser([
      {
        occurredAt: new Date(1716470400000),
        changedByUserId: '12345',
        changedByUserName: 'Rashedul',
        before: { status: 'open' },
        after: { status: 'in progress' },
        raw: { id: 'hist_1' },
      },
    ]);
    const proc = new ClickupEventProcessor(makeQueues(), makeEvents(), parser, prisma);
    await proc.process({
      data: { eventType: 'taskStatusUpdated', taskId: '86abcdef0', fingerprint: 'id:hist_1', loggedUserId: null, payload: { history_items: [{ field: 'status' }] } },
    } as any);
    expect(prisma.clickupTaskEvent.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.clickupTaskEvent.upsert.mock.calls[0][0];
    expect(call.where.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(call.create.taskId).toBe('86abcdef0');
    expect(call.create.eventType).toBe('taskStatusUpdated');
    expect(call.create.before).toEqual({ status: 'open' });
    expect(call.create.after).toEqual({ status: 'in progress' });
    expect(call.update).toEqual({});
  });

  it('survives a parser/upsert error on one item and continues with the rest', async () => {
    const prisma = makePrisma();
    prisma.clickupTaskEvent.upsert
      .mockRejectedValueOnce(new Error('one fails'))
      .mockResolvedValueOnce(undefined);
    const parser = makeParser([
      { occurredAt: new Date(1), changedByUserId: null, changedByUserName: null, before: {}, after: {}, raw: {} },
      { occurredAt: new Date(2), changedByUserId: null, changedByUserName: null, before: {}, after: {}, raw: {} },
    ]);
    const proc = new ClickupEventProcessor(makeQueues(), makeEvents(), parser, prisma);
    await proc.process({
      data: { eventType: 'taskStatusUpdated', taskId: 't1', fingerprint: 'fp', loggedUserId: null, payload: {} },
    } as any);
    expect(prisma.clickupTaskEvent.upsert).toHaveBeenCalledTimes(2);
  });

  it('does not enqueue a task sync for taskStatusUpdated (separate concern)', async () => {
    const queues = makeQueues();
    const proc = new ClickupEventProcessor(queues, makeEvents(), makeParser([]), makePrisma());
    await proc.process({
      data: { eventType: 'taskStatusUpdated', taskId: 't1', fingerprint: 'fp', loggedUserId: null, payload: {} },
    } as any);
    expect(queues._queue.add).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/clickup-event.processor.spec.ts`
Expected: FAIL — current processor has 3 constructor args; the tests pass 4 (queues, events, parser, prisma).

- [ ] **Step 3: Update the processor**

Replace `src/workers/clickup-event.processor.ts` with:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import * as crypto from 'crypto';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { WebhookEventsRepository } from '../webhooks/webhook-events.repository';
import { WebhookParserService } from '../webhooks/webhook-parser.service';
import { PrismaService } from '../database/prisma.service';

@Injectable()
@Processor(QUEUES.CLICKUP_WEBHOOKS)
export class ClickupEventProcessor extends WorkerHost {
  private readonly logger = new Logger(ClickupEventProcessor.name);
  constructor(
    private readonly queues: QueueService,
    private readonly events: WebhookEventsRepository,
    private readonly parser: WebhookParserService,
    private readonly prisma: PrismaService,
  ) { super(); }

  async process(job: Job<any>) {
    const { eventType, taskId, fingerprint, loggedUserId, payload } = job.data;

    if (eventType === 'taskStatusUpdated') {
      await this.persistStatusChanges(taskId, payload);
      await this.events.markProcessed(fingerprint).catch((e) => this.logger.warn(e.message));
      return;
    }

    if (!taskId && eventType !== 'taskDeleted') return;
    if (eventType === 'taskDeleted') {
      await this.queues.get(QUEUES.CLICKUP_TASKS).add(JOBS.DELETE_CLICKUP_TASK, { taskId }, this.queues.defaultJobOptions());
    } else if (eventType === 'taskTimeTrackedUpdated') {
      await this.queues.get(QUEUES.CLICKUP_TASKS).add(JOBS.SYNC_CLICKUP_TASK, { taskId }, this.queues.defaultJobOptions());
      await this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES).add(JOBS.SYNC_TASK_TIME_ENTRIES, { taskId, assigneeIds: loggedUserId ? [loggedUserId] : undefined }, this.queues.defaultJobOptions());
    } else {
      await this.queues.get(QUEUES.CLICKUP_TASKS).add(JOBS.SYNC_CLICKUP_TASK, { taskId }, this.queues.defaultJobOptions());
    }
    await this.events.markProcessed(fingerprint).catch((e) => this.logger.warn(e.message));
  }

  private async persistStatusChanges(taskId: string | null, payload: unknown) {
    if (!taskId) return;
    const records = this.parser.extractStatusChanges(payload);
    for (const r of records) {
      const fp = crypto
        .createHash('sha256')
        .update([
          taskId,
          'taskStatusUpdated',
          r.occurredAt.toISOString(),
          JSON.stringify(r.before),
          JSON.stringify(r.after),
        ].join('|'))
        .digest('hex');
      try {
        await this.prisma.clickupTaskEvent.upsert({
          where: { fingerprint: fp },
          create: {
            taskId,
            eventType: 'taskStatusUpdated',
            occurredAt: r.occurredAt,
            changedByUserId: r.changedByUserId,
            changedByUserName: r.changedByUserName,
            before: r.before as any,
            after: r.after as any,
            fingerprint: fp,
            raw: r.raw as any,
          },
          update: {},
        });
      } catch (err) {
        this.logger.error(`Failed to persist task event for ${taskId}`, err as Error);
      }
    }
  }
}
```

- [ ] **Step 4: Verify the processor module already provides PrismaService + WebhookParserService**

```bash
grep -l "PrismaService\|WebhookParserService" src/workers/workers.module.ts
```

If either is not already imported there (the DatabaseModule + WebhooksModule may already cover both), open `src/workers/workers.module.ts` and add the missing imports to its `imports` array. Then:

```bash
npm run build
```

Expected: clean build. Resolve any DI error by adding the missing module to `workers.module.ts` imports.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: no regressions; new processor tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workers/clickup-event.processor.ts test/clickup-event.processor.spec.ts src/workers/workers.module.ts
git commit -m "feat(workers): persist taskStatusUpdated history_items into clickup_task_events"
```

---

### Task 14: Add cycleTime() and timeInStatus() to ReportsService

**Files:**
- Modify: `src/reports/reports.service.ts`
- Modify: `test/reports.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/reports.service.spec.ts`, inside the top-level `describe('ReportsService', …)`:

```ts
  describe('cycleTime', () => {
    it('maps weekly raw rows to { bucket, meanHours, medianHours, p90Hours, taskCount, meta.minOccurredAt }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        // items
        .mockResolvedValueOnce([
          { bucket: '2026-05-04', mean_hours: 25.5, median_hours: 22.0, p90_hours: 48.0, task_count: BigInt(4) },
        ])
        // meta
        .mockResolvedValueOnce([{ min_occurred_at: new Date('2026-04-10T10:00:00Z') }]);
      const result = await new ReportsService(prisma).cycleTime({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'), groupBy: 'week',
      });
      expect(result.items[0]).toEqual({
        bucket: '2026-05-04', meanHours: 25.5, medianHours: 22.0, p90Hours: 48.0, taskCount: 4,
      });
      expect(result.meta.minOccurredAt).toBe('2026-04-10T10:00:00.000Z');
    });

    it('returns empty items + null meta when no events exist', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ min_occurred_at: null }]);
      const result = await new ReportsService(prisma).cycleTime({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'), groupBy: 'week',
      });
      expect(result.items).toEqual([]);
      expect(result.meta.minOccurredAt).toBeNull();
    });
  });

  describe('timeInStatus', () => {
    it('maps rows to { status, color, totalHours, taskCount }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { status: 'in progress', color: '#3b82f6', total_hours: 124.5, task_count: BigInt(12) },
        ])
        .mockResolvedValueOnce([{ min_occurred_at: new Date('2026-04-10T10:00:00Z') }]);
      const result = await new ReportsService(prisma).timeInStatus({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'),
      });
      expect(result.items[0]).toEqual({
        status: 'in progress', color: '#3b82f6', totalHours: 124.5, taskCount: 12,
      });
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/reports.service.spec.ts`
Expected: new cases FAIL with "cycleTime is not a function".

- [ ] **Step 3: Implement the methods**

Append to `src/reports/reports.service.ts`, inside the `ReportsService` class:

```ts
  /**
   * Cycle time = hours between the first event whose after.type === 'open' and
   * the last event whose after.type === 'done', per task. Tasks that "bounce"
   * (done → in-progress → done) use first-open to last-done, i.e. end-to-end
   * calendar time. Window filters by the task's *last done* occurredAt.
   */
  async cycleTime(args: { from: Date; to: Date; groupBy: 'week' | 'client' | 'department' }) {
    const { from, to, groupBy } = args;
    const bucketExpr =
      groupBy === 'week'
        ? Prisma.sql`to_char(date_trunc('week', last_done + interval '1 day') - interval '1 day', 'YYYY-MM-DD')`
        : groupBy === 'client'
          ? Prisma.sql`COALESCE(NULLIF(t.client, ''), 'Unattributed')`
          : Prisma.sql`COALESCE(NULLIF(t.department, ''), 'Unattributed')`;

    type Row = { bucket: string; mean_hours: number; median_hours: number; p90_hours: number; task_count: bigint };
    type MetaRow = { min_occurred_at: Date | null };

    const [items, metaRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>(Prisma.sql`
        WITH task_endpoints AS (
          SELECT
            e.task_id,
            MIN(e.occurred_at) FILTER (WHERE (e.after->>'type') = 'open') AS first_open,
            MAX(e.occurred_at) FILTER (WHERE (e.after->>'type') = 'done') AS last_done
          FROM clickup_task_events e
          WHERE e.event_type = 'taskStatusUpdated'
          GROUP BY e.task_id
        )
        SELECT
          ${bucketExpr} AS bucket,
          AVG(EXTRACT(EPOCH FROM (last_done - first_open)) / 3600.0)::float        AS mean_hours,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (last_done - first_open)) / 3600.0
          )::float                                                                  AS median_hours,
          percentile_cont(0.9) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (last_done - first_open)) / 3600.0
          )::float                                                                  AS p90_hours,
          COUNT(*)::bigint                                                          AS task_count
        FROM task_endpoints te
        LEFT JOIN clickup_tasks t ON t.task_id = te.task_id
        WHERE first_open IS NOT NULL
          AND last_done IS NOT NULL
          AND last_done >= ${from}
          AND last_done <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      this.prisma.$queryRaw<MetaRow[]>(Prisma.sql`
        SELECT MIN(occurred_at) AS min_occurred_at
        FROM clickup_task_events
        WHERE event_type = 'taskStatusUpdated'
      `),
    ]);

    return {
      items: items.map((r) => ({
        bucket: r.bucket,
        meanHours: Number(r.mean_hours ?? 0),
        medianHours: Number(r.median_hours ?? 0),
        p90Hours: Number(r.p90_hours ?? 0),
        taskCount: Number(r.task_count ?? 0n),
      })),
      meta: {
        minOccurredAt: metaRows[0]?.min_occurred_at ? metaRows[0].min_occurred_at.toISOString() : null,
      },
    };
  }

  /**
   * Time-in-status: for each task, walk events in order; for each consecutive
   * pair, attribute (next - prev) hours to prev.after.status. The currently-
   * active status (last event without a successor) attributes hours up to `to`.
   * Bar by status with its captured `color`.
   */
  async timeInStatus(args: { from: Date; to: Date }) {
    const { from, to } = args;
    type Row = { status: string; color: string | null; total_hours: number; task_count: bigint };
    type MetaRow = { min_occurred_at: Date | null };

    const [items, metaRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>(Prisma.sql`
        WITH ordered AS (
          SELECT
            e.task_id,
            e.occurred_at,
            e.after,
            LEAD(e.occurred_at) OVER (PARTITION BY e.task_id ORDER BY e.occurred_at) AS next_at
          FROM clickup_task_events e
          WHERE e.event_type = 'taskStatusUpdated'
            AND e.occurred_at <= ${to}
        ),
        intervals AS (
          SELECT
            (after->>'status')                                                AS status,
            (after->>'color')                                                 AS color,
            task_id,
            GREATEST(occurred_at, ${from})                                    AS interval_start,
            LEAST(COALESCE(next_at, ${to}), ${to})                            AS interval_end
          FROM ordered
          WHERE occurred_at <= ${to}
            AND COALESCE(next_at, ${to}) >= ${from}
        )
        SELECT
          status,
          MAX(color)                                                          AS color,
          SUM(EXTRACT(EPOCH FROM (interval_end - interval_start)) / 3600.0)::float AS total_hours,
          COUNT(DISTINCT task_id)::bigint                                     AS task_count
        FROM intervals
        WHERE interval_end > interval_start
          AND status IS NOT NULL
        GROUP BY status
        ORDER BY total_hours DESC
      `),
      this.prisma.$queryRaw<MetaRow[]>(Prisma.sql`
        SELECT MIN(occurred_at) AS min_occurred_at
        FROM clickup_task_events
        WHERE event_type = 'taskStatusUpdated'
      `),
    ]);

    return {
      items: items.map((r) => ({
        status: r.status,
        color: r.color,
        totalHours: Number(r.total_hours ?? 0),
        taskCount: Number(r.task_count ?? 0n),
      })),
      meta: {
        minOccurredAt: metaRows[0]?.min_occurred_at ? metaRows[0].min_occurred_at.toISOString() : null,
      },
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/reports.service.spec.ts`
Expected: new cases PASS; existing cases still pass.

- [ ] **Step 5: Commit**

```bash
git add src/reports/reports.service.ts test/reports.service.spec.ts
git commit -m "feat(reports): cycleTime() and timeInStatus() over clickup_task_events"
```

---

### Task 15: Expose /reports/cycle-time and /reports/time-in-status

**Files:**
- Modify: `src/reports/reports.controller.ts`

- [ ] **Step 1: Add the two endpoints**

In `src/reports/reports.controller.ts`, append before the closing `}` of the class:

```ts
  @Get('cycle-time')
  @ApiOperation({ summary: 'Cycle-time aggregates (first open → last done) bucketed by week, client, or department.' })
  cycleTime(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    const groupByVal = groupBy === 'client' || groupBy === 'department' ? groupBy : 'week';
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 86400000);
    const toDate = to ? new Date(to) : new Date();
    return this.reports.cycleTime({ from: fromDate, to: toDate, groupBy: groupByVal });
  }

  @Get('time-in-status')
  @ApiOperation({ summary: 'Total hours each task spent in each status, over the window.' })
  timeInStatus(@Query('from') from?: string, @Query('to') to?: string) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 86400000);
    const toDate = to ? new Date(to) : new Date();
    return this.reports.timeInStatus({ from: fromDate, to: toDate });
  }
```

- [ ] **Step 2: Build to confirm compilation**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional)**

Boot the app (`npm run start:dev`) and curl:

```bash
curl -H "x-admin-key: $ADMIN_API_KEY" "http://localhost:3000/api/reports/cycle-time?groupBy=week" | jq .
curl -H "x-admin-key: $ADMIN_API_KEY" "http://localhost:3000/api/reports/time-in-status" | jq .
```

Expected (empty DB): both return `{ items: [], meta: { minOccurredAt: null } }`.

- [ ] **Step 4: Commit**

```bash
git add src/reports/reports.controller.ts
git commit -m "feat(reports): expose GET /reports/cycle-time and /reports/time-in-status"
```

---

### Task 16: Frontend — reports API + hooks for cycle-time / time-in-status

**Files:**
- Modify: `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/hooks/useReports.ts`

- [ ] **Step 1: Extend `apps/web/src/api/reports.ts`**

Append the following to `reports.ts` (after the existing exports):

```ts
export interface CycleTimeItem { bucket: string; meanHours: number; medianHours: number; p90Hours: number; taskCount: number; }
export interface TimeInStatusItem { status: string; color: string | null; totalHours: number; taskCount: number; }
export interface ReportMeta { minOccurredAt: string | null; }

export const cycleTimeApi = {
  cycleTime: (params: { from?: string; to?: string; groupBy?: 'week' | 'client' | 'department' } = {}): Promise<{ items: CycleTimeItem[]; meta: ReportMeta }> =>
    apiClient.get('/reports/cycle-time', { params }).then(r => r.data),
  timeInStatus: (params: { from?: string; to?: string } = {}): Promise<{ items: TimeInStatusItem[]; meta: ReportMeta }> =>
    apiClient.get('/reports/time-in-status', { params }).then(r => r.data),
};
```

(If `reports.ts` doesn't already `import { apiClient } from './client';`, add that.)

- [ ] **Step 2: Add hooks to `apps/web/src/hooks/useReports.ts`**

Append:

```ts
import { cycleTimeApi } from '../api/reports';

export function useCycleTime(params: { from?: string; to?: string; groupBy?: 'week' | 'client' | 'department' } = {}) {
  return useQuery({
    queryKey: ['cycle-time', params],
    queryFn: () => cycleTimeApi.cycleTime(params),
    refetchInterval: 60_000,
  });
}

export function useTimeInStatus(params: { from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: ['time-in-status', params],
    queryFn: () => cycleTimeApi.timeInStatus(params),
    refetchInterval: 60_000,
  });
}
```

(If `useQuery` is not already imported at the top of `useReports.ts`, add `import { useQuery } from '@tanstack/react-query';`.)

- [ ] **Step 3: Verify the frontend builds**

```bash
npm run -w apps/web build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts
git commit -m "feat(web): add cycleTime + timeInStatus API client and hooks"
```

---

### Task 17: Frontend — CycleTimeCard component + drop into OverviewPage

**Files:**
- Create: `apps/web/src/components/charts/CycleTimeCard.tsx`
- Modify: `apps/web/src/pages/OverviewPage.tsx`

- [ ] **Step 1: Create the card**

`apps/web/src/components/charts/CycleTimeCard.tsx`:

```tsx
import { useState } from 'react';
import { useCycleTime, useTimeInStatus } from '../../hooks/useReports';
import { Card } from '../ui/Card';
import { Tabs } from '../ui/Tabs';
import { BarChart } from './BarChart';
import { LineChart } from './LineChart';
import { fmt } from '../../lib/formatters';

export function CycleTimeCard() {
  const [tab, setTab] = useState('cycle');
  const cycleQ = useCycleTime({ groupBy: 'week' });
  const tisQ = useTimeInStatus({});

  const minOccurredAt = cycleQ.data?.meta.minOccurredAt ?? tisQ.data?.meta.minOccurredAt ?? null;
  const sinceLabel = minOccurredAt
    ? `Data captured from ${new Date(minOccurredAt).toISOString().slice(0, 10)} onward — older tasks excluded.`
    : `No status events yet — data will appear as ClickUp status changes flow in.`;

  const cycleItems = cycleQ.data?.items ?? [];
  const tisItems = tisQ.data?.items ?? [];

  const lineData = cycleItems.map((r) => ({ label: r.bucket, value: r.meanHours }));
  const barData = tisItems.slice(0, 8).map((r) => ({
    label: r.status,
    value: r.totalHours,
    color: r.color ?? '#94a3b8',
  }));

  return (
    <Card
      title="Cycle time & time in status"
      subtitle={sinceLabel}
      padding={16}
      action={<Tabs items={[{ value: 'cycle', label: 'Cycle time' }, { value: 'inStatus', label: 'Time in status' }]} value={tab} onChange={setTab} variant="pills" />}
    >
      {tab === 'cycle' ? (
        lineData.length === 0 ? (
          <EmptyState text="No completed tasks in this window." />
        ) : (
          <LineChart data={lineData} formatValue={(v) => fmt.hours(v)} />
        )
      ) : barData.length === 0 ? (
        <EmptyState text="No status time recorded in this window." />
      ) : (
        <BarChart data={barData} direction="horizontal" formatValue={(v) => fmt.hours(v)} />
      )}
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      {text}
    </div>
  );
}
```

If `LineChart` or `Tabs` props (especially `variant: 'pills'`) differ in this codebase, check their type signatures and adjust the props you pass — keep the data wiring above unchanged.

- [ ] **Step 2: Drop into OverviewPage**

In `apps/web/src/pages/OverviewPage.tsx`, add the import alongside the other chart imports:

```tsx
import { CycleTimeCard } from '../components/charts/CycleTimeCard';
```

Place `<CycleTimeCard />` as a new row immediately after the existing `<CostTrendCard />` line (around line 357):

```tsx
      {/* Cost trend */}
      <CostTrendCard />

      {/* Cycle time */}
      <CycleTimeCard />
```

- [ ] **Step 3: Verify the frontend builds**

```bash
npm run -w apps/web build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/charts/CycleTimeCard.tsx apps/web/src/pages/OverviewPage.tsx
git commit -m "feat(web): CycleTimeCard on Overview page with empty-state copy driven by min occurredAt"
```

---

# Phase 5 — Cleanup

### Task 18: Manual verification

- [ ] **Step 1: Start the dev stack**

```bash
npm run dev:deps
npm run start:dev
npm run -w apps/web dev
```

- [ ] **Step 2: Verify audit log captures a real action**

1. Open `/login`, enter your name (e.g. `rashedul`) and the admin key.
2. Open `/spaces`, click "Run backfill" on any space.
3. Open `/audit-log`. There should be a row: actor=rashedul, method=POST, path=/admin/backfill, status=200.
4. Click the row; the drawer shows the request body (with `lookbackDays`, no secrets present).

- [ ] **Step 3: Verify hardening hard-fails when expected**

In a separate shell:

```bash
NODE_ENV=production ADMIN_API_KEY= CLICKUP_WEBHOOK_SECRET= node -e "require('./dist/src/config/env.validation').validateEnv(process.env)"
```

Expected: throws with messages naming `CLICKUP_WEBHOOK_SECRET` and `ADMIN_API_KEY`. (Run after `npm run build`.)

- [ ] **Step 4: Verify status-change capture**

1. In ClickUp UI, change the status of any task in a synced Space.
2. Wait ~10 seconds.
3. Run: `psql "$DATABASE_URL" -c "SELECT task_id, occurred_at, before->>'status' AS from_, after->>'status' AS to_ FROM clickup_task_events ORDER BY occurred_at DESC LIMIT 5"`
   Expected: a row matching your status change.
4. Refresh `/overview` in the browser. The "Cycle time & time in status" card renders with the empty-state copy on the cycle tab (no completed tasks yet) and at least the new status on the "Time in status" tab.

- [ ] **Step 5: No commit (manual step only)**

---

### Task 19: Update CLAUDE.md known-limitations section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Open `CLAUDE.md` and replace the entire `## Known starter limitations` section**

Replace the section's content with:

```markdown
## Known starter limitations

This service is internal-only and intentionally narrow in scope. Items still expected next:

- Per-user authentication (login, sessions, password hashing). Today admins share one `ADMIN_API_KEY`; the audit log binds attribution to an advisory `X-Admin-User` header, not a gated identity.
- Audit gap alerts (banner when admin actions arrive without `X-Admin-User`, or when audit writes start failing).
- v2 status-change event types: `taskMoved`, `taskAssigneeUpdated`, `taskPriorityUpdated`. v1 captures only `taskStatusUpdated` into `clickup_task_events`.
- Cycle-time drill-downs by client and department (backend accepts `groupBy=client|department`; UI surface is single bucket).
- "Resolve / won't-fix" path for dead-letter jobs (today you can only retry).
- Currency rename (the `*Aud` field names and the `currency` columns hold USD in practice — see the `currency-aud-usd-debt` memory).

Already in place (do not re-implement):
- Webhook signature verification (`src/webhooks/webhook-signature.guard.ts`, HMAC-SHA256, hard-required in prod)
- Admin API key gate (`src/admin/admin-api-key.guard.ts`, hard-required in prod)
- Manual admin endpoints (sync task, backfill, replacement backfill, retry-failed-webhooks, dead-letter list/retry, rates CRUD, tag-mapping CRUD, recalc, register webhook, live backfill progress — all in `src/admin/admin.controller.ts`)
- Dead-letter storage + inspector (`DeadLetterJob` + `DeadLetterRepository` + admin endpoints)
- Time-entry replacement with audit (`TimeEntryReplacement` model + `AssigneeReplacementService`; audit row written before original delete; `originalEntryId @unique` for idempotency)
- Admin audit log (`AdminAuditLog` model + `AuditLogInterceptor` on `AdminController`, write actions only)
- Status-change history capture (`clickup_task_events`, subscribed to `taskStatusUpdated`)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: refresh CLAUDE.md known-limitations to reflect current state"
```

---

## Done

After Task 19, all four pieces ship:
- ✅ Hardening: `NODE_ENV=production` requires secrets at boot; guards refuse requests if somehow bypassed
- ✅ Admin audit log: `POST/PATCH/DELETE` to `/admin/*` written to `admin_audit_log`, viewable at `/audit-log`
- ✅ Status-change history: `taskStatusUpdated` events captured to `clickup_task_events`; reports at `/reports/cycle-time` and `/reports/time-in-status`; rendered on Overview
- ✅ CLAUDE.md no longer misleads about what's built
