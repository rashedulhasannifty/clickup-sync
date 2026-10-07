# People, attendance & employee KPIs — slice 1

Status: building on `feat/people-attendance`.
Mockup: `.superpowers/brainstorm/*/content/people-flow-v2.html` (local only).

## Goal

A company-management area inside the app: one record per employee, their
employment history, office in/out and leave, and a one-page "employee at a
glance" with KPIs. The end goal is tracking KPIs for every employee.

## The full roadmap, and what this slice covers

| Slice | Contents | Status |
|---|---|---|
| **1 (this spec)** | Employee records, employment events, attendance + leave from a **dummy provider**, directory, employee summary, attendance & leave page | building |
| 2 | Documents, stored in MinIO (see "Slice 2 — documents" below) | next |
| 3 | Appraisal cycle (see "Slice 3 — appraisals") | building |
| 4 | Exit (see "Slice 4 — exit") | building |
| 5 | Nifty Timer sync (activity %, timer hours, idle) | later; Nifty Timer has no API key auth today |
| 6 | Configurable KPI targets/weights per designation; lead visibility | later |

The real office entry/exit + leave API does not exist yet (Nifty Timer has no
attendance or leave model). Slice 1 ships a provider interface and a dummy
implementation so the UI and KPIs can be built now.

## Decisions

1. **An employee is not a user.** `employees` is its own table. `user_id` and
   `clickup_user_id` are nullable and unique. Some employees never log in; some
   users (machine/admin accounts) are not employees. Linking is by email.
2. **Owner/Admin only.** Every route is class-level `@Roles(OWNER, ADMIN)`.
   Lead/member visibility is slice 6.
3. **Provider interface, not schema, absorbs the real API.** `AttendanceProvider`
   returns attendance days and leave records keyed by employee **email**. The
   real API becomes a second provider; tables don't change.
4. **Every provider row carries `source`.** Dummy rows are `source = 'dummy'`
   so they can be purged with one `DELETE` when the real API lands. Leave
   upserts on `(source, external_id)`; attendance on `(employee_id, date)`.
5. **The dummy never runs in production by accident.** `ATTENDANCE_PROVIDER`
   is `dummy | none`. Default: `dummy` outside production, `none` in
   production. `dummy` in production is refused at boot unless
   `ATTENDANCE_DUMMY_ALLOW_IN_PROD=true`. The UI shows a "Demo data" badge
   whenever the summary's attendance source is `dummy`.
6. **The dummy is deterministic** — seeded from `email + date`, so re-syncs are
   idempotent and tests are stable.
7. **Own queue.** `people-sync` with `PeopleSyncProcessor`. Not `maintenance`:
   `CostRecalcProcessor` owns that queue and does not dispatch on job name, so
   any other job there would run as a cost recalc.
8. **Calendar:** Dhaka (UTC+6, no DST), Mon–Fri, office start 09:00, grace 30
   min (late = first entry after 09:30 Dhaka), 8 h working day. Reuse
   `dhakaTodayParts` / `countBusinessDays` from `src/budgets/budget-forecast.ts`.
   Public holidays are not modelled in slice 1.
9. **Leave entitlement** (constants for now): casual 10 / year, sick 14 / year,
   calendar-year reset.
10. **No PII beyond work identity** in slice 1: no NID, address, phone, salary.

## Data model (migration `0025_people_attendance`)

