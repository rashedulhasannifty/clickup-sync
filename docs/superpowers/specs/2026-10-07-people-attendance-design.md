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
| **1** | Employee records, employment events, attendance + leave from a **dummy provider**, directory, employee summary, attendance & leave page | done |
| 2 | Documents, stored in MinIO (see "Slice 2 — documents" below) | done |
| 3 | Appraisal cycle, on the paper appraisal form (see "Slice 3 — appraisals") | done |
| 4 | Exit (see "Slice 4 — exit") | done |
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
    (Superseded for salary by migration 0031: the appraisal form needs starting
    and present gross salary; see "Slice 3 — appraisals".)

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
- ~~Today's attendance appears only after a sync.~~ Fixed: besides the
  00:30 nightly 7-day sync, an hourly cron (:05, 09:00–20:00 Dhaka, Mon–Fri)
  re-syncs today only.
- ~~Dummy past PENDING leaves stay PENDING.~~ Fixed: a dummy request is
  reported PENDING while its day is ahead and APPROVED (same externalId) once
  it arrives; a request someone decided by hand is never overwritten.
- ~~Manager cycles longer than one hop are not detected.~~ Fixed: a manager
  change is refused if the new manager already reports up to the employee, at
  any depth.
- **Pre-existing schema drift:** `prisma migrate dev` against the local DB
  also proposes unrelated changes (e.g. `clickup_tasks` timestamptz columns,
  `idx_clickup_time_entries_start_time_status`). Migration 0025 deliberately
  contains only People objects. Don't accept a `migrate dev` diff blindly.

## Slice 3 — appraisals

Owner/Admin only, like every People route. Until slice 6, an Owner/Admin
fills in every step, including the self review on the employee's behalf.

Reworked 2026-10-12 (migration `0031_appraisal_form`) to follow the company's
paper form **"Performance Appraisal Form – Asst. Managers and above"**.
Decided with the product owner: **the form's 100-mark total and A–F grade are
the official result; the KPI score is shown beside it as a separate reference
number and is never blended in.** Cycles created before 0031 were backfilled
`KPI_BLEND` and keep the original rules and their frozen scores (see "Legacy
KPI_BLEND cycles" below).

### Cycles

`appraisal_cycles`: name, periodStart, periodEnd (dates), status
`DRAFT | OPEN | CLOSED`, **type** `HALF_YEARLY | CONFIRMATION | YEARLY`
(existing rows → YEARLY), **scoringMode** `FORM_100 | KPI_BLEND` (existing rows
→ KPI_BLEND; new cycles default to FORM_100), `kpiWeight` (KPI_BLEND only;
stored 0 for FORM_100), and competencies, a JSON list of
`{ key, label, description? }`. A new FORM_100 cycle starts with the form's
10 criteria and their printed descriptions (`FORM_CRITERIA` in
`src/appraisals/appraisal-score.ts`), editable until launch: Job Knowledge,
Customer Orientation, Decision Making, Planning and Organizing, Building and
Leading Teams, Developing People, Communication, Influencing, Commitment to
Excel, Integrity. Period, its basis, type, weight and criteria lock once
appraisals exist. Launching an OPEN cycle creates one appraisal per selected
employee and, for FORM_100, captures each one's **form header**. Who is
selected by default depends on the cycle's **periodBasis** (next section).

### Counted from join dates (0032)

Decided with the product owner 2026-10-12: appraisals are counted from each
employee's **join date**, not the calendar. Migration
`0032_appraisal_join_schedule` adds `appraisal_cycles.period_basis`
`CALENDAR | JOIN_DATE` (existing rows → CALENDAR; new cycles default to
JOIN_DATE) and nullable `appraisals.period_start`, `period_end`, `due_date`
(`@db.Date`; null = the cycle's own period applies: calendar cycles and
appraisals created before 0032).

The schedule is pure (`src/appraisals/appraisal-schedule.ts`, no clock):

| Type | Due | Reviews |
|---|---|---|
| CONFIRMATION | join + 6 months (once) | join date → day before the due date |
| HALF_YEARLY | join + 6k months, k ≥ 2 (12, 18, 24, … months; the 6-month mark is the confirmation) | the 6 months before the due date |
| YEARLY | join + 12k months, k ≥ 1 (each anniversary) | the 12 months before the due date |

- Month arithmetic clamps the day (31 Aug + 6 → 28/29 Feb; 29 Feb + 12 → 28
  Feb), and **every milestone is computed from the join date**, never chained
  from the previous clamped one (29 Feb 2024 → … 28 Feb 2027, 29 Feb 2028).
- A review period starts at the **previous milestone**, also computed from the
  join date (the join date itself for the first one), and ends the day before
  the due date. So periods are contiguous even when the day clamps: joined
  31 Aug 2025, the half-yearly due 28 Feb 2027 reviews 31 Aug 2026 – 27 Feb
  2027 (not "due − 6 months" = 28 Aug, which would overlap the previous
  period). A period never starts before the join date.
- Example: joined 15 Apr 2025 → Confirmation due 15 Oct 2025 (15 Apr – 14 Oct
  2025); half-yearly due 15 Apr 2026 (15 Oct 2025 – 14 Apr 2026), 15 Oct 2026
  (15 Apr – 14 Oct 2026); yearly due 15 Apr 2026 (15 Apr 2025 – 14 Apr 2026).

For a JOIN_DATE cycle the cycle's periodStart/periodEnd mean **"due between"**:

- **Default launch:** every non-EXITED employee with a milestone of the cycle's
  type in the window (CONFIRMATION: only employees still on PROBATION). With
  several milestones in one window, the latest wins. A launch with nobody due
  is a 400 (it would only open an empty cycle).
- **Explicit `employeeIds`:** each one's latest milestone on or before the
  window's end (so a late appraisal can be launched; for a confirmation the
  employee need not still be on probation: an explicit pick is an override).
  Anyone with none yet (joined too recently), or who has exited, is left out
  and listed in the launch response's `notDue`
  (`{ employeeId, employeeName, reason: NOT_YET_DUE | EXITED, firstDueDate }`).
  `skipped` counts only employees attempted who already had an appraisal.
