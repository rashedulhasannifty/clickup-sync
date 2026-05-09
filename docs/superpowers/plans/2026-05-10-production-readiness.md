# Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add webhook signature verification, admin manual-trigger endpoints, ClickUp webhook registration, and dead-letter retry — everything needed before cutting over from n8n.

**Architecture:** `WebhookSignatureGuard` protects the webhook endpoint; `AdminApiKeyGuard` protects all `/admin` routes; a new `AdminModule` (with its own controller) delegates queue enqueuing to `QueueService`, webhook registration to a new `ClickupWebhooksService`, and dead-letter ops to an extended `DeadLetterRepository`.

**Tech Stack:** NestJS 11, BullMQ, Prisma 7, Node `crypto` (built-in), `class-validator`, `@nestjs/swagger`

---

## File Map

| File | Action |
|---|---|
| `src/config/env.validation.ts` | Modify — add `ADMIN_API_KEY` |
| `.env.example` | Modify — document `ADMIN_API_KEY` |
| `src/main.ts` | Modify — add `rawBody: true` |
| `src/clickup/clickup.types.ts` | Modify — extend `ClickUpWebhook` with `health`, `secret` |
| `src/clickup/clickup.client.ts` | Modify — fix `createWebhook` to return `{ id, secret }` |
| `src/webhooks/webhook-signature.guard.ts` | Create |
| `src/webhooks/webhooks.module.ts` | Modify — add guard as provider |
| `src/webhooks/clickup-webhook.controller.ts` | Modify — apply `@UseGuards(WebhookSignatureGuard)` |
| `src/clickup/clickup-webhooks.service.ts` | Create |
| `src/clickup/clickup.module.ts` | Modify — add + export `ClickupWebhooksService` |
| `src/jobs/dead-letter.repository.ts` | Modify — add `findPending`, `findById`, `markRetried` |
| `src/admin/admin-api-key.guard.ts` | Create |
| `src/admin/dto/sync-task.dto.ts` | Create |
| `src/admin/dto/backfill.dto.ts` | Create |
| `src/admin/admin.controller.ts` | Create |
| `src/admin/admin.module.ts` | Create |
| `src/app.module.ts` | Modify — register `AdminModule` |

---

## Task 1: Env config + raw body

**Files:**
- Modify: `src/config/env.validation.ts`
- Modify: `.env.example`
- Modify: `src/main.ts`
- Test: `test/env.validation.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/env.validation.spec.ts
import { validateEnv } from '../src/config/env.validation';

describe('validateEnv', () => {
  const base = { DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x', CLICKUP_API_TOKEN: 'pk_test' };

  it('accepts ADMIN_API_KEY when provided', () => {
    const result = validateEnv({ ...base, ADMIN_API_KEY: 'my-key' });
    expect(result.ADMIN_API_KEY).toBe('my-key');
  });

  it('defaults ADMIN_API_KEY to empty string when omitted', () => {
    const result = validateEnv({ ...base });
    expect(result.ADMIN_API_KEY).toBe('');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest test/env.validation.spec.ts --no-coverage
```

Expected: FAIL — `result.ADMIN_API_KEY` is undefined

- [ ] **Step 3: Add `ADMIN_API_KEY` to env schema**

In `src/config/env.validation.ts`, add one line inside the `z.object({...})` after `GOOGLE_ASSIGNEE_SHEET_NAME`:

```typescript
ADMIN_API_KEY: z.string().optional().default(''),
```

- [ ] **Step 4: Add `rawBody: true` to main.ts**

Change line 10 in `src/main.ts` from:
```typescript
const app = await NestFactory.create(AppModule, { bufferLogs: true });
```
to:
```typescript
const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
```

- [ ] **Step 5: Document in `.env.example`**

Append to `.env.example`:
```env

# Admin endpoints key — set a strong random string before deploying
ADMIN_API_KEY=your-secret-admin-key
```

- [ ] **Step 6: Run test to confirm it passes**