```prisma
enum EmployeeStatus { PROBATION ACTIVE NOTICE EXITED }
enum EmploymentEventType { JOINED CONFIRMED PROMOTED DESIGNATION_CHANGED TRANSFERRED NOTICE_GIVEN EXITED NOTE }
enum LeaveType { SICK CASUAL ANNUAL UNPAID OTHER }
enum LeaveStatus { PENDING APPROVED REJECTED CANCELLED }

model Employee {            // employees
  id               String   @id @default(cuid())
  orgId            String   // FK organizations
  fullName         String
  email            String   @unique     // stored lower-cased
  employeeCode     String?  @unique
  userId           String?  @unique     // FK users, onDelete SetNull
  clickupUserId    String?  @unique
  designation      String
  grade            String?
  department       String?
  teamId           String?              // FK teams, onDelete SetNull
  managerId        String?              // self FK, onDelete SetNull
  joinDate         DateTime @db.Date
  confirmationDate DateTime? @db.Date
  exitDate         DateTime? @db.Date
  status           EmployeeStatus @default(PROBATION)
  createdAt / updatedAt
}

model EmploymentEvent {     // employment_events
  id            BigInt @id @default(autoincrement())
  employeeId    String  // FK, onDelete Cascade
  type          EmploymentEventType
  effectiveDate DateTime @db.Date
  fromValue     String?
  toValue       String?
  notes         String?
  createdBy     String?  // user id of actor
  createdAt
  @@index([employeeId, effectiveDate])
}

model AttendanceDay {       // attendance_days
  employeeId      String  // FK, onDelete Cascade
  date            DateTime @db.Date      // Dhaka calendar date
  firstIn         DateTime? @db.Timestamptz(6)
  lastOut         DateTime? @db.Timestamptz(6)
  minutesInOffice Int?
  source          String
  syncedAt        DateTime @updatedAt
  @@id([employeeId, date])
  @@index([date])
}

model LeaveRecord {         // leave_records
  id         String @id @default(cuid())
  employeeId String  // FK, onDelete Cascade
  type       LeaveType
  startDate  DateTime @db.Date
  endDate    DateTime @db.Date            // inclusive
  days       Decimal  @db.Decimal(5, 1)
  status     LeaveStatus @default(PENDING)
  reason     String?
  source     String                      // 'dummy' | 'manual' | later the real API
  externalId String?
  decidedBy  String?
  decidedAt  DateTime?
  syncedAt / createdAt
  @@unique([source, externalId])
  @@index([employeeId, startDate])
}
```

Event side-effects (applied in one transaction with the event insert):
`PROMOTED`/`DESIGNATION_CHANGED` → `designation = toValue`;
`CONFIRMED` → `confirmationDate = effectiveDate`, `status = ACTIVE`;
`NOTICE_GIVEN` → `status = NOTICE`; `EXITED` → `exitDate`, `status = EXITED`;
`TRANSFERRED` → `teamId = toValue` (team id) when it resolves.
Creating an employee writes a `JOINED` event on `joinDate`.

## Provider

```ts
interface AttendanceProvider {
  readonly source: string;                       // 'dummy'
  fetch(people: { email: string; joinDate: string; exitDate: string | null }[],
        from: string, to: string): Promise<{
    attendance: { email: string; date: string; firstIn: Date | null; lastOut: Date | null }[];
    leaves: { email: string; externalId: string; type: LeaveType; startDate: string;
              endDate: string; days: number; status: LeaveStatus; reason?: string }[];
  }>;
}
```

Dummy behaviour per (email, business day within employment, ≤ today): ~4 %
sick, ~4 % casual (one-day leave records, `APPROVED`), otherwise present;
~12 % of present days late (first in 09:31–10:40), else 08:40–09:30; last out
17:30–19:30; today has `lastOut = null` if before 17:30 Dhaka. Plus one
`PENDING` casual request in the next 14 days for ~30 % of people.

Sync: daily cron 00:30 Dhaka for the last 7 days (worker role only) and
`POST /api/people/attendance/sync { lookbackDays = 90, max 400 }` enqueuing a
`sync-attendance` job. Manual leave decisions (`APPROVED`/`REJECTED`) are not
overwritten by a later sync of the same `(source, externalId)`.

## KPIs (pure module `src/people/kpi-math.ts`)

Default period: the 90 days ending today (Dhaka). Each KPI is
`{ value: number | null, target: number, numerator, denominator, status, reason? }`
with `reason: 'not-linked' | 'no-data'` when `value` is null. An employee with
no `clickupUserId` gets `not-linked` for ClickUp KPIs — never 0 %.