- Each created appraisal stores its own periodStart, periodEnd and dueDate;
  the reviewer still defaults to the manager; `(cycle, employee)` stays unique.
- Everything that used the cycle period for one appraisal uses the
  appraisal's own: the KPI snapshot (and refresh), the PDF ("review period … ·
  due …"), and the views (`periodStart`, `periodEnd`, `dueDate` on the
  appraisal view, the cycle's list rows and the employee history;
  `periodBasis` on the cycle view). The form header's **experience in the
  company is measured to the due date** (never past the exit date), so a
  confirmation reads 6 months however late it is signed off. Calendar cycles
  behave exactly as before (experience to the capture date).

`GET /people/appraisal-cycles/due?type=&from=&to=` (Owner/Admin, read-only)
returns `{ due, overdue, upcoming }` (see the next section), each row with due
date, review period and `daysLate`/`daysEarly`, sorted by due date. It runs
the same pure selector (`selectDue`) as the default launch, so the preview and
the launch never disagree. The employee profile (detail, summary and directory
rows) carries `nextAppraisal`: the oldest **overdue** one first
(`overdueAppraisals`, flagged `overdue`), else `nextDue` (the confirmation
while on PROBATION, otherwise the earlier of the next half-yearly and next
yearly on or after today; on an anniversary both fall due the same day and the
yearly is listed first); null once EXITED. `upcomingAppraisals` lists the
`nextDue` schedule; a past confirmation in it is flagged `overdue` only while
no appraisal covers it.

### Flexible timing: overdue, early, late, backdated (0033)

Decided with the product owner 2026-10-12: an appraisal may happen on time,
early, late, or late with its outcome backdated. **The schedule anchor never
moves**: due dates always come from the join date, so an early or late
appraisal never shifts the next due date. Pure rules live in
`appraisal-schedule.ts` (selection) and `appraisal-timing.ts` (timing,
effective date, date edits).

**Already appraised.** An appraisal (any cycle, any status) covers the
milestone of its cycle's type **nearest its due date**, plus its exact due
date; so one whose due date was adjusted by a few days, or hand-picked, still
counts for the milestone it was launched for, and moving a due date earlier
never brings its milestone back. On a join anniversary the half-yearly and
yearly milestones coincide, and an appraisal of either type covers both.
Calendar-cycle appraisals (no due date) cover no milestone. A covered due date
is skipped by the preview and by every launch, and a due-date edit onto a
milestone another appraisal of the employee covers is a 409: nobody is
appraised twice for the same due date.

**Groups** for a cycle of `type` due in [from, to] (`classifyDue`; at most one
per employee, in this priority):

- `due`: the latest milestone in the window, unless covered.
- `overdue`: the latest milestone **before the window start**, and only that
  one (if it is covered, older misses do not resurface). It must be after the
  employee's last appraisal of the type (that appraisal's covered milestone,
  or for a calendar-cycle appraisal its period end). CONFIRMATION: only while
  on PROBATION, with no lookback limit (it is still owed). HALF_YEARLY /
  YEARLY: never while on PROBATION, never before the confirmation date (a null
  confirmation date only applies the lookback), and only within
  `OVERDUE_LOOKBACK_MONTHS` = **12 months before today**, so people confirmed
  in bulk before this existed do not all show as years overdue.
- `upcoming`: the first milestone in (to, to + `UPCOMING_DAYS` = 60 days],
  unless covered.
- `daysLate` / `daysEarly` count from today (Dhaka) to the due date.
- Overdue is **per type**, as agreed ("for that type"): a missed yearly stays
  overdue (up to the 12-month lookback) even after a later half-yearly, except
  on an anniversary, where one appraisal covers both. An organisation that only
  runs half-yearly cycles will therefore see "Yearly overdue since …" until a
  yearly is launched or the lookback passes. On the local data at the time
  (18 employees, none appraised yet) that is 14 people overdue: 14 yearly and
  6 half-yearly, 6 of them for both.

