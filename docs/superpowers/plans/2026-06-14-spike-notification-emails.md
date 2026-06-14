# Spike Notification Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Owner/Admin, from the existing Time Spikes watchlist, email a flagged member their day's per-task breakdown plus an optional note — recording each send so the same person-day isn't emailed twice.

**Architecture:** A new `spike_notifications` table records sends (unique per `clickupUserId + spikeDate`). Two endpoints on the audit-logged `AdminController` — `GET …/preview` (modal data) and `POST …/notify` (send + record) — delegate to a new `SpikeNotificationService` that recomputes the breakdown server-side from `clickup_time_entries ⋈ clickup_tasks` and sends via the existing `MailerService`. The reports `hourSpikes()` watchlist is enriched with a `notified` flag. The `HourSpikesPage` gains a per-row Notify button / "Notified ✓" badge and a modal.

**Tech Stack:** NestJS 11, Prisma 7 (Postgres), class-validator DTOs, nodemailer, React + React Query (Vite app under `apps/web`).

**Spec:** `docs/superpowers/specs/2026-06-14-spike-notification-emails-design.md`

**Conventions to respect:**
- Migrations are **hand-authored** then applied with `npm run prisma:deploy` (never `migrate dev`) — schema.prisma already drifts from migrations.
- Dhaka-day bucketing is `e.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka'` (both `AT TIME ZONE`s — the column is UTC-naive).
- `npm run lint` is broken project-wide; gate on `npm run build` + `npm run test` instead.
- Do **not** use `git commit --no-verify`; let hooks run.

---

## Task 1: `SpikeNotification` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma` (add model near `AdminAuditLog`)
- Create: `prisma/migrations/0009_spike_notifications/migration.sql`

- [ ] **Step 1: Add the Prisma model**

Add to `prisma/schema.prisma` (place it just before `model AdminAuditLog {`):

```prisma
model SpikeNotification {
  id             BigInt   @id @default(autoincrement())
  clickupUserId  String   @map("clickup_user_id")
  spikeDate      DateTime @map("spike_date") @db.Date
  recipientEmail String   @map("recipient_email")
  userName       String?  @map("user_name")
  totalHours     Decimal  @default(0) @map("total_hours") @db.Decimal(12, 4)
  rule           String?
  note           String?
  sentBy         String?  @map("sent_by")
  sentAt         DateTime @default(now()) @map("sent_at")

  @@unique([clickupUserId, spikeDate])
  @@map("spike_notifications")
}
```

- [ ] **Step 2: Hand-author the migration SQL**

Create `prisma/migrations/0009_spike_notifications/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "spike_notifications" (
    "id" BIGSERIAL NOT NULL,
    "clickup_user_id" TEXT NOT NULL,
    "spike_date" DATE NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "user_name" TEXT,
    "total_hours" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "rule" TEXT,
    "note" TEXT,
    "sent_by" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spike_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spike_notifications_clickup_user_id_spike_date_key" ON "spike_notifications"("clickup_user_id", "spike_date");
```

- [ ] **Step 3: Generate the client and apply the migration**

Run:
```bash
npm run prisma:generate
npm run prisma:deploy
```
Expected: prisma generate succeeds; deploy reports `0009_spike_notifications` applied (or "already applied" on re-run). The `prisma.spikeNotification` delegate now exists.

- [ ] **Step 4: Verify the model compiles**