| KPI | Formula | Target |
|---|---|---|
| Utilisation | ClickUp hours ÷ (business days in period ∩ employment − approved leave business days) × 8 | 85 % |
| Chargeable | chargeable ClickUp hours (`is_chargeable`) ÷ ClickUp hours | 70 % |
| On-time delivery | tasks the employee is assigned to, closed in period with a due date, closed on/before the due day (Dhaka) ÷ those tasks | 85 % |
| Punctuality | attendance days with `firstIn` ≤ 09:30 Dhaka ÷ attendance days with a `firstIn` | 90 % |
| Leave used | approved sick / casual days this calendar year vs entitlement | info only |

Score per KPI = `min(value / target, 1) × 100`. Overall = equal-weighted mean of
the non-null scored KPIs (utilisation, chargeable, on-time, punctuality),
rounded. Bands: ≥ 80 `on-track`, 60–79 `watch`, < 60 `at-risk`, no KPIs →
`no-data`.

## API (all `/api/people/*`, Owner/Admin, writes audited)

| Method | Path | Purpose |
|---|---|---|
| GET | `/people/employees?search&status&teamId` | Directory rows: profile, team name, tenure, today's attendance state, 90-day overall score + band, `linked: { clickup, user }` |
| POST | `/people/employees` | Create (+ `JOINED` event) |
| POST | `/people/employees/import-from-users` | Create an employee for each active user without one (designation `Unassigned`, join date = user created date); returns `{ created }` |
| GET | `/people/employees/:id` | Profile |
| PATCH | `/people/employees/:id` | Edit profile fields (not status — status moves via events) |
| GET | `/people/employees/:id/events` | Timeline, newest first |
| POST | `/people/employees/:id/events` | Add event (side-effects above) |
| GET | `/people/employees/:id/summary?from&to` | KPIs, overall, 6-month trend, last 30 business days of attendance, leave balance, timeline, `attendanceSource` |
| GET | `/people/attendance/today` | Door log for today + counts (in office, late, on leave, pending requests) |
| GET | `/people/leaves?status&from&to&employeeId` | Leave records |
| PATCH | `/people/leaves/:id` | `{ status: APPROVED | REJECTED }` — PENDING only |
| POST | `/people/attendance/sync` | Enqueue attendance sync |

Every controller is listed in `CONTROLLERS` in
`src/access/report-scope.guardrail.spec.ts`.

## Frontend

New "People" sidebar section (Owner/Admin): **Employees** (`/people`) and
**Attendance & leave** (`/people/attendance`). Employee detail at
`/people/:id`. Layout follows the mockup: header with tenure + overall score,
KPI tiles labelled by source, 6-month trend, 30-day attendance strip, career
timeline with "Add event", leave balance. "Demo data" badge when
`attendanceSource === 'dummy'`.

## Testing

Unit: `kpi-math` (every KPI, null/not-linked paths, leave subtraction, bands),
dummy provider determinism and employment-window clipping, event side-effects,
sync idempotency + manual-decision preservation, env guard for dummy-in-prod.
Guardrail spec covers the new controllers.

## Slice 2 — documents (MinIO)

Decided 2026-10-07: documents live in **MinIO**, reached through the S3 API
(`@aws-sdk/client-s3`), so any S3-compatible store works later.

- **Dev:** the existing local MinIO (`infra-minio-1`, `localhost:9000`, from
  the timetrack repo) with its own bucket `clickup-sync-documents` and a
  scoped user `clickup-sync-app` whose policy covers only that bucket. **Prod:** either a dedicated bucket and
  access key on the existing `timetrack-minio-1` container, or a separate
  container — a deploy-time choice; the code only sees env vars.