**Launch.** Default (JOIN_DATE): `due` + `overdue`; `upcoming` only when
picked. Explicit `employeeIds`, per employee: due, else overdue, else coming
up, else the latest due date on or before the window end (as before); anyone
whose resolved due date is already covered is left out and reported in
`notDue` as `ALREADY_APPRAISED` (with `dueDate`). The UI ticks due and overdue
and leaves coming up unticked ("Include early").

`GET /people/appraisal-cycles/overdue` lists everyone overdue across all types
as of today (`overdueAppraisals`: the confirmation while on probation, else the
yearly and half-yearly, the yearly only once on an anniversary), oldest first.

**Adjusting dates.** Until sign-off (any step, cycle open, employee not
exited) `PATCH /people/appraisals/:id` accepts `dueDate`, `periodStart`,
`periodEnd`, merged with what is stored and validated as a whole
(`dateEditError`): start ≤ end; start not before the join date; the due date
not before the join date; **the period ends on or before the due date** (a
period reviews the time before the appraisal falls due); at most about two
years. When the period changes and a KPI snapshot exists, it is recomputed over
the new period in the same write; for the form the header is recaptured too
(experience is measured to the due date). Calendar-cycle appraisals can be
given their own dates the same way.

**Timing** (`appraisalTiming`, on the view, list rows, employee history and
the PDF): compares the sign-off date (Dhaka) — or today while open — with the
due date. `ON_TIME` within ±`TIMING_GRACE_DAYS` = 3; else `EARLY` / `LATE`;
open: `OPEN_OVERDUE` past the grace, else `OPEN` (days until due). Null for
calendar cycles. Shown as e.g. "Due 15 Jan 2026 · signed off 3 Mar 2026
(47 days late)".

**Outcome effective date.** Migration `0033_appraisal_effective_date` adds
`appraisals.effective_date_mode` `DUE_DATE | APPROVAL_DATE | CUSTOM`
(nullable; rows before 0033 backfilled APPROVAL_DATE) and `effective_date`
(`@db.Date`; backfilled to the Dhaka date of `signed_off_at` for signed-off
rows). Chosen at FINAL_APPROVAL with the decision; null means the default,
**DUE_DATE when signing off today would be LATE** (the same rule as the label),
else APPROVAL_DATE. CUSTOM needs a date not before the review period start;
DUE_DATE needs a due date; both are re-checked as advance blockers (the period
can move after the choice). At sign-off the mode and date are resolved once and
stored in the same write as SIGNED_OFF; the CONFIRMED / PROMOTED / INCREMENT
events (and so the confirmation date) use that stored date, so a retry on a
later day writes the same date. Legacy KPI_BLEND cycles always use the
approval date. When backdated, the page and the PDF say "Effective from 15 Jan
2026 (backdated to the due date)"; for an approved, backdated increment they
show the whole months of arrears between the effective date and the approval
date, as information only (no money is computed).

### Intern lifecycle (0034)

Decided with the product owner 2026-10-12. The company lifecycle is **Intern
(3–4 months, varies per person) → Probation (6 months) → Confirmation
(permanent) → a Yearly appraisal every year, counted from the PROBATION START
date**. Most cycles are yearly; each appraisal can recommend promotion,
increment, both, or other actions. Example: intern from 1 Jan 2025, probation
from 1 Apr 2025, confirmation due 1 Oct 2025, yearly appraisals due 1 Apr
2026, 1 Apr 2027, …

Migration `0034_intern_lifecycle` (additive; no statement uses a value added
in the same migration):

- `EmployeeStatus` gains `INTERN`; `EmploymentEventType` gains
  `PROBATION_STARTED` and `INTERNSHIP_EXTENDED`; `AppraisalType` gains
  `INTERNSHIP`; a new enum `InternshipOutcome` `MOVE_TO_PROBATION |
  EXTEND_INTERNSHIP | END_INTERNSHIP`.
- `employees.probation_start_date` (DATE, nullable; **every existing row
  backfilled to `join_date`**, so nobody's schedule moved; the app reads null
  as the join date, except for an intern, who has not started probation) and
  `employees.internship_end_date` (DATE, nullable: the expected internship
  end).
- `appraisals.internship_outcome`, `proposed_probation_start`,
  `proposed_internship_end`. The internship recommendation is a separate
  single-value column, not new `AppraisalAction` values: "exactly one" is a
  scalar, and the two sets can never be offered on the wrong kind of review.

**The schedule anchor is the probation start** (`anchorOf` in
`appraisal-schedule.ts`: `probationStartDate ?? joinDate`). CONFIRMATION is
anchor + 6 months, YEARLY anchor + 12k months, HALF_YEARLY anchor + 6k months
(k ≥ 2); review periods never start before the anchor, so an intern's
internship months are not part of their first yearly review. Overdue,
"already appraised", `nextDue` and the explicit-launch fallback all count from
the anchor. Everything in the 0032/0033 sections above that says "join date"
for these three types now means the anchor.

