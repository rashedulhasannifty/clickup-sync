-- CreateTable
CREATE TABLE "clickup_lists" (
    "list_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folder_id" TEXT,
    "folder_name" TEXT,
    "space_id" TEXT,
    "space_name" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "start_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clickup_lists_pkey" PRIMARY KEY ("list_id")
);

-- CreateIndex
CREATE INDEX "clickup_lists_folder_id_idx" ON "clickup_lists"("folder_id");

-- CreateIndex
CREATE INDEX "clickup_lists_space_id_idx" ON "clickup_lists"("space_id");

-- CreateIndex
CREATE INDEX "clickup_lists_archived_idx" ON "clickup_lists"("archived");