- **Env** (all-or-none, like Xero): `DOCUMENTS_S3_ENDPOINT`,
  `DOCUMENTS_S3_REGION`, `DOCUMENTS_S3_BUCKET`, `DOCUMENTS_S3_ACCESS_KEY_ID`,
  `DOCUMENTS_S3_SECRET_ACCESS_KEY`, `DOCUMENTS_S3_FORCE_PATH_STYLE=true`.
  Unset → the documents feature is disabled (API 503, UI notice).
- **The bucket stays private.** Uploads stream through the backend
  (multipart, 20 MB cap) and downloads stream back through it — no presigned
  URLs — so every access is authenticated by the app and writes are audited.
- **Delivery headers reuse `xero-attachment-delivery.ts`'s policy:** only PDF
  and raster images are `inline`; everything else downloads. Don't widen it.
- **Type allowlist, verified by magic bytes** (not the client's
  `Content-Type`): PDF, JPEG, PNG, WebP, DOCX. Filenames are sanitised for
  `Content-Disposition`.
- **Model `EmployeeDocument`** (`employee_documents`): id, employeeId,
  category (`IDENTITY | EMPLOYMENT | EDUCATION | APPRAISAL | EXIT | PERSONAL |
  OTHER`), docType, fileName, contentType, sizeBytes, sha256, storageKey
  (`employees/<employeeId>/<documentId>`), version, replacedById (replace
  keeps the old version), expiresOn (date, optional), visibility
  (`HR_ONLY | HR_AND_EMPLOYEE | EVERYONE` — stored now, enforced when
  employee/lead access lands in slice 6), uploadedBy, createdAt, deletedAt.
- **Delete** is Owner-only and soft (row `deletedAt`, object kept) — the
  object is purged only by an explicit purge.
- **Required checklist** (constant for now): NID or passport, signed contract,
  education certificate, emergency contact form.
- **Endpoints:** `GET/POST /people/employees/:id/documents`,
  `GET /people/documents/:id/content`, `PATCH /people/documents/:id`,
  `POST /people/documents/:id/replace`, `DELETE /people/documents/:id`,
  `GET /people/documents?status=expiring|expired|missing&category&employeeId`
  (company-wide list + counts; expiring = within 30 days).
- **UI:** the Documents tab on the employee page and People → Documents, as
  in the mockup.

## Known limitations (slice 1)

- **ClickUp metrics are not org-scoped.** The People tables carry `org_id` and
  every employee/team/manager lookup filters on it, but `clickup_tasks` and
  `clickup_time_entries` have no `org_id` yet (Spec 2). The KPI queries read
  them by `clickup_user_id` exactly like every other report. When Spec 2 adds
  `org_id` to ClickUp tables, these queries must filter on it too, and
  `clickupUserId` on create/update should be validated against the org's
  ClickUp members.
- **Today's attendance appears only after a sync.** The cron runs once at
  00:30 Dhaka for the previous 7 days; until a manual sync, today shows
  `not-in`. The real provider will likely want an intraday schedule.
- **Dummy past PENDING leaves stay PENDING** unless someone decides them.
- **Manager cycles** longer than one hop (A → B → A) are not detected.
- **Pre-existing schema drift:** `prisma migrate dev` against the local DB
  also proposes unrelated changes (e.g. `clickup_tasks` timestamptz columns,
  `idx_clickup_time_entries_start_time_status`). Migration 0025 deliberately
  contains only People objects. Don't accept a `migrate dev` diff blindly.

## Slice 3 — appraisals

Owner/Admin only, like every People route. Until slice 6, an Owner/Admin
fills in every step, including the self review on the employee's behalf.

- **Cycle** (`appraisal_cycles`): name, periodStart, periodEnd (dates),
  status `DRAFT | OPEN | CLOSED`, `kpiWeight` (0–100, default 70; the rest is
  competencies), competencies (JSON list of `{ key, label }`; default
  technical skill, communication & collaboration, ownership & initiative,
  mentoring). Launching an OPEN cycle creates one appraisal per selected
  employee (default: every non-EXITED employee who joined before periodEnd).