**Interns** are never in scope for confirmation, yearly or half-yearly
reviews (`inScope`, `overdueFor`, `overdueAppraisals`, `nextDue`); their only
schedule is the **internship review**:

- **Due** on `internshipEndDate`, else join + 3 months (`addMonthsClamped`, no
  day subtracted: joined 1 Jan → due 1 Apr). It is the type's one milestone
  for the due / overdue / coming-up groups and for launch; overdue has no
  lookback (it is still owed while an intern, like the confirmation on
  probation). Only INTERN employees; an explicit pick of a non-intern for an
  internship cycle is reported in `notDue` as `NOT_AN_INTERN`, an intern picked
  for any other type as `STILL_INTERN`.
- **Reviews** join date → the day before the due date. After an extension it
  reviews the previous end date → the day before the new end date. The
  previous end is the latest `INTERNSHIP_EXTENDED` event's `fromValue`
  (written by the server, never typed). "Already reviewed" is per term: an
  internship review covers the current term when its due date is after that
  previous end (before any extension, any internship review covers it), so a
  nudged due date on the current review never looks like an old one.
- **Cycles:** an INTERNSHIP cycle must be FORM_100 and JOIN_DATE (400
  otherwise, on create and update). It starts with six criteria, each with a
  one-sentence description, editable until launch (`INTERNSHIP_CRITERIA`):
  Learning ability, Job knowledge, Quality of work, Communication, Attendance
  & discipline, Attitude & teamwork. Ratings 2/4/6/8/10, the total normalised
  to 100 and the A–F grade, as on the form.
- **Workflow** (`flowOf(scoringMode, type)` → `stepsFor`, `nextStatus`,
  `previousStatus`, `editableFields`): SELF_REVIEW (optional) → LEAD_REVIEW
  (supervisor: ratings, comment, `internshipOutcome` and its date) →
  HR_REVIEW (HR comment, `approvalDecision`, `approvalComment`) → SIGNED_OFF.
  No department head or CTO/COO step; `actions`, increment, promotion and the
  effective-date choice are never editable on an internship review, and the
  internship fields never on any other.
- **Recommendation** (exactly one). MOVE_TO_PROBATION needs a probation start
  on or after the join date; choosing it without a date defaults it to the day
  after the due date. EXTEND_INTERNSHIP needs a new end date later than the
  current one. END_INTERNSHIP needs nothing. A date for the other outcome is a
  400, and switching outcome clears the other date. Leaving LEAD_REVIEW and
  HR_REVIEW is blocked by an unrated criterion or an incomplete or invalid
  recommendation (re-checked against the employee's internship end as it is
  now); HR_REVIEW also needs the decision.
- **Outcome**, applied once (`outcomeAppliedAt`), only when HR APPROVED and the
  employee is still an INTERN (`internshipOutcomePlan`):
  MOVE_TO_PROBATION writes `PROBATION_STARTED` dated the chosen probation
  start (status → PROBATION, `probation_start_date` set; the confirmation is
  then due 6 months later). EXTEND_INTERNSHIP writes `INTERNSHIP_EXTENDED`
  (from/to = old/new end date, dated the sign-off date) and sets
  `internship_end_date`; a new internship review falls due then. It is skipped
  once the end date already is the new one, so a retry never extends twice.
  END_INTERNSHIP writes nothing: the page shows "Start offboarding", as for a
  termination. The stored effective date is the probation start for an
  approved move, else the sign-off date; the view's `effective` is null.
- **Not shown** on an internship review: the KPI reference card, salary and
  experience rows, increment, promotion and the evaluation-metrics policy line.
  The KPI snapshot is still computed in the background, unused.
- **PDF:** "Internship Review" in the same style (header without salary, the
  criteria table, total and grade, the single recommendation with its date,
  supervisor and HR blocks, HR decision), filed as `APPRAISAL /
  APPRAISAL_FORM` ("Internship review - <name> - <cycle>.pdf").

**Employees.**

- Create accepts `status` `INTERN | PROBATION | ACTIVE` (default PROBATION).
  An INTERN gets `internshipEndDate` (default join + 3 months; must be after the
  join date) and no probation start; PROBATION/ACTIVE get `probationStartDate`
  (default the join date; not before it) and may not send an internship end.
  Import-from-users (ACTIVE) gets the join date as its probation start too.
- Edit never changes the status. It may correct an intern's internship end, or
  anyone else's probation start (`null` resets it to the join date); the other
  one is a 400. A probation start that equalled the join date moves with a
  corrected join date, so fixing a join date moves the schedule as it did
  before 0034.
- Manual events: **Moved to probation** (`PROBATION_STARTED`, effective date =
  probation start, only from INTERN, not before joining) and **Internship
  extended** (`INTERNSHIP_EXTENDED`, toValue = the new end date, only for an
  INTERN, later than the current end; fromValue is always the current end).
  `CONFIRMED` is refused for an INTERN (`eventPreconditionError`, also applied
  to appraisal outcomes).