```bash
npx jest test/env.validation.spec.ts --no-coverage
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config/env.validation.ts src/main.ts .env.example test/env.validation.spec.ts
git commit -m "feat: add ADMIN_API_KEY env var and rawBody support"
```

---

## Task 2: Fix ClickUp types and `createWebhook` return value

**Files:**
- Modify: `src/clickup/clickup.types.ts`
- Modify: `src/clickup/clickup.client.ts`

`createWebhook` currently returns `void` — the ClickUp API actually returns `{ id, webhook: { secret, ... } }`. The webhook registration service needs the secret.

- [ ] **Step 1: Extend `ClickUpWebhook` type**

In `src/clickup/clickup.types.ts`, replace the last line:
```typescript
export interface ClickUpWebhook { id: string; endpoint?: string; events?: string[] }
```
with:
```typescript
export interface ClickUpWebhook {
  id: string;
  endpoint?: string;
  events?: string[];
  health?: { status: string; fail_count: number };
  secret?: string;
}
```

- [ ] **Step 2: Fix `createWebhook` signature and return**

In `src/clickup/clickup.client.ts`, replace the `createWebhook` line:
```typescript
async createWebhook(teamId: string, endpoint: string, events: string[]): Promise<void> { await this.request('POST', `/team/${teamId}/webhook`, { endpoint, events }); }
```
with:
```typescript
async createWebhook(teamId: string, endpoint: string, events: string[]): Promise<{ id: string; secret: string }> {
  const res: any = await this.request('POST', `/team/${teamId}/webhook`, { endpoint, events });
  return { id: res.webhook?.id ?? res.id, secret: res.webhook?.secret ?? res.secret ?? '' };
}
```

- [ ] **Step 3: Run build to confirm no type errors**

```bash
npm run build 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/clickup/clickup.types.ts src/clickup/clickup.client.ts
git commit -m "fix: createWebhook returns id and secret, extend ClickUpWebhook type"
```

---

## Task 3: Webhook Signature Guard

**Files:**
- Create: `src/webhooks/webhook-signature.guard.ts`
- Modify: `src/webhooks/webhooks.module.ts`
- Modify: `src/webhooks/clickup-webhook.controller.ts`
- Test: `test/webhook-signature.guard.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/webhook-signature.guard.spec.ts
import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { WebhookSignatureGuard } from '../src/webhooks/webhook-signature.guard';

describe('WebhookSignatureGuard', () => {
  const SECRET = 'test-secret-key';
  const body = Buffer.from('{"event":"taskCreated","task_id":"abc"}');

  function makeGuard(secret: string) {
    return new WebhookSignatureGuard({ get: (_k: string, def: string) => secret || def } as any);
  }

  function makeCtx(rawBody: Buffer | undefined, signature: string | undefined) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-signature': signature }, rawBody }) }),
    } as any;
  }

  it('passes with correct HMAC-SHA256 signature', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(makeGuard(SECRET).canActivate(makeCtx(body, sig))).toBe(true);
  });

  it('throws UnauthorizedException when signature header is missing', () => {
    expect(() => makeGuard(SECRET).canActivate(makeCtx(body, undefined))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when signature is wrong', () => {
    expect(() => makeGuard(SECRET).canActivate(makeCtx(body, 'badsig'))).toThrow(UnauthorizedException);
  });

  it('passes and warns when CLICKUP_WEBHOOK_SECRET is empty (dev mode)', () => {
    expect(makeGuard('').canActivate(makeCtx(undefined, undefined))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest test/webhook-signature.guard.spec.ts --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `webhook-signature.guard.ts`**

```typescript
// src/webhooks/webhook-signature.guard.ts
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx jest test/webhook-signature.guard.spec.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Register guard in `webhooks.module.ts`**

Replace the contents of `src/webhooks/webhooks.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { WebhookParserService } from './webhook-parser.service';
import { WebhookEventsRepository } from './webhook-events.repository';
import { ClickupWebhookController } from './clickup-webhook.controller';
import { WebhookSignatureGuard } from './webhook-signature.guard';

@Module({
  imports: [QueuesModule],
  providers: [WebhookParserService, WebhookEventsRepository, WebhookSignatureGuard],
  controllers: [ClickupWebhookController],
  exports: [WebhookParserService, WebhookEventsRepository],
})
export class WebhooksModule {}
```

