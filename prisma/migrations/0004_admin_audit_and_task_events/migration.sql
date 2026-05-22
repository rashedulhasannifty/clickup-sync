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