- Profile: `probationStartDate` (null for an intern), `internshipEndDate`
  (never null for an intern). `GET /people/employees?status=INTERN` filters.
- Offboarding an intern and cancelling it puts them back to INTERN.
- UI: an "Intern" status pill (purple) and directory filter; the employee page
  shows the stage in one chip ("Intern since 1 Jan 2026 · internship ends 31
  Mar 2026", "Probation since 1 Apr 2026 · confirmation due 1 Oct 2026",
  "Permanent since 1 Oct 2026"), "Next appraisal: Internship review due 31 Mar
  2026" for an intern, and the probation start on the Overview tab. The create
  cycle dialog defaults to Yearly, orders the types Yearly, Confirmation,
  Internship review, Half-yearly (marked less common), uses the probation-start
  wording, and swaps in the internship criteria when Internship review is
  chosen (internship reviews are join-date and form-only, so the dialog hides
  them for calendar cycles and hides KPI blend for them).

### The form (FORM_100)

- **Rating scale:** Outstanding 10, Good 8, Fair 6, Average 4, Below
  Average 2. Ratings outside {2, 4, 6, 8, 10} are a 400.
- **Total:** the sum of the supervisor's (lead) ratings, normalised to 100
  when a cycle does not have 10 criteria: `sum / (10 × n) × 100`, 1 dp. An
  unrated criterion counts 0 in the live total; there is **no grade until
  every criterion is rated**.
- **Grade and evaluation metrics** (`GRADE_TABLE`, pure):

  | Grade | Marks | Promotion | Increment | Training | Transfer | Termination |
  |---|---|---|---|---|---|---|
  | A | 91–100 | YES | 15% | | | |
  | B | 81–90 | | 13–14% | | | |
  | C | 71–80 | | 11–12% | | | |
  | D | 61–70 | | 9–10% | Yes | | |
  | E | 51–60 | | 7–8% | Yes | Yes | |
  | F | 0–50 | | 0% | | Yes | Yes |

  Terms: A proposed for promotion (eligible if the next position is vacant);
  B, C, D for service confirmation; E for increment with a training plan
  (extension of probation); F for possible transfer with a development plan,
  or separation. A fractional total must reach a band's printed minimum
  (90.5 is a B, 50.5 an F); with 10 criteria totals are always even.
- **Header** (`formHeader` JSON): name, concern name, designation,
  department, date of joining, academic qualification, experience in the
  company (tenure), total experience (experience before joining + tenure),
  starting salary, present gross salary, last increment amount and last
  promotion date. The last two are derived from the latest `INCREMENT` and
  `PROMOTED` employment events, never typed. Captured at launch, refreshed
  with the KPIs and on every step, and **frozen at sign-off, before any
  outcome is applied** (so it shows the salary the appraisal was made
  against).
- **KPI snapshot** is still computed on entering LEAD_REVIEW, refreshable
  until sign-off, frozen after, and shown as "KPI score (reference)". It
  covers the appraisal's own review period (join-date cycles) or the cycle
  period, clipped to today.

### Workflow (FORM_100)

`SELF_REVIEW → LEAD_REVIEW (supervisor) → DEPT_HEAD_REVIEW → HR_REVIEW →
FINAL_APPROVAL (CTO/COO) → SIGNED_OFF`, forward one step at a time, send back
one step before sign-off. The sequence is `stepsFor(scoringMode)`. Each step
records who completed it and when as it is left (`leadReviewBy/At`,
`deptHeadBy/At`, `hrBy/At`, `approvalBy/At`, then `signedOffBy/At`). Each
comment block is editable only in its own step:

| Step | Editable | Blocks the next step |
|---|---|---|
| SELF_REVIEW (optional) | self ratings, self comment | nothing |
| LEAD_REVIEW | ratings, supervisor's comments, recommendations, increment %, new designation, training / development plan | an unrated criterion; no recommendation; Promotion without a designation; Increment without a percent; Termination/Dismissal ticked with Confirm/Increment/Promotion |
| DEPT_HEAD_REVIEW | department head comments; may adjust recommendations, increment %, designation, training plan | same as above |
| HR_REVIEW | HR comments | nothing |
| FINAL_APPROVAL | decision `APPROVED | NOT_APPROVED`, comment, effective date (mode, custom date) | no decision; an approved Increment when the employee has no present gross salary; an unusable effective date |

The appraisal's own `dueDate`, `periodStart` and `periodEnd` are editable in
every step until sign-off (see "Flexible timing" above).

**Recommendations** (`actions`, multi-select): Confirm, Increment,
Promotion, Termination, Dismissal, Training / Transfer. `incrementPercent` is
prefilled in the UI from the bottom of the grade's range and editable.

### Sign-off and outcomes (FORM_100)

Sign-off freezes `finalScore` (the total), `finalGrade` and the header. The
outcome is applied once (`outcomeAppliedAt`), **only when the decision is
APPROVED**, as one transaction (`EmployeesService.recordAppraisalOutcome`), so
a retry never writes half an outcome twice:

