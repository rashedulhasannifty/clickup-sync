-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "clickup_api_token_enc" TEXT,
    "webhook_secret_enc" TEXT,
    "clickup_team_id" TEXT,
    "webhook_endpoint" TEXT,
    "webhook_events" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);