Run: `npm run build`
Expected: PASS (no TS errors — confirms the generated `SpikeNotification` type is present).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0009_spike_notifications/migration.sql
git commit -m "feat(db): spike_notifications table for spike-notice send tracking"
```

---

## Task 2: `MailerService.sendSpikeNotice` + export from AuthModule

**Files:**
- Modify: `src/auth/mailer.service.ts`
- Modify: `src/auth/mailer.service.spec.ts`
- Modify: `src/auth/auth.module.ts` (export `MailerService`)

- [ ] **Step 1: Write the failing test**

Append to `src/auth/mailer.service.spec.ts` (inside the existing `describe('MailerService', …)` block):

```ts
  it('builds a spike-notice email with task rows, the note, and escapes HTML', async () => {
    const sent: any[] = [];
    const config = { get: (k: string, d?: any) => ({ MAIL_FROM: 'from@test', SMTP_HOST: '' }[k] ?? d) } as any;
    const svc = new MailerService(config);
    (svc as any).transport = { sendMail: async (m: any) => { sent.push(m); return { messageId: '2' }; } };

    await svc.sendSpikeNotice({
      to: 'member@test.com',
      userName: 'Rashedul',
      date: '2026-06-10',
      totalHours: 14.5,
      reason: 'over the 12h/day cap',
      note: 'Please review <these>',
      tasks: [{ taskId: '86a', taskName: 'Fix & ship', hours: 9 }],
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('member@test.com');
    expect(sent[0].subject).toContain('2026-06-10');
    expect(sent[0].html).toContain('14.50h');
    expect(sent[0].html).toContain('over the 12h/day cap');
    expect(sent[0].html).toContain('Fix &amp; ship');          // task name escaped
    expect(sent[0].html).toContain('Please review &lt;these&gt;'); // note escaped
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- mailer.service`
Expected: FAIL with `svc.sendSpikeNotice is not a function`.

- [ ] **Step 3: Implement `sendSpikeNotice`**

In `src/auth/mailer.service.ts`, add this exported interface above the class:

```ts
export interface SpikeNoticeArgs {
  to: string;
  userName: string;
  date: string;
  totalHours: number;
  reason: string;
  note: string | null;
  tasks: { taskId: string; taskName: string; hours: number }[];
}
```

Then add this method to the `MailerService` class (after `sendInvite`):

```ts
  async sendSpikeNotice(args: SpikeNoticeArgs): Promise<void> {
    const from = this.config.get<string>('MAIL_FROM', 'no-reply@example.com');
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rows = args.tasks
      .map(
        (t) =>
          `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(t.taskName)}</td>` +
          `<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${t.hours.toFixed(2)}h</td></tr>`,
      )
      .join('');
    const noteBlock = args.note
      ? `<p style="margin:12px 0;padding:10px 12px;background:#fff7ed;border-left:3px solid #f59e0b;">${esc(args.note)}</p>`
      : '';
    const html = `<p>Hi ${esc(args.userName)},</p>
<p>Our time-tracking review flagged <strong>${esc(args.date)}</strong> (Asia/Dhaka): you logged <strong>${args.totalHours.toFixed(2)}h</strong>, which is ${esc(args.reason)}.</p>
${noteBlock}
<table style="border-collapse:collapse;font-size:14px;margin:8px 0;">
<thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ccc;">Task</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ccc;">Hours</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p>Please review these entries in ClickUp and correct any mistakes.</p>`;
    const subject = `Heads up: unusually high hours logged on ${args.date}`;
    const info = await this.transport.sendMail({ from, to: args.to, subject, html });
    if (!this.config.get<string>('SMTP_HOST', '')) {
      this.logger.log(`[DEV EMAIL] spike notice for ${args.to} on ${args.date} (${args.totalHours.toFixed(2)}h)`);
    } else {
      this.logger.log(`Spike notice sent to ${args.to} (messageId=${(info as { messageId?: string }).messageId})`);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- mailer.service`
Expected: PASS (both the invite test and the new spike-notice test).

- [ ] **Step 5: Export `MailerService` from `AuthModule`**

In `src/auth/auth.module.ts`, change the `exports` array from:
```ts
  exports: [SessionService, OrgRepository],
```
to:
```ts
  exports: [SessionService, OrgRepository, MailerService],
```
(`MailerService` is already imported and in `providers`.)

- [ ] **Step 6: Commit**

```bash
git add src/auth/mailer.service.ts src/auth/mailer.service.spec.ts src/auth/auth.module.ts
git commit -m "feat(mail): sendSpikeNotice email + export MailerService"
```

---

## Task 3: `SpikeNotificationService` (breakdown + send + record)

**Files:**
- Create: `src/admin/spike-notification.service.ts`
- Test: `src/admin/spike-notification.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/admin/spike-notification.service.spec.ts`:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SpikeNotificationService } from './spike-notification.service';

function makeDeps(overrides: any = {}) {
  const sent: any[] = [];
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    spikeNotification: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    ...overrides.prisma,
  };
  const mailer = { sendSpikeNotice: jest.fn(async (a: any) => { sent.push(a); }) };
  const settings = { getSpikeHoursCap: () => 12 };
  const svc = new SpikeNotificationService(prisma as any, mailer as any, settings as any);
  return { svc, prisma, mailer, settings, sent };
}

const TASK_ROWS = [
  { task_id: '86a', task_name: 'Build', user_name: 'Rashedul', user_email: 'r@test.com', hours: 9 },
  { task_id: '86b', task_name: 'Backfill', user_name: 'Rashedul', user_email: 'r@test.com', hours: 5.5 },
];

describe('SpikeNotificationService', () => {
  it('breakdown() sums hours, picks the recipient email, and maps tasks', async () => {
    const { svc, prisma } = makeDeps();
    prisma.$queryRaw.mockResolvedValueOnce(TASK_ROWS);
    const b = await svc.breakdown('123', '2026-06-10');
    expect(b.recipientEmail).toBe('r@test.com');
    expect(b.userName).toBe('Rashedul');
    expect(b.totalHours).toBeCloseTo(14.5);
    expect(b.tasks).toHaveLength(2);
  });

  it('breakdown() rejects a malformed date', async () => {
    const { svc } = makeDeps();
    await expect(svc.breakdown('123', '06/10/2026')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('notify() sends one email and records the notification', async () => {
    const { svc, prisma, mailer } = makeDeps();
    prisma.$queryRaw.mockResolvedValueOnce(TASK_ROWS);
    const res = await svc.notify({ userId: '123', date: '2026-06-10', rule: 'absolute', note: 'check it', sentBy: 'admin@test' });
    expect(mailer.sendSpikeNotice).toHaveBeenCalledTimes(1);
    expect(mailer.sendSpikeNotice.mock.calls[0][0].reason).toBe('over the 12h/day cap');
    expect(prisma.spikeNotification.create).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ sent: true, recipientEmail: 'r@test.com', date: '2026-06-10' });
  });

  it('notify() 400s when the day has no entries', async () => {
    const { svc, prisma, mailer } = makeDeps();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(svc.notify({ userId: '123', date: '2026-06-10' })).rejects.toBeInstanceOf(BadRequestException);
    expect(mailer.sendSpikeNotice).not.toHaveBeenCalled();
  });

  it('notify() 400s when no email is on file', async () => {
    const { svc, prisma, mailer } = makeDeps();
    prisma.$queryRaw.mockResolvedValueOnce([{ ...TASK_ROWS[0], user_email: null }]);
    await expect(svc.notify({ userId: '123', date: '2026-06-10' })).rejects.toBeInstanceOf(BadRequestException);
    expect(mailer.sendSpikeNotice).not.toHaveBeenCalled();
  });

  it('notify() 409s without sending when already notified', async () => {
    const { svc, prisma, mailer } = makeDeps();
    prisma.$queryRaw.mockResolvedValueOnce(TASK_ROWS);
    prisma.spikeNotification.findUnique.mockResolvedValueOnce({ id: 1n });
    await expect(svc.notify({ userId: '123', date: '2026-06-10' })).rejects.toBeInstanceOf(ConflictException);
    expect(mailer.sendSpikeNotice).not.toHaveBeenCalled();
  });

  it('relative-rule reason uses the multiplier when median is provided', async () => {
    const { svc, prisma, mailer } = makeDeps();
    prisma.$queryRaw.mockResolvedValueOnce(TASK_ROWS);
    await svc.notify({ userId: '123', date: '2026-06-10', rule: 'relative', median: 5 });
    expect(mailer.sendSpikeNotice.mock.calls[0][0].reason).toBe('2.9× your typical 5.0h');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- spike-notification.service`
Expected: FAIL with `Cannot find module './spike-notification.service'`.

- [ ] **Step 3: Implement the service**

Create `src/admin/spike-notification.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { MailerService } from '../auth/mailer.service';
import { SettingsService } from '../settings/settings.service';

export type SpikeRule = 'absolute' | 'relative' | 'both';

interface BreakdownRow {
  task_id: string | null;
  task_name: string | null;
  user_name: string | null;
  user_email: string | null;
  hours: number;
}

export interface SpikeBreakdown {
  recipientEmail: string | null;
  userName: string | null;
  totalHours: number;
  tasks: { taskId: string; taskName: string; hours: number }[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = (date: string) => new Date(`${date}T00:00:00.000Z`);

@Injectable()
export class SpikeNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Aggregate one user's tracked time for one Dhaka-local day, grouped by task.
   * Mirrors the watchlist's bucketing/join exactly (UTC→Dhaka, is_deleted=false,
   * COALESCE(user_id,'unknown')) so totals match the Time Spikes row.
   */
  async breakdown(userId: string, date: string): Promise<SpikeBreakdown> {
    if (!DATE_RE.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const rows = await this.prisma.$queryRaw<BreakdownRow[]>(Prisma.sql`
      SELECT e.task_id                                   AS task_id,
             MAX(t.task_name)                            AS task_name,
             MAX(NULLIF(e.user_name, ''))                AS user_name,
             MAX(NULLIF(e.user_email, ''))               AS user_email,
             COALESCE(SUM(e.duration_hours), 0)::float   AS hours
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time IS NOT NULL
        AND t.is_deleted = false
        AND COALESCE(e.user_id, 'unknown') = ${userId}
        AND to_char(date_trunc('day', e.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka'), 'YYYY-MM-DD') = ${date}
      GROUP BY e.task_id
      ORDER BY hours DESC
    `);
    const recipientEmail = rows.map((r) => r.user_email).find((v): v is string => !!v) ?? null;
    const userName = rows.map((r) => r.user_name).find((v): v is string => !!v) ?? null;
    const totalHours = rows.reduce((s, r) => s + (r.hours ?? 0), 0);
    const tasks = rows.map((r) => ({
      taskId: r.task_id ?? '',
      taskName: r.task_name ?? '(unknown task)',
      hours: r.hours ?? 0,
    }));
    return { recipientEmail, userName, totalHours, tasks };
  }

  async preview(userId: string, date: string) {
    const b = await this.breakdown(userId, date);
    const existing = await this.prisma.spikeNotification.findUnique({
      where: { clickupUserId_spikeDate: { clickupUserId: userId, spikeDate: dayStart(date) } },
    });
    return { date, ...b, alreadyNotified: !!existing };
  }

  async notify(args: {
    userId: string;
    date: string;
    rule?: SpikeRule;
    median?: number;
    note?: string;
    sentBy?: string;
  }) {
    const { userId, date, rule, median, note, sentBy } = args;
    const b = await this.breakdown(userId, date);
    if (b.tasks.length === 0) throw new BadRequestException('No time entries for that user on that day.');
    if (!b.recipientEmail) throw new BadRequestException('No email on file for this member; cannot send.');

    // Early guard so the common path never double-emails; the unique index is
    // the backstop for a concurrent race (caught as P2002 below).
    const existing = await this.prisma.spikeNotification.findUnique({
      where: { clickupUserId_spikeDate: { clickupUserId: userId, spikeDate: dayStart(date) } },
    });
    if (existing) throw new ConflictException('This member has already been notified for this day.');

    const cap = this.settings.getSpikeHoursCap();
    const reason = this.reasonText(rule, b.totalHours, cap, median);

    await this.mailer.sendSpikeNotice({
      to: b.recipientEmail,
      userName: b.userName ?? 'there',
      date,
      totalHours: b.totalHours,
      reason,
      note: note ?? null,
      tasks: b.tasks,
    });

    try {
      await this.prisma.spikeNotification.create({
        data: {
          clickupUserId: userId,
          spikeDate: dayStart(date),
          recipientEmail: b.recipientEmail,
          userName: b.userName,
          totalHours: new Prisma.Decimal(b.totalHours.toFixed(4)),
          rule: rule ?? null,
          note: note ?? null,
          sentBy: sentBy ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This member has already been notified for this day.');
      }
      throw e;
    }

    return { sent: true, recipientEmail: b.recipientEmail, date, totalHours: b.totalHours };
  }

  private reasonText(rule: SpikeRule | undefined, totalHours: number, cap: number, median?: number): string {
    const mult =
      median && median > 0
        ? `${(totalHours / median).toFixed(1)}× your typical ${median.toFixed(1)}h`
        : 'well above your typical daily hours';
    if (rule === 'absolute') return `over the ${cap}h/day cap`;
    if (rule === 'relative') return mult;
    if (rule === 'both') return `${mult} and over the ${cap}h/day cap`;
    return 'above the usual range';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- spike-notification.service`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/admin/spike-notification.service.ts src/admin/spike-notification.service.spec.ts
git commit -m "feat(admin): SpikeNotificationService — breakdown, send, record"
```

---

## Task 4: Admin endpoints + DTO + module wiring

**Files:**
- Create: `src/admin/dto/notify-spike.dto.ts`
- Modify: `src/admin/admin.controller.ts`
- Modify: `src/admin/admin.module.ts`

- [ ] **Step 1: Create the DTO**

Create `src/admin/dto/notify-spike.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class NotifySpikeDto {
  @ApiProperty({ example: '12345678', description: 'ClickUp user id from the spike watchlist row' })
  @IsString()
  @MaxLength(64)
  userId!: string;

  @ApiProperty({ example: '2026-06-10', description: 'Flagged local (Asia/Dhaka) day, YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiPropertyOptional({ enum: ['absolute', 'relative', 'both'] })
  @IsOptional()
  @IsIn(['absolute', 'relative', 'both'])
  rule?: 'absolute' | 'relative' | 'both';

  @ApiPropertyOptional({ example: 6.0, description: "The member's median daily hours, for email wording" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  median?: number;

  @ApiPropertyOptional({ example: 'Please double-check Tuesday’s entries.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
```

- [ ] **Step 2: Wire the service into `AdminModule`**

In `src/admin/admin.module.ts`:

Add imports at the top:
```ts
import { AuthModule } from '../auth/auth.module';
import { SpikeNotificationService } from './spike-notification.service';
```
Add `AuthModule` to the `imports` array (so `MailerService` resolves):
```ts
  imports: [QueuesModule, JobsModule, ClickupModule, TimeEntriesModule, RatesModule, TasksModule, WebhooksModule, AuthModule],
```
Add `SpikeNotificationService` to `providers`:
```ts
  providers: [AuditLogRepository, AuditLogInterceptor, SpikeNotificationService],
```

- [ ] **Step 3: Add the two endpoints to `AdminController`**

In `src/admin/admin.controller.ts`:

Add the import:
```ts
import { NotifySpikeDto } from './dto/notify-spike.dto';
import { SpikeNotificationService } from './spike-notification.service';
```
Add a constructor parameter (append to the existing constructor list):
```ts
    private readonly spikeNotifications: SpikeNotificationService,
```
Add these handlers inside the class (e.g. after the `workspace-members` handler near the top):
```ts
  @Get('hour-spikes/:userId/:date/preview')
  @ApiOperation({ summary: "Preview a spike notice: the member's per-task breakdown for that Dhaka-local day, recipient email, and whether they've already been notified." })
  previewSpikeNotice(@Param('userId') userId: string, @Param('date') date: string) {
    return this.spikeNotifications.preview(userId, date);
  }

  @Post('hour-spikes/notify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Email a flagged member their spike-day task breakdown (+ optional note) and record the send. 409 if already notified for that day.' })
  notifySpike(@Body() dto: NotifySpikeDto, @CurrentUser() user: AuthPrincipal) {
    return this.spikeNotifications.notify({
      userId: dto.userId,
      date: dto.date,
      rule: dto.rule,
      median: dto.median,
      note: dto.note,
      sentBy: actorLabel(user),
    });
  }
```
(`Param`, `Get`, `Post`, `Body`, `HttpCode` are already imported; `CurrentUser`, `AuthPrincipal`, and `actorLabel` already exist in this file.)

- [ ] **Step 4: Build to verify wiring**

Run: `npm run build`
Expected: PASS (DI resolves — `AuthModule` exports `MailerService`, `SettingsService`/`PrismaService` are global).

- [ ] **Step 5: Run the backend test suite**

Run: `npm run test`
Expected: PASS — existing suites plus Tasks 2–3 specs. (If `reports.service` fails here, it's fixed in Task 5; you may run this after Task 5 instead. Expect only `reports.service` to be affected.)

- [ ] **Step 6: Commit**

```bash
git add src/admin/dto/notify-spike.dto.ts src/admin/admin.controller.ts src/admin/admin.module.ts
git commit -m "feat(admin): preview + notify spike endpoints"
```

---

## Task 5: Enrich the watchlist with a `notified` flag

**Files:**
- Modify: `src/reports/reports.service.ts` (`hourSpikes()` return)
- Modify: `test/reports.service.spec.ts` (mock `spikeNotification.findMany`; add enrichment test)

- [ ] **Step 1: Add `spikeNotification.findMany` to the test's prisma mock**

In `test/reports.service.spec.ts`, inside the `makePrisma()` base object (the same object that defines `$queryRaw` at line ~30), add:
```ts
      spikeNotification: { findMany: jest.fn().mockResolvedValue([]) },
```
This keeps every existing `hourSpikes` test green (enrichment finds no notifications by default).

- [ ] **Step 2: Write the failing enrichment test**

Add a new `describe` block to `test/reports.service.spec.ts`:

```ts
  describe('hourSpikes notified enrichment', () => {
    it('marks a watchlist row notified when a SpikeNotification exists for it', async () => {
      const prisma = makePrisma();
      const day = '2026-06-10';
      // baseline rows (median), display rows (the spike day), axis rows (day series)
      prisma.$queryRaw
        .mockResolvedValueOnce([{ user_id: '123', user_name: 'Rashedul', day, hours: 5 }])      // baseline
        .mockResolvedValueOnce([{ user_id: '123', user_name: 'Rashedul', day, hours: 20 }])     // display
        .mockResolvedValueOnce([{ bucket: day }]);                                              // axis
      prisma.spikeNotification.findMany.mockResolvedValue([
        { clickupUserId: '123', spikeDate: new Date('2026-06-10T00:00:00.000Z') },
      ]);

      const res = await new ReportsService(prisma).hourSpikes(12, day, day);
      expect(res.watchlist).toHaveLength(1);
      expect(res.watchlist[0]).toMatchObject({ userId: '123', date: day, notified: true });
    });

    it('leaves rows not-notified when no SpikeNotification matches', async () => {
      const prisma = makePrisma();
      const day = '2026-06-10';
      prisma.$queryRaw
        .mockResolvedValueOnce([{ user_id: '123', user_name: 'Rashedul', day, hours: 5 }])
        .mockResolvedValueOnce([{ user_id: '123', user_name: 'Rashedul', day, hours: 20 }])
        .mockResolvedValueOnce([{ bucket: day }]);
      // findMany defaults to [] from makePrisma
      const res = await new ReportsService(prisma).hourSpikes(12, day, day);
      expect(res.watchlist[0].notified).toBe(false);
    });
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- reports.service`
Expected: FAIL — `notified` is `undefined` (property missing on the watchlist row).

- [ ] **Step 4: Implement the enrichment**

In `src/reports/reports.service.ts`, find the end of `hourSpikes()`:
```ts
    watchlist.sort((a, b) => b.hours - a.hours);

    return { cap, watchlist: watchlist.slice(0, 20), byUser: { buckets, users } };
  }
```
Replace those two statements with:
```ts
    watchlist.sort((a, b) => b.hours - a.hours);
    const top = watchlist.slice(0, 20);

    // Flag rows the admin has already emailed about (one notice per user-day).
    // Guard the empty case: an empty `OR` would match every row.
    let notifiedSet = new Set<string>();
    if (top.length > 0) {
      const notifs = await this.prisma.spikeNotification.findMany({
        where: {
          OR: top.map((w) => ({
            clickupUserId: w.userId,
            spikeDate: new Date(`${w.date}T00:00:00.000Z`),
          })),
        },
        select: { clickupUserId: true, spikeDate: true },
      });
      notifiedSet = new Set(
        notifs.map((n) => `${n.clickupUserId}|${n.spikeDate.toISOString().slice(0, 10)}`),
      );
    }
    const enriched = top.map((w) => ({ ...w, notified: notifiedSet.has(`${w.userId}|${w.date}`) }));

    return { cap, watchlist: enriched, byUser: { buckets, users } };
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- reports.service`
Expected: PASS (existing `hourSpikes` tests + the two new enrichment tests).

- [ ] **Step 6: Full backend build + test**

Run: `npm run build && npm run test`
Expected: PASS across the suite.

- [ ] **Step 7: Commit**

```bash
git add src/reports/reports.service.ts test/reports.service.spec.ts
git commit -m "feat(reports): notified flag on hour-spikes watchlist"
```

---

## Task 6: Frontend API client + hooks + types

**Files:**
- Modify: `apps/web/src/api/admin.ts`
- Modify: `apps/web/src/hooks/useReports.ts`

> No frontend test harness exists in this repo; gate frontend tasks on `npm run build` (tsc) and manual verification.

- [ ] **Step 1: Add the admin API calls**

In `apps/web/src/api/admin.ts`, add this exported type near the top (after the other `export type` blocks):

```ts
export type SpikeNoticePreview = {
  date: string;
  recipientEmail: string | null;
  userName: string | null;
  totalHours: number;
  tasks: { taskId: string; taskName: string; hours: number }[];
  alreadyNotified: boolean;
};
```
Then add these two members inside the `adminApi` object (before the closing `};`):
```ts
  spikeNoticePreview: (userId: string, date: string): Promise<SpikeNoticePreview> =>
    apiClient
      .get(`/admin/hour-spikes/${encodeURIComponent(userId)}/${encodeURIComponent(date)}/preview`)
      .then((r) => r.data),
  notifySpike: (body: { userId: string; date: string; rule?: 'absolute' | 'relative' | 'both'; median?: number; note?: string }) =>
    apiClient
      .post('/admin/hour-spikes/notify', body)
      .then((r) => r.data as { sent: boolean; recipientEmail: string; date: string; totalHours: number }),
```

- [ ] **Step 2: Add `notified` to the watchlist type and add the hooks**

In `apps/web/src/hooks/useReports.ts`:

(a) Change the first import line from:
```ts
import { useQuery, keepPreviousData } from '@tanstack/react-query';
```
to:
```ts
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { adminApi, type SpikeNoticePreview } from '../api/admin';
```

(b) Add `notified` to the `HourSpikeWatchRow` interface:
```ts
export interface HourSpikeWatchRow {
  userId: string;
  userName: string;
  date: string;
  hours: number;
  median: number;
  multiplier: number | null;
  rule: 'absolute' | 'relative' | 'both';
  notified: boolean;
}
```

(c) Add these hooks immediately after the existing `useHourSpikes()` function:
```ts
export function useSpikeNoticePreview(userId: string | null, date: string | null) {
  return useQuery<SpikeNoticePreview>({
    queryKey: ['spike-notice-preview', userId, date],
    queryFn: () => adminApi.spikeNoticePreview(userId as string, date as string),
    enabled: !!userId && !!date,
  });
}

export function useNotifySpike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string; date: string; rule?: 'absolute' | 'relative' | 'both'; median?: number; note?: string }) =>
      adminApi.notifySpike(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hour-spikes'] }),
  });
}
```

- [ ] **Step 3: Type-check the web app**

Run: `npm run build`
Expected: PASS. (Root `build` builds the API; if the web app has its own build, also run it — see Task 7 Step 4. The `notified` field is now required on `HourSpikeWatchRow`; the backend supplies it, and the page maps it in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/admin.ts apps/web/src/hooks/useReports.ts
git commit -m "feat(web): spike-notice api + hooks"
```

---

## Task 7: Frontend — Notify button, "Notified ✓" badge, and modal

**Files:**
- Create: `apps/web/src/components/NotifySpikeModal.tsx`
- Modify: `apps/web/src/pages/HourSpikesPage.tsx`

- [ ] **Step 1: Create the modal component**

Create `apps/web/src/components/NotifySpikeModal.tsx`:

```tsx
import { useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { useSpikeNoticePreview, useNotifySpike, type HourSpikeWatchRow } from '../hooks/useReports';

export function NotifySpikeModal({ row, onClose }: { row: HourSpikeWatchRow; onClose: () => void }) {
  const preview = useSpikeNoticePreview(row.userId, row.date);
  const notify = useNotifySpike();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const p = preview.data;
  const noEmail = !!p && !p.recipientEmail;
  const already = !!p?.alreadyNotified;

  async function send() {
    setError(null);
    try {
      await notify.mutateAsync({
        userId: row.userId,
        date: row.date,
        rule: row.rule,
        median: row.median,
        note: note.trim() || undefined,
      });
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to send. Please try again.');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Notify ${row.userName}`}
      subtitle={`${row.date} · ${row.hours.toFixed(1)}h logged`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="accent"
            size="sm"
            loading={notify.isPending}
            disabled={preview.isLoading || noEmail || already}
            onClick={() => void send()}
          >
            Send email
          </Button>
        </div>
      }
    >
      {preview.isLoading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading breakdown…</div>}
      {preview.isError && <div style={{ fontSize: 13, color: 'var(--red)' }}>Couldn't load the breakdown.</div>}
      {p && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13 }}>
            To: <strong>{p.recipientEmail ?? '— no email on file —'}</strong>
          </div>
          {noEmail && (
            <div style={{ fontSize: 12, color: 'var(--red)' }}>
              This member has no email address on their time entries, so we can't send.
            </div>
          )}
          {already && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Already notified for this day.
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Tasks that day</div>
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
              {p.tasks.map((t, i) => (
                <div
                  key={t.taskId || i}
                  style={{
                    display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 10px', fontSize: 13,
                    borderBottom: i < p.tasks.length - 1 ? '1px solid var(--border-soft)' : 0,
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.taskName}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t.hours.toFixed(2)}h</span>
                </div>
              ))}
            </div>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Note (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Add context for the member…"
              style={{
                fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', resize: 'vertical',
              }}
            />
          </label>
          {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Add the Notify control to each watchlist row**

In `apps/web/src/pages/HourSpikesPage.tsx`:

(a) Extend the imports:
```tsx
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, ChevronRight, Check } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { BarChart, type BarData } from '../components/charts/BarChart';
import { useHourSpikes, type HourSpikeWatchRow } from '../hooks/useReports';
import { useAuth } from '../hooks/useAuth';
import { NotifySpikeModal } from '../components/NotifySpikeModal';
```

(b) Inside `HourSpikesPage()`, add state + role just after `const data = q.data;`:
```tsx
  const { hasRole } = useAuth();
  const canNotify = hasRole('ADMIN');
  const [activeRow, setActiveRow] = useState<HourSpikeWatchRow | null>(null);
```

(c) Replace the entire watchlist row `<button …> … </button>` block (the `data.watchlist.map(...)` body) with this row that separates the navigable area from the Notify action (nested buttons are invalid HTML):
```tsx
            {data.watchlist.map((s, i) => (
              <div
                key={`${s.userId}-${s.date}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                  borderBottom: i < data.watchlist.length - 1 ? '1px solid var(--border-soft)' : 0,
                }}
              >
                <button
                  type="button"
                  onClick={() => navigate(dayLink(s.userId, s.date))}
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 10,
                    background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit', padding: 0,
                  }}
                >
                  <span style={{
                    width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                    background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <TrendingUp size={13} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                      {s.userName} logged {s.hours.toFixed(1)}h on {formatDate(s.date)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{watchSubtitle(s, data.cap)}</div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    view <ChevronRight size={12} />
                  </span>
                </button>
                {canNotify && (
                  s.notified ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
                      fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 7,
                      background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
                    }}>
                      <Check size={12} /> Notified
                    </span>
                  ) : (
                    <Button size="sm" variant="subtle" onClick={() => setActiveRow(s)} style={{ flexShrink: 0 }}>
                      Notify
                    </Button>
                  )
                )}
              </div>
            ))}
```

(d) Render the modal. Just before the final closing `</div>` of the page's returned tree (after the last `</Card>`), add:
```tsx
      {activeRow && <NotifySpikeModal row={activeRow} onClose={() => setActiveRow(null)} />}
```

- [ ] **Step 3: Sanity-check the page still reads `formatDate` / `watchSubtitle` / `dayLink`**

These three helpers are already defined at module scope in `HourSpikesPage.tsx` and are reused unchanged by the new row markup — no edits needed.

- [ ] **Step 4: Build the web app**

Run: `npm run build`
Expected: PASS. If the web app builds separately (e.g. an `apps/web` workspace script), also run that build (e.g. `npm run build --workspace apps/web` or `cd apps/web && npm run build`) and expect a clean `tsc` + Vite build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/NotifySpikeModal.tsx apps/web/src/pages/HourSpikesPage.tsx
git commit -m "feat(web): notify members about hour spikes from the watchlist"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full backend build + test**

Run: `npm run build && npm run test`
Expected: PASS across all suites (mailer, spike-notification, reports, and the pre-existing suites).

- [ ] **Step 2: Manual smoke test (dev)**

Start deps + API + web (`npm run dev:deps`, `npm run start:dev`, and the web dev server). With `SMTP_HOST` unset (dev mode), then:
1. Log in as an Owner/Admin and open **Time Spikes**. Confirm each watchlist row shows a **Notify** button (and none for a Member account).
2. Click **Notify** → the modal loads the recipient email + per-task breakdown. Type a note → **Send email**.
3. Confirm the API log prints `[DEV EMAIL] spike notice for …` and the row flips to **Notified ✓**.
4. Re-open the page; the row stays **Notified ✓**. (A direct second `POST /admin/hour-spikes/notify` for the same user/day returns **409**.)
5. The audit log (`/audit-log`) shows the `POST /admin/hour-spikes/notify` write.

- [ ] **Step 3: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide how to integrate (this repo works directly on `main` per the branch-workflow convention).

---

## Self-review notes (coverage vs spec)

- **Table / send-once** → Task 1 (`@@unique([clickupUserId, spikeDate])`) + Task 3 (early `findUnique` 409 + `P2002` catch).
- **`GET …/preview`** → Tasks 3–4 (`preview()` returns recipient/userName/totalHours/tasks/alreadyNotified).
- **`POST …/notify`, server-recomputed, 400/409** → Tasks 3–4.
- **`MailerService.sendSpikeNotice` + dev log + HTML escaping** → Task 2.
- **Watchlist `notified` enrichment** → Task 5 (+ updated existing test mock).
- **Frontend button / badge / modal, role-gated** → Tasks 6–7 (`hasRole('ADMIN')`).
- **Email content (subject, reason wording, note block, task table)** → Task 2 (HTML) + Task 3 (`reasonText`).
- **Audit-logged + Admin/Owner-only** → endpoints sit on `AdminController` (class-level `@Roles(OWNER, ADMIN)` + `AuditLogInterceptor`) — Task 4.
- **`sentBy` from session** → Task 4 (`actorLabel(user)`).