Every event is dated with the effective date resolved at sign-off (see
"Outcome effective date" above).

- **Confirm** → `CONFIRMED` event (status → ACTIVE, confirmation date set),
  only while the employee is on PROBATION; otherwise it is skipped, because a
  CONFIRMED event would cancel a notice period or rewrite an earlier
  confirmation.
- **Promotion** → `PROMOTED` event (designation moves).
- **Increment** → `INCREMENT` event, `fromValue`/`toValue` = old/new gross
  salary (whole taka, rounded), notes `"<pct>%"`; the employee's gross salary
  moves. `INCREMENT` cannot be added by hand (its toValue would put a salary
  into the audit log).
- **Termination / Dismissal** are never automatic: the form shows a "Start
  offboarding" link to `/people/:id/exit`. **Training / Transfer** is
  recorded on the form only.
- **NOT_APPROVED** signs off with no outcome.

### The form as a PDF

`GET /people/appraisals/:id/form-pdf` renders the filled form with pdfkit,
laid out like the paper form (appraisal type, header table, criteria table
with the five rating columns, total and grade, evaluation-metrics table,
recommendations ticked, comment blocks with who/when, CTO/COO decision),
using the exit letters' embedded Hind Siliguri font. Before sign-off it is a
preview (not stored); after, it renders the frozen result. At sign-off the
PDF is filed as an `APPRAISAL / APPRAISAL_FORM` employee document via
`DocumentsService.storeGenerated` (`replaces` = this appraisal's own
`formDocumentId`, so another cycle's form is never versioned over).
**Best-effort:** sign-off never fails because documents are not configured or
the store is down; calling advance on a signed-off appraisal retries a
missing PDF (and a missing outcome).

### Employee fields (0031)

`employees` gains `concern_name`, `academic_qualification`,
`experience_before_joining_months`, `starting_salary` and `gross_salary`
(BDT, whole taka). This supersedes decision 10 for salary. They are on the
create/edit DTOs and the Overview tab, behind the exited read-only guard.
Salary is sensitive: every `/people` route is Owner/Admin, the audit log
redacts any `*salary*` request-body key, and nothing logs them (a failed PDF
filing logs only the appraisal id and the error message).

### Legacy KPI_BLEND cycles

Unchanged: status `SELF_REVIEW → LEAD_REVIEW → CALIBRATION → SIGNED_OFF`;
lead ratings 1–5; score 0–5 =
`kpiPart × kpiWeight% + competencyPart × (100 − kpiWeight)%` with
`kpiPart = overallKpiScore / 20`, partial when the KPI score is partial or
missing, a calibrated score wins; single `recommendation`
`PROMOTE | RAISE | NO_CHANGE | IMPROVEMENT_PLAN` (PROMOTE → `PROMOTED`, RAISE /
IMPROVEMENT_PLAN → `NOTE`). Their frozen `finalScore` stays on the 0–5 scale;
`ScoreView.outOf` (5 or 100) and `mode` tell the UI which is which.

### UI

`/people/appraisals`: cycles list, create cycle (basis — "Counted from each
employee's join date" by default, or "Calendar period"; on join-date basis the
period section reads "Appraisals due between" with This month / Next month /
This quarter quick picks that also name the cycle, and a debounced live
preview of who is due; type, scoring, criteria with descriptions; KPI weight
only for the legacy mode), launch (join-date cycles preselect everyone due,
with each one's due date and review period, and allow adding others),
per-cycle progress by that cycle's steps. A join-date cycle's subtitle and
list line read "Due 1–31 Oct 2026 · counted from join dates" and its table
has Due, Review period and Timing columns. The form and the employee's Appraisals tab
show the employee's own review period and due date with a timing chip; the employee page shows
"Next appraisal: Half-yearly due 15 Oct 2026", or in amber "Half-yearly overdue
since 15 Jan 2026" when that due date has no appraisal. The create and launch
dialogs list **Due**, **Overdue** (amber, "27 days late") and **Coming up**
("Include early") with a "3 due · 2 overdue · 4 coming up" line. In the
join-date create dialog the primary action (Enter included) is "Create and
launch for N" whenever anyone is ticked ("Create only" sits beside it); if the
launch half fails, the cycle is kept and selected and the launch is retried
from its own Launch dialog, never by creating a second cycle. An **Overdue appraisals**
callout above the cycles lists everyone overdue by type with "Launch now",
which opens the create dialog on that type and this month's window (the overdue
people come ticked). The appraisal page has a **Dates** card (due, review
period, timing, "Adjust dates" before sign-off) and, at final approval when
Confirm/Increment/Promotion is ticked, an **Effective from** choice (due date
(backdated) / approval date / another date). `/people/appraisals/:appraisalId`: FORM_100
renders the form (header block, criteria with the five labelled ratings,
live total /100 with grade badge and policy line such as "Proposed: increment
13–14%, service confirmation", KPI reference card, recommendations, increment
%, new designation, comment blocks, final approval, "Download form (PDF)");
legacy cycles render the original form. The employee page's Appraisals tab
shows type, marks/score and grade, recommendations and status.

### Not done / follow-ups

- Steps are not role-gated: until slice 6 an Owner/Admin fills every step,
  and the recorded who/when is that user.
- The form has no "Training need" ↔ grade enforcement (e.g. D/E ticking
  Training / Transfer); the policy line only proposes.
- A CONFIRM skipped because the employee was not on probation is visible on
  the employee's timeline (no CONFIRMED event), not called out on the form.
  Likewise an internship outcome skipped because the employee is no longer an
  intern.
- Interns on NOTICE are scheduled like anyone else on notice (from the join
  date, since no probation start is stored); harmless in practice.

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
- **Clearance checklist** (`exit_clearance_items`): seeded from the
  company's manual Employee-Exit-Checklist (see "Exit checklist follows the
  company sheet" below), editable (add/remove custom items, into either
  group). Each: group (`PROCESS | ASSETS`), key (seeded items only), done,
  doneBy, doneAt, notApplicable, notApplicableBy, notApplicableAt, note.