- [ ] **Step 6: Apply guard to `ClickupWebhookController`**

Replace `src/webhooks/clickup-webhook.controller.ts`:
```typescript
import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { WebhookParserService } from './webhook-parser.service';
import { WebhookEventsRepository } from './webhook-events.repository';
import { WebhookSignatureGuard } from './webhook-signature.guard';

@ApiTags('webhooks')
@Controller('webhooks')
@UseGuards(WebhookSignatureGuard)
export class ClickupWebhookController {
  private readonly logger = new Logger(ClickupWebhookController.name);
  constructor(
    private readonly parser: WebhookParserService,
    private readonly repo: WebhookEventsRepository,
    private readonly queues: QueueService,
  ) {}

  @Post('clickup')
  @HttpCode(200)
  async receive(@Body() payload: unknown) {
    const parsed = this.parser.parse(payload);
    const saved = await this.repo.saveReceived(parsed);
    if (saved.duplicate) return { success: true, duplicate: true };
    await this.queues.get(QUEUES.CLICKUP_WEBHOOKS).add(JOBS.PROCESS_CLICKUP_EVENT, parsed, this.queues.defaultJobOptions());
    this.logger.log(`Queued ClickUp webhook ${parsed.eventType || 'unknown'} ${parsed.taskId || ''}`);
    return { success: true, queued: true };
  }
}
```

- [ ] **Step 7: Run all tests + build**

```bash
npm run test -- --no-coverage && npm run build 2>&1 | tail -5
```

Expected: all tests pass, build succeeds

- [ ] **Step 8: Commit**

```bash
git add src/webhooks/webhook-signature.guard.ts src/webhooks/webhooks.module.ts src/webhooks/clickup-webhook.controller.ts test/webhook-signature.guard.spec.ts
git commit -m "feat: add webhook HMAC-SHA256 signature verification guard"
```

---

## Task 4: ClickUp Webhooks Service

**Files:**
- Create: `src/clickup/clickup-webhooks.service.ts`
- Modify: `src/clickup/clickup.module.ts`
- Test: `test/clickup-webhooks.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/clickup-webhooks.service.spec.ts
import { ClickupWebhooksService } from '../src/clickup/clickup-webhooks.service';

describe('ClickupWebhooksService', () => {
  const ENDPOINT = 'https://app.example.com/webhooks/clickup';
  const TEAM_ID = '3450636';

  function makeService(webhooks: any[], createResult = { id: 'new-id', secret: 'new-secret' }) {
    const client = {
      getWebhooks: jest.fn().mockResolvedValue(webhooks),
      createWebhook: jest.fn().mockResolvedValue(createResult),
    } as any;
    const config = {
      get: (key: string, def: string) => {
        if (key === 'CLICKUP_TEAM_ID') return TEAM_ID;
        if (key === 'CLICKUP_WEBHOOK_ENDPOINT') return ENDPOINT;
        if (key === 'CLICKUP_WEBHOOK_EVENTS') return 'taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated';
        return def;
      },
    } as any;
    return new ClickupWebhooksService(client, config);
  }

  it('returns existing when active webhook found for same endpoint', async () => {
    const webhooks = [{ id: 'existing-id', endpoint: ENDPOINT, health: { status: 'active', fail_count: 0 } }];
    const result = await makeService(webhooks).register();
    expect(result).toEqual({ action: 'existing', webhookId: 'existing-id', endpoint: ENDPOINT });
  });

  it('creates new webhook when none match endpoint', async () => {
    const result = await makeService([]).register();
    expect(result).toEqual({ action: 'created', webhookId: 'new-id', secret: 'new-secret', endpoint: ENDPOINT });
  });

  it('ignores webhooks pointing to a different endpoint', async () => {
    const webhooks = [{ id: 'other', endpoint: 'https://other.com', health: { status: 'active', fail_count: 0 } }];
    const result = await makeService(webhooks).register();
    expect(result.action).toBe('created');
  });

  it('ignores existing webhooks with non-active health status', async () => {
    const webhooks = [{ id: 'bad', endpoint: ENDPOINT, health: { status: 'failing', fail_count: 10 } }];
    const result = await makeService(webhooks).register();
    expect(result.action).toBe('created');
  });

  it('passes correct events to createWebhook', async () => {
    const client = { getWebhooks: jest.fn().mockResolvedValue([]), createWebhook: jest.fn().mockResolvedValue({ id: 'x', secret: 'y' }) } as any;
    const config = { get: (k: string, d: string) => ({ CLICKUP_TEAM_ID: TEAM_ID, CLICKUP_WEBHOOK_ENDPOINT: ENDPOINT, CLICKUP_WEBHOOK_EVENTS: 'taskCreated,taskDeleted' }[k] ?? d) } as any;
    const svc = new ClickupWebhooksService(client, config);
    await svc.register();
    expect(client.createWebhook).toHaveBeenCalledWith(TEAM_ID, ENDPOINT, ['taskCreated', 'taskDeleted']);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest test/clickup-webhooks.service.spec.ts --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `clickup-webhooks.service.ts`**

```typescript
// src/clickup/clickup-webhooks.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClickupClient } from './clickup.client';