- **Appraisal** (`appraisals`, unique `(cycle_id, employee_id)`): reviewer
  (defaults to the employee's manager), status
  `SELF_REVIEW → LEAD_REVIEW → CALIBRATION → SIGNED_OFF`, forward only one
  step at a time, with a "send back" one step for corrections before
  sign-off. Fields: self ratings + self comments, lead ratings, strengths,
  improvements, goals, recommendation
  `PROMOTE | RAISE | NO_CHANGE | IMPROVEMENT_PLAN`, `newDesignation`
  (required for PROMOTE), calibration note, optional calibrated score.
- **KPI section is computed, never typed.** On entering LEAD_REVIEW the
  cycle period's KPIs are computed with the slice-1 KPI code and stored as a
  snapshot; it can be refreshed until SIGNED_OFF, then it is frozen.
- **Score (0–5):** `kpiPart = overallKpiScore / 20` (0–100 → 0–5);
  `competencyPart` = mean of lead ratings;
  `final = kpiPart × kpiWeight% + competencyPart × (100 − kpiWeight)%`, 1 dp.
  If the KPI score is partial or null, the final score is flagged partial
  (same rule as the overall score). A calibrated score, when set, wins.
- **Sign-off applies the outcome once** (idempotent): PROMOTE writes a
  `PROMOTED` employment event (which updates designation); RAISE writes a
  `NOTE` event ("Salary increase recommended — appraisal <cycle>");
  IMPROVEMENT_PLAN writes a `NOTE` event. Signed-off appraisals are
  read-only.
- **UI:** `/people/appraisals` (cycles list, create cycle, launch, per-cycle
  progress by status), `/people/appraisals/:appraisalId` (the form, stepper
  as in mockup tab 5, previous appraisals sidebar), and an Appraisals tab on
  the employee page (history: cycle, score, recommendation, status).

## Slice 4 — exit

- **Exit record** (`employee_exits`, one active per employee): type
  `RESIGNATION | TERMINATION | CONTRACT_END | OTHER`, noticeDate,
  lastWorkingDay, reason, status `NOTICE → INTERVIEW → CLEARANCE → COMPLETED`
  (or `CANCELLED`, which restores the previous employee status with a `NOTE`
  event). Starting it writes `NOTICE_GIVEN` (status → NOTICE).
- **Exit interview** (on the exit row or its own table): primary reason
  (`CAREER_GROWTH | COMPENSATION | MANAGEMENT | WORK_LIFE_BALANCE |
  RELOCATION | STUDIES | OTHER`), 1–5 ratings for role, team lead,
  compensation, growth, environment; "what could we have done", would
  recommend / rejoin (`YES | MAYBE | NO`), interviewer notes (HR only),
  conductedBy/at.
- **Clearance checklist** (`exit_clearance_items`): seeded from a default
  list (laptop & charger returned, ClickUp access removed, Nifty Timer
  account disabled, handover of open tasks, final settlement / leave
  encashment), editable (add/remove custom items). Each: done, doneBy,
  doneAt, note.
- **Letters:** experience letter and release letter generated server-side as
  PDF (company name from the org, employee name, designation, join date,
  last working day) and stored through the slice-2 documents module as
  `EXIT / EXPERIENCE_LETTER` and `EXIT / RELEASE_LETTER`. Regenerating
  replaces (new version), never duplicates.
- **Complete exit** requires all clearance items done (or an explicit
  override with a note). It writes `EXITED` (exitDate = lastWorkingDay,
  status EXITED) and, when `disableLogin` (default true) and the employee is
  linked to a user, disables that user and revokes their sessions through
  the existing users service. Exited employees are read-only and drop out of
  attendance sync, KPIs and the documents "missing" counts.
- **UI:** "Start offboarding" on the employee page → `/people/:id/exit`
  (stepper as in mockup tab 6), plus `/people/exits` listing in-progress and
  recent exits.