- **Letters:** experience letter and release letter generated server-side as
  PDF (company name from the org, employee name, designation, join date,
  last working day) and stored through the slice-2 documents module as
  `EXIT / EXPERIENCE_LETTER` and `EXIT / RELEASE_LETTER`. Regenerating
  replaces (new version), never duplicates.
- **Complete exit** requires all clearance items resolved — done or not
  applicable (or an explicit override with a note). It writes `EXITED` (exitDate = lastWorkingDay,
  status EXITED) and, when `disableLogin` (default true) and the employee is
  linked to a user, disables that user and revokes their sessions through
  the existing users service. Exited employees are read-only and drop out of
  attendance sync, KPIs and the documents "missing" counts.
- **UI:** "Start offboarding" on the employee page → `/people/:id/exit`
  (stepper as in mockup tab 6), plus `/people/exits` listing in-progress and
  recent exits.

### Exit checklist follows the company sheet (migration `0029_exit_checklist`)

- The default checklist is the company's "Employee-Exit-Checklist" sheet, in
  two groups. **Process tasks** (15): termination paperwork; inform key
  stakeholders; communicate the exit internally; communicate it to clients;
  handover document; collect company assets; remove software access
  (WhatsApp, Teams, Slack, Face lock, Outlook, Time Doctor, ClickUp, Nifty
  Timer); final payments & benefits; review binding agreements; conduct exit
  interview; thank employee on final day; collect contact info / connect on
  LinkedIn; check in with the remaining team; initiate recruiting for a
  replacement; update the organizational chart. **Company assets** (6):
  laptop, phone, monitor, mouse and keyboard, ID/access card, company vehicle.
  The list lives in `DEFAULT_CLEARANCE_ITEMS` (`src/exits/exit-status.ts`).