export type RegisterWebhookResult =
  | { action: 'existing'; webhookId: string; endpoint: string }
  | { action: 'created'; webhookId: string; secret: string; endpoint: string };

@Injectable()
export class ClickupWebhooksService {
  private readonly logger = new Logger(ClickupWebhooksService.name);

  constructor(
    private readonly client: ClickupClient,
    private readonly config: ConfigService,
  ) {}

  async register(): Promise<RegisterWebhookResult> {
    const teamId = this.config.get<string>('CLICKUP_TEAM_ID', '3450636');
    const endpoint = this.config.get<string>('CLICKUP_WEBHOOK_ENDPOINT', '');
    const eventsRaw = this.config.get<string>('CLICKUP_WEBHOOK_EVENTS', 'taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated');
    const events = eventsRaw.split(',').map((e) => e.trim()).filter(Boolean);

    const existing = await this.client.getWebhooks(teamId);
    const active = existing.find((w) => w.endpoint === endpoint && w.health?.status === 'active');

    if (active) {
      this.logger.log(`Webhook already registered: ${active.id}`);
      return { action: 'existing', webhookId: active.id, endpoint: active.endpoint ?? endpoint };
    }

    const created = await this.client.createWebhook(teamId, endpoint, events);
    this.logger.log(`New webhook registered: ${created.id}. Save the returned secret to CLICKUP_WEBHOOK_SECRET in .env and restart.`);
    return { action: 'created', webhookId: created.id, secret: created.secret, endpoint };
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx jest test/clickup-webhooks.service.spec.ts --no-coverage
```

Expected: PASS (5 tests)

- [ ] **Step 5: Register in `clickup.module.ts`**

Replace `src/clickup/clickup.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ClickupClient } from './clickup.client';
import { ClickupNormalizer } from './clickup-normalizer';
import { CustomFieldExtractor } from './custom-field-extractor';
import { ClickupWebhooksService } from './clickup-webhooks.service';

@Module({
  imports: [HttpModule],
  providers: [ClickupClient, ClickupNormalizer, CustomFieldExtractor, ClickupWebhooksService],
  exports: [ClickupClient, ClickupNormalizer, CustomFieldExtractor, ClickupWebhooksService],
})
export class ClickupModule {}
```

- [ ] **Step 6: Run all tests + build**

```bash
npm run test -- --no-coverage && npm run build 2>&1 | tail -5
```

Expected: all tests pass, build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/clickup/clickup-webhooks.service.ts src/clickup/clickup.module.ts test/clickup-webhooks.service.spec.ts
git commit -m "feat: add ClickupWebhooksService with idempotent register logic"
```

---

## Task 5: Dead Letter Repository extensions

**Files:**
- Modify: `src/jobs/dead-letter.repository.ts`
- Test: `test/dead-letter.repository.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/dead-letter.repository.spec.ts
import { DeadLetterRepository } from '../src/jobs/dead-letter.repository';

describe('DeadLetterRepository.findPending', () => {
  it('queries with retriedAt and resolvedAt null filters ordered by failedAt desc', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      $transaction: jest.fn().mockImplementation((fns: any[]) => Promise.all(fns)),
      deadLetterJob: { findMany, count },
    } as any;
    const repo = new DeadLetterRepository(prisma);

    const result = await repo.findPending(50, 10);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { retriedAt: null, resolvedAt: null },
      orderBy: { failedAt: 'desc' },
      take: 50,
      skip: 10,
    }));
    expect(result).toEqual({ items: [], total: 0 });
  });
});

describe('DeadLetterRepository.findById', () => {
  it('calls findUnique with correct id', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: BigInt(1) });
    const prisma = { deadLetterJob: { findUnique } } as any;
    const repo = new DeadLetterRepository(prisma);

    await repo.findById(BigInt(1));

    expect(findUnique).toHaveBeenCalledWith({ where: { id: BigInt(1) } });
  });
});

describe('DeadLetterRepository.markRetried', () => {
  it('updates retriedAt to current time', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = { deadLetterJob: { update } } as any;
    const repo = new DeadLetterRepository(prisma);

    await repo.markRetried(BigInt(5));

    expect(update).toHaveBeenCalledWith({
      where: { id: BigInt(5) },
      data: { retriedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest test/dead-letter.repository.spec.ts --no-coverage
```

Expected: FAIL — `findPending is not a function`

- [ ] **Step 3: Extend `dead-letter.repository.ts`**

Replace `src/jobs/dead-letter.repository.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DeadLetterRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { queueName: string; jobName: string; entityType?: string; entityId?: string; payload: unknown; error: unknown; attemptsMade?: number }) {
    const e = data.error as any;
    return this.prisma.deadLetterJob.create({
      data: {
        queueName: data.queueName, jobName: data.jobName, entityType: data.entityType,
        entityId: data.entityId, payload: data.payload as any,
        errorMessage: e?.message || String(data.error), errorStack: e?.stack,
        attemptsMade: data.attemptsMade,
      },
    });
  }

  async findPending(limit: number, offset: number) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.deadLetterJob.findMany({
        where: { retriedAt: null, resolvedAt: null },
        orderBy: { failedAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true, queueName: true, jobName: true, entityType: true, entityId: true,
          errorMessage: true, failedAt: true, retriedAt: true, attemptsMade: true,
        },
      }),
      this.prisma.deadLetterJob.count({ where: { retriedAt: null, resolvedAt: null } }),
    ]);
    return { items, total };
  }

  findById(id: bigint) {
    return this.prisma.deadLetterJob.findUnique({ where: { id } });
  }

  markRetried(id: bigint) {
    return this.prisma.deadLetterJob.update({ where: { id }, data: { retriedAt: new Date() } });
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx jest test/dead-letter.repository.spec.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/jobs/dead-letter.repository.ts test/dead-letter.repository.spec.ts
git commit -m "feat: add findPending, findById, markRetried to DeadLetterRepository"
```

---

## Task 6: Admin API Key Guard + DTOs

**Files:**
- Create: `src/admin/admin-api-key.guard.ts`
- Create: `src/admin/dto/sync-task.dto.ts`
- Create: `src/admin/dto/backfill.dto.ts`
- Test: `test/admin-api-key.guard.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/admin-api-key.guard.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import { AdminApiKeyGuard } from '../src/admin/admin-api-key.guard';

describe('AdminApiKeyGuard', () => {
  const KEY = 'super-secret-admin-key';

  function makeGuard(key: string) {
    return new AdminApiKeyGuard({ get: (_k: string, def: string) => key || def } as any);
  }

  function makeCtx(header: string | undefined) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-admin-key': header } }) }),
    } as any;
  }

  it('passes with correct key', () => {
    expect(makeGuard(KEY).canActivate(makeCtx(KEY))).toBe(true);
  });

  it('throws UnauthorizedException when header is missing', () => {
    expect(() => makeGuard(KEY).canActivate(makeCtx(undefined))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when key is wrong', () => {
    expect(() => makeGuard(KEY).canActivate(makeCtx('wrong-key'))).toThrow(UnauthorizedException);
  });

  it('passes when ADMIN_API_KEY is not configured (dev mode)', () => {
    expect(makeGuard('').canActivate(makeCtx(undefined))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest test/admin-api-key.guard.spec.ts --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `admin-api-key.guard.ts`**

```typescript
// src/admin/admin-api-key.guard.ts
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx jest test/admin-api-key.guard.spec.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Create DTOs**

```typescript
// src/admin/dto/sync-task.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SyncTaskDto {
  @ApiProperty({ example: '86abc123', description: 'ClickUp task ID' })
  @IsString()
  @MinLength(1)
  taskId: string;
}
```

```typescript
// src/admin/dto/backfill.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class BackfillDto {
  @ApiProperty({ example: '3577824', description: 'ClickUp space ID — must be one of the configured spaces' })
  @IsString()
  @MinLength(1)
  spaceId: string;

  @ApiPropertyOptional({ example: 90, minimum: 1, maximum: 365, description: 'Defaults to the configured lookback for the space' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @Type(() => Number)
  lookbackDays?: number;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/admin/admin-api-key.guard.ts src/admin/dto/sync-task.dto.ts src/admin/dto/backfill.dto.ts test/admin-api-key.guard.spec.ts
git commit -m "feat: add AdminApiKeyGuard and admin request DTOs"
```

---

## Task 7: Admin Controller

**Files:**
- Create: `src/admin/admin.controller.ts`
- Test: `test/admin.controller.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/admin.controller.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminController } from '../src/admin/admin.controller';

describe('AdminController', () => {
  function makeQueues() {
    const add = jest.fn().mockResolvedValue({});
    return { get: jest.fn().mockReturnValue({ add }), defaultJobOptions: jest.fn().mockReturnValue({}) } as any;
  }

  function makeDeadLetters(record: any = null) {
    return {
      findPending: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findById: jest.fn().mockResolvedValue(record),
      markRetried: jest.fn().mockResolvedValue({}),
    } as any;
  }

  function makeWebhooks(result: any = { action: 'created', webhookId: 'wh-1', secret: 'sec', endpoint: 'https://x.com' }) {
    return { register: jest.fn().mockResolvedValue(result) } as any;
  }

  describe('syncTask', () => {
    it('queues SYNC_CLICKUP_TASK on clickup-tasks queue and returns taskId', () => {
      const queues = makeQueues();
      const ctrl = new AdminController(queues, makeDeadLetters(), makeWebhooks());
      const result = ctrl.syncTask({ taskId: '86abc' });
      expect(result).toEqual({ queued: true, taskId: '86abc' });
      expect(queues.get).toHaveBeenCalledWith('clickup-tasks');
    });
  });

  describe('backfill', () => {
    it('uses configured lookback when lookbackDays is not provided', () => {
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), makeWebhooks());
      const result = ctrl.backfill({ spaceId: '3577824' });
      expect(result).toEqual({ queued: true, spaceId: '3577824', lookbackDays: 90 });
    });

    it('uses provided lookbackDays over configured default', () => {
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), makeWebhooks());
      const result = ctrl.backfill({ spaceId: '3589129', lookbackDays: 7 });
      expect(result).toEqual({ queued: true, spaceId: '3589129', lookbackDays: 7 });
    });

    it('throws BadRequestException for unknown spaceId', () => {
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), makeWebhooks());
      expect(() => ctrl.backfill({ spaceId: 'bad-id' })).toThrow(BadRequestException);
    });

    it('queues on clickup-backfills queue', () => {
      const queues = makeQueues();
      const ctrl = new AdminController(queues, makeDeadLetters(), makeWebhooks());
      ctrl.backfill({ spaceId: '3525433' });
      expect(queues.get).toHaveBeenCalledWith('clickup-backfills');
    });
  });

  describe('syncRates', () => {
    it('queues SYNC_ASSIGNEE_RATES on assignee-rates queue', () => {
      const queues = makeQueues();
      const ctrl = new AdminController(queues, makeDeadLetters(), makeWebhooks());
      const result = ctrl.syncRates();
      expect(result).toEqual({ queued: true });
      expect(queues.get).toHaveBeenCalledWith('assignee-rates');
    });
  });

  describe('registerWebhook', () => {
    it('delegates to ClickupWebhooksService.register', async () => {
      const webhooks = makeWebhooks({ action: 'existing', webhookId: 'w1', endpoint: 'https://x.com' });
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), webhooks);
      const result = await ctrl.registerWebhook();
      expect(result).toEqual({ action: 'existing', webhookId: 'w1', endpoint: 'https://x.com' });
    });
  });

  describe('listDeadLetters', () => {
    it('clamps limit to 200 and returns repository result', async () => {
      const dl = makeDeadLetters();
      const ctrl = new AdminController(makeQueues(), dl, makeWebhooks());
      await ctrl.listDeadLetters(999, 0);
      expect(dl.findPending).toHaveBeenCalledWith(200, 0);
    });
  });

  describe('retryDeadLetter', () => {
    it('throws NotFoundException when record does not exist', async () => {
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(null), makeWebhooks());
      await expect(ctrl.retryDeadLetter('99')).rejects.toThrow(NotFoundException);
    });

    it('re-queues using record queueName+jobName+payload and marks retried', async () => {
      const queues = makeQueues();
      const record = { id: BigInt(1), queueName: 'clickup-tasks', jobName: 'sync-clickup-task', payload: { taskId: 'abc' } };
      const dl = makeDeadLetters(record);
      const ctrl = new AdminController(queues, dl, makeWebhooks());
      const result = await ctrl.retryDeadLetter('1');
      expect(result).toEqual({ requeued: true, id: '1', queueName: 'clickup-tasks', jobName: 'sync-clickup-task' });
      expect(dl.markRetried).toHaveBeenCalledWith(BigInt(1));
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest test/admin.controller.spec.ts --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `admin.controller.ts`**

```typescript
// src/admin/admin.controller.ts
import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { SyncTaskDto } from './dto/sync-task.dto';
import { BackfillDto } from './dto/backfill.dto';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { DeadLetterRepository } from '../jobs/dead-letter.repository';
import { ClickupWebhooksService } from '../clickup/clickup-webhooks.service';

@ApiTags('admin')
@ApiSecurity('x-admin-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly queues: QueueService,
    private readonly deadLetters: DeadLetterRepository,
    private readonly webhooks: ClickupWebhooksService,
  ) {}

