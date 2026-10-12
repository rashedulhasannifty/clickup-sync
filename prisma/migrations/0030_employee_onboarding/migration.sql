-- People: joining (onboarding) checklist. Spec: docs/superpowers/specs/2026-10-07-people-attendance-design.md
-- Generated with `prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema.prisma --script`,
-- plus the hand-written CHECK at the end (Prisma does not model check constraints).
--
-- NOMINEE is added to DocumentCategory but deliberately not USED anywhere in this migration:
-- Postgres cannot use a new enum value in the same transaction that adds it.

-- CreateEnum
CREATE TYPE "OnboardingGroup" AS ENUM ('DOCUMENTS', 'EQUIPMENT', 'ACCOUNTS', 'WELCOME');

-- AlterEnum
ALTER TYPE "DocumentCategory" ADD VALUE 'NOMINEE';

-- CreateTable
CREATE TABLE "onboarding_items" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "group" "OnboardingGroup" NOT NULL,
    "key" TEXT,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "done_by" TEXT,
    "done_at" TIMESTAMP(3),
    "not_applicable" BOOLEAN NOT NULL DEFAULT false,
    "not_applicable_by" TEXT,
    "not_applicable_at" TIMESTAMP(3),
    "note" TEXT,
    "detail" TEXT,
    "document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onboarding_items_employee_id_position_idx" ON "onboarding_items"("employee_id", "position");

-- CreateIndex
CREATE INDEX "onboarding_items_document_id_idx" ON "onboarding_items"("document_id");

-- CreateIndex
-- (employee_id, key): NULL keys (custom items) are distinct, so this only stops a seeded item twice.
CREATE UNIQUE INDEX "onboarding_items_employee_id_key_key" ON "onboarding_items"("employee_id", "key");

-- AddForeignKey
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "employee_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Done and N/A are mutually exclusive (the service enforces it too; this makes a bad row impossible).
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_done_xor_na" CHECK (NOT ("done" AND "not_applicable"));