- Each item can be **Done** or **Not applicable** (the sheet's two columns);
  they are mutually exclusive — setting one clears the other, unsetting one
  touches only its own fields, and `done: true` + `notApplicable: true` in one
  request is a 400. An item is *resolved* when either is set; counts
  (`clearance.resolved`, the list's `clearanceResolved`), the stepper and the
  completion rule all use resolved, and the override note is needed only for
  items that are neither.
- Seeded items carry a stable `key` (unique per exit; custom items have
  none). Saving the exit interview ticks the `exit_interview` item as done by
  the interviewer, only if it is still open (one conditional update, so it
  is idempotent; an item marked N/A or removed is left alone).
- Exits started before 0029 keep their old items, which become `PROCESS`
  items with no key; nothing is re-seeded.
- The sheet's "Approved By" is the person who completed the exit: the view
  carries `completedByName` and the page shows "Approved by <name> on
  <date>".

### Known limitations (slices 3–4)

- Fixed: `NOTICE_GIVEN` / `EXITED` are refused on `POST /people/employees/:id/events`
  (400, "Use Start offboarding"); only the exit flow writes them, through
  `EmployeesService.recordExitEvent`. An `EXITED` employee is read-only (409)
  for profile edits, every employment event, document upload/replace/patch/
  delete, leave decisions, and every appraisal write (save, advance, send back,
  refresh KPIs — the form shows no controls). Exit letters
  (`DocumentsService.storeGenerated`), reads and the exit module's own writes
  still work, and import-from-users skips exited employees.
- Fixed: letters embed Hind Siliguri (SIL OFL, `src/exits/fonts/`), which
  covers Latin and Bengali; generation fails loudly if the font is missing.
  Other scripts (Arabic, Devanagari, …) would still need another font.
- Fixed: "Refresh KPIs" on the appraisal form saves unsaved edits first.
- Appraisal sign-off asks via the browser's confirm dialog, matching Budgets
  and Settings (deliberate, not a gap).

## Onboarding (joining) checklist

This follows the company's paper form "Check List of Joining (New Employees)".
It is created by migration `0030_employee_onboarding`. The code is in `src/people/onboarding*.ts` and
`people-onboarding.controller.ts`. In the UI, the employee page has an **Onboarding** tab, and the directory
shows an "Onboarding 12/28" badge while the checklist is incomplete.

- **Model `OnboardingItem`** (`onboarding_items`):
  - `employeeId`, with cascade delete.
  - `group`: `DOCUMENTS | EQUIPMENT | ACCOUNTS | WELCOME`.
  - `key`: a stable key for seeded items, e.g. `doc_resume`, `eq_laptop`, `acc_clickup`. It is null for custom items.
  - `label` and `position`.
  - `done` / `doneBy` / `doneAt`, and `notApplicable` / `notApplicableBy` / `notApplicableAt`.
  - `note`, and `detail` (laptop serial, SIM number, email address, ...).
  - `documentId`: a foreign key to `employee_documents`, `SET NULL` on delete.

  `(employee_id, key)` is unique. NULL keys are distinct, so this only stops the same seeded line being added twice.
  A CHECK constraint ensures an item is never both done and N/A. `DocumentCategory` gains `NOMINEE`.
- **Default list (28 lines):**
  - 10 documents: resume, job application, release letter from the previous employer, experience certificates,
    education certificates, NID/passport, 4 photos, nominee NID, 2 nominee photos, salary certificate.
  - 7 equipment: laptop, stand, keyboard, mouse, headphone, SIM, stationery.
  - 8 accounts: email, Time Doctor, face lock, Teams, Outlook, Bitwarden, ClickUp, Slack (R&D only).
  - 3 welcome: offer letter (hard copy), flowers, chocolate.

  The list is defined once, in `onboarding-checklist.ts`. Never rename a key.
- **Seeding:** `EmployeesRepository.create` seeds the list in the same nested write. Both
  `POST /people/employees` and import-from-users therefore get it. Employees created before this feature get it
  from `POST .../onboarding/start`. That endpoint inserts every missing default with `skipDuplicates`, so it is
  idempotent and also backfills any default added to the list later.
- **Suggested document per DOCUMENTS line:** a code-side map, keyed by item key.
  - Categories:
    - resume, application, release letter, experience and salary → `EMPLOYMENT`
    - education → `EDUCATION`
    - NID/passport → `IDENTITY`
    - photos → `PERSONAL`
    - nominee lines → `NOMINEE`
  - Each line also gets a doc type that the catalog accepts. New types: RESUME, JOB_APPLICATION,
    PREVIOUS_RELEASE_LETTER, SALARY_CERTIFICATE, PASSPORT_PHOTO, NOMINEE_NID, NOMINEE_PHOTO.
  - A test keeps the map valid.
- **Rules** (`resolveItemChange`, a pure function):
  - Done and N/A are mutually exclusive. Sending both in one request returns 400; setting one clears the other.
  - A linked document implies done. Linking a document marks the item done and clears N/A.
  - Un-ticking done, or marking the item N/A, removes the link. The file stays in Documents.
  - `documentId: null` only removes the link.
  - The linked document must be a current document (not replaced, not deleted) of the same employee, or the
    request returns 400.
  - Ticking an item again keeps the original who/when.
- **Seeded lines cannot be deleted.** Deleting one returns 409 ("mark it not applicable"). This keeps the form's
  lines comparable across people and lets the exit flow rely on the keys. Custom lines can be deleted.
- **Read side:**
  - If the linked document was later replaced, the item shows its newest version.
  - If it was soft-deleted, the item shows "Linked document was deleted" (soft delete never fires `SET NULL`).
  - Progress counts done + N/A as resolved, per group and overall.
  - The directory gets `onboarding: { resolved, total } | null` from one grouped query.
- **Exited employees** are read-only: start, add, patch and delete return 409 via `assertNotExited`. GET still
  works and returns `readOnly: true`.
- **For the exit flow:** `OnboardingService.issuedEquipment(employeeId)`, exported from `PeopleModule`, returns
  the done EQUIPMENT lines as `{ key, label, detail }`. The exit flow can use them to pre-fill the assets to
  collect back. The method is not org-scoped; the caller must already have loaded the employee in its org.

| Method | Path | Purpose |
|---|---|---|
| GET | `/people/employees/:id/onboarding` | Checklist grouped, with progress per group |
| POST | `/people/employees/:id/onboarding/start` | Seed the defaults (idempotent) |
| POST | `/people/employees/:id/onboarding/items` | `{ group, label }` custom item |
| PATCH | `/people/employees/:id/onboarding/items/:itemId` | `done`, `notApplicable`, `note`, `detail`, `documentId` |
| DELETE | `/people/employees/:id/onboarding/items/:itemId` | Custom items only |

All routes are Owner/Admin only, and writes are audited. The controller is in the guardrail `CONTROLLERS`
list.

In the UI, Upload on a document line reuses the Documents upload dialog. The dialog is titled with the line,
and the category and type are pre-filled. After the upload, the UI PATCHes the new document's id onto the
line. If document storage is not configured, lines can still be ticked but nothing can be uploaded.