  @Post('tasks/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manually trigger a single ClickUp task sync' })
  syncTask(@Body() dto: SyncTaskDto) {
    this.queues.get(QUEUES.CLICKUP_TASKS).add(JOBS.SYNC_CLICKUP_TASK, { taskId: dto.taskId }, this.queues.defaultJobOptions());
    return { queued: true, taskId: dto.taskId };
  }

  @Post('backfill')
  @HttpCode(200)
  @ApiOperation({ summary: 'Trigger a space backfill' })
  backfill(@Body() dto: BackfillDto) {
    const space = CLICKUP_SPACES.find((s) => s.id === dto.spaceId);
    if (!space) throw new BadRequestException(`Unknown spaceId: ${dto.spaceId}. Valid: ${CLICKUP_SPACES.map((s) => s.id).join(', ')}`);
    const lookbackDays = dto.lookbackDays ?? space.backfillLookbackDays;
    this.queues.get(QUEUES.CLICKUP_BACKFILLS).add(JOBS.BACKFILL_CLICKUP_SPACE, { spaceId: dto.spaceId, lookbackDays }, this.queues.defaultJobOptions());
    return { queued: true, spaceId: dto.spaceId, lookbackDays };
  }

  @Post('rates/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Trigger immediate Google Sheets rate sync' })
  syncRates() {
    this.queues.get(QUEUES.ASSIGNEE_RATES).add(JOBS.SYNC_ASSIGNEE_RATES, {}, this.queues.defaultJobOptions());
    return { queued: true };
  }

  @Post('webhooks/register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Register NestJS webhook with ClickUp — idempotent, returns secret on first creation' })
  registerWebhook() {
    return this.webhooks.register();
  }

  @Get('dead-letters')
  @ApiOperation({ summary: 'List unresolved dead-letter jobs' })
  async listDeadLetters(@Query('limit') limit = 50, @Query('offset') offset = 0) {
    const safeLimit = Math.min(Number(limit) || 50, 200);
    const safeOffset = Number(offset) || 0;
    return this.deadLetters.findPending(safeLimit, safeOffset);
  }

  @Post('dead-letters/:id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-queue a dead-letter job back onto its original queue' })
  async retryDeadLetter(@Param('id') id: string) {
    const record = await this.deadLetters.findById(BigInt(id));
    if (!record) throw new NotFoundException(`Dead-letter job ${id} not found`);
    await this.queues.get(record.queueName).add(record.jobName, record.payload, this.queues.defaultJobOptions());
    await this.deadLetters.markRetried(BigInt(id));
    return { requeued: true, id, queueName: record.queueName, jobName: record.jobName };
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx jest test/admin.controller.spec.ts --no-coverage
```

Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/admin/admin.controller.ts test/admin.controller.spec.ts
git commit -m "feat: add AdminController with task sync, backfill, rates, webhook registration, dead-letter endpoints"
```

---

## Task 8: Wire up AdminModule and final verification

**Files:**
- Create: `src/admin/admin.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `admin.module.ts`**

```typescript
// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { JobsModule } from '../jobs/jobs.module';
import { ClickupModule } from '../clickup/clickup.module';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { AdminController } from './admin.controller';

@Module({
  imports: [QueuesModule, JobsModule, ClickupModule],
  providers: [AdminApiKeyGuard],
  controllers: [AdminController],
})
export class AdminModule {}
```

- [ ] **Step 2: Register in `app.module.ts`**

Add `AdminModule` import. Replace `src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { ClickupModule } from './clickup/clickup.module';
import { QueuesModule } from './queues/queues.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TasksModule } from './tasks/tasks.module';
import { TimeEntriesModule } from './time-entries/time-entries.module';
import { RatesModule } from './rates/rates.module';
import { SyncModule } from './sync/sync.module';
import { WorkersModule } from './workers/workers.module';
import { AdminModule } from './admin/admin.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    TerminusModule,
    BullModule.forRootAsync({
      useFactory: () => ({ connection: { url: process.env.REDIS_URL } }),
    }),
    DatabaseModule,
    ClickupModule,
    QueuesModule,
    WebhooksModule,
    TasksModule,
    TimeEntriesModule,
    RatesModule,
    SyncModule,
    WorkersModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 3: Run full test suite**

```bash
npm run test -- --no-coverage
```

Expected: all tests pass including the new ones

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 5: Run build**

```bash
npm run build
```

Expected: builds cleanly to `dist/`

- [ ] **Step 6: Final commit**

```bash
git add src/admin/admin.module.ts src/app.module.ts
git commit -m "feat: register AdminModule in AppModule — production readiness sprint complete"
```

---

## Post-implementation checklist

After all tasks are complete:

1. Set `CLICKUP_WEBHOOK_ENDPOINT` to your NestJS server URL (e.g. `https://your-domain.com/webhooks/clickup`)
2. Set `ADMIN_API_KEY` to a strong random string
3. Start the service
4. Call `POST /admin/webhooks/register` with `x-admin-key` header — copy the returned `secret`
5. Add `CLICKUP_WEBHOOK_SECRET=<secret>` to `.env` and restart
6. Verify both n8n and NestJS webhooks are active in ClickUp
7. Monitor for a few days, then delete the n8n webhook
