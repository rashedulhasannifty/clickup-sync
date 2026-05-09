CREATE TABLE IF NOT EXISTS clickup_tasks (
  task_id TEXT PRIMARY KEY,
  parent_task_id TEXT,
  task_name TEXT NOT NULL,
  description TEXT,
  url TEXT,
  status TEXT,
  status_type TEXT,
  status_color TEXT,
  priority TEXT,
  order_index INTEGER,
  archived BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_date TIMESTAMPTZ,
  updated_date TIMESTAMPTZ,
  closed_date TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  start_date TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_count INTEGER NOT NULL DEFAULT 0,
  time_estimate BIGINT,
  time_spent BIGINT,
  space_id TEXT,
  space_name TEXT,
  folder_id TEXT,
  folder_name TEXT,
  list_id TEXT,
  list_name TEXT,
  assignees_names TEXT,
  assignees_emails TEXT,
  watchers_names TEXT,
  watchers_emails TEXT,
  creator_id TEXT,
  creator_name TEXT,
  executive_name TEXT,
  department TEXT,
  client TEXT,
  cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  estimation NUMERIC(14,2) NOT NULL DEFAULT 0,
  sprint_name TEXT,
  sprint_points INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  custom_tags TEXT,
  raw JSONB
);

CREATE INDEX IF NOT EXISTS idx_clickup_tasks_parent_task_id ON clickup_tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_clickup_tasks_space_id ON clickup_tasks(space_id);
CREATE INDEX IF NOT EXISTS idx_clickup_tasks_updated_date ON clickup_tasks(updated_date);

CREATE TABLE IF NOT EXISTS assignee_rates (
  rate_id BIGSERIAL PRIMARY KEY,
  assignee_id TEXT NOT NULL,
  assignee_name TEXT,
  assignee_email TEXT,
  currency TEXT NOT NULL DEFAULT 'AUD',
  hourly_rate_cents BIGINT NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assignee_rates_assignee_id_valid_from_key UNIQUE (assignee_id, valid_from)
);
CREATE INDEX IF NOT EXISTS idx_assignee_rates_lookup ON assignee_rates(assignee_id, valid_from, valid_to);

CREATE TABLE IF NOT EXISTS clickup_time_entries (
  time_entry_id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES clickup_tasks(task_id) ON DELETE SET NULL,
  user_id TEXT,
  user_name TEXT,
  user_email TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_hours NUMERIC(12,4) NOT NULL DEFAULT 0,
  billable BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  rate_id BIGINT REFERENCES assignee_rates(rate_id) ON DELETE SET NULL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  hourly_rate_cents BIGINT NOT NULL DEFAULT 0,
  cost_cents BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'SYNCED',
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clickup_time_entries_task_id ON clickup_time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_clickup_time_entries_user_id ON clickup_time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_clickup_time_entries_start_time ON clickup_time_entries(start_time);

CREATE TABLE IF NOT EXISTS clickup_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT UNIQUE NOT NULL,
  event_type TEXT,
  task_id TEXT,
  raw_payload JSONB NOT NULL,
  status TEXT DEFAULT 'received',
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_clickup_webhook_events_event_type ON clickup_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_clickup_webhook_events_task_id ON clickup_webhook_events(task_id);
CREATE INDEX IF NOT EXISTS idx_clickup_webhook_events_received_at ON clickup_webhook_events(received_at);

CREATE TABLE IF NOT EXISTS clickup_webhook_seen (
  fingerprint TEXT PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  last_successful_sync_at TIMESTAMPTZ,
  last_attempted_sync_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS sync_job_logs (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT,
  queue_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  attempts_made INT DEFAULT 0,
  error_message TEXT,
  error_stack TEXT,
  payload JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_job_logs_queue_job ON sync_job_logs(queue_name, job_name);
CREATE INDEX IF NOT EXISTS idx_sync_job_logs_status ON sync_job_logs(status);
CREATE INDEX IF NOT EXISTS idx_sync_job_logs_entity ON sync_job_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id BIGSERIAL PRIMARY KEY,
  queue_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  payload JSONB NOT NULL,
  error_message TEXT,
  error_stack TEXT,
  attempts_made INT,
  failed_at TIMESTAMPTZ DEFAULT NOW(),
  retried_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_queue_job ON dead_letter_jobs(queue_name, job_name);
CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_entity ON dead_letter_jobs(entity_type, entity_id);
