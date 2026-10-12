-- The exit checklist follows the company's manual Employee-Exit-Checklist: two groups (process
-- tasks, company assets), and an item can be marked Not applicable instead of Done. Existing rows
-- become PROCESS items with no key and stay as they were (done or open).

-- CreateEnum
CREATE TYPE "ExitChecklistGroup" AS ENUM ('PROCESS', 'ASSETS');

-- AlterTable
ALTER TABLE "exit_clearance_items" ADD COLUMN     "group_kind" "ExitChecklistGroup" NOT NULL DEFAULT 'PROCESS',
ADD COLUMN     "key" TEXT,
ADD COLUMN     "not_applicable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "not_applicable_at" TIMESTAMP(3),
ADD COLUMN     "not_applicable_by" TEXT;

-- CreateIndex
-- A seeded item's key (e.g. `exit_interview`) is unique within its exit. Custom items have a NULL
-- key, and Postgres treats NULLs as distinct, so any number of them can coexist.
CREATE UNIQUE INDEX "exit_clearance_items_exit_id_key_key" ON "exit_clearance_items"("exit_id", "key");
