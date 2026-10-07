-- People: employee records, employment history, attendance and leave (slice 1).
-- Spec: docs/superpowers/specs/2026-10-07-people-attendance-design.md

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('PROBATION', 'ACTIVE', 'NOTICE', 'EXITED');

-- CreateEnum
CREATE TYPE "EmploymentEventType" AS ENUM ('JOINED', 'CONFIRMED', 'PROMOTED', 'DESIGNATION_CHANGED', 'TRANSFERRED', 'NOTICE_GIVEN', 'EXITED', 'NOTE');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('SICK', 'CASUAL', 'ANNUAL', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "employee_code" TEXT,
    "user_id" TEXT,
    "clickup_user_id" TEXT,
    "designation" TEXT NOT NULL,
    "grade" TEXT,
    "department" TEXT,
    "team_id" TEXT,
    "manager_id" TEXT,
    "join_date" DATE NOT NULL,
    "confirmation_date" DATE,
    "exit_date" DATE,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'PROBATION',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_events" (
    "id" BIGSERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "EmploymentEventType" NOT NULL,
    "effective_date" DATE NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_days" (
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "first_in" TIMESTAMPTZ(6),
    "last_out" TIMESTAMPTZ(6),
    "minutes_in_office" INTEGER,
    "source" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("employee_id","date")
);

-- CreateTable
CREATE TABLE "leave_records" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_clickup_user_id_key" ON "employees"("clickup_user_id");

-- CreateIndex
CREATE INDEX "employees_org_id_status_idx" ON "employees"("org_id", "status");

-- CreateIndex
CREATE INDEX "employees_team_id_idx" ON "employees"("team_id");

-- CreateIndex
CREATE INDEX "employees_manager_id_idx" ON "employees"("manager_id");

-- CreateIndex
CREATE INDEX "employment_events_employee_id_effective_date_idx" ON "employment_events"("employee_id", "effective_date");

-- CreateIndex
CREATE INDEX "attendance_days_date_idx" ON "attendance_days"("date");

-- CreateIndex
CREATE INDEX "leave_records_employee_id_start_date_idx" ON "leave_records"("employee_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_records_source_external_id_key" ON "leave_records"("source", "external_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_events" ADD CONSTRAINT "employment_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_records" ADD CONSTRAINT "leave_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
