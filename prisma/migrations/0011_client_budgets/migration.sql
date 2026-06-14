-- Per-client effective-dated monthly budgets. Mirrors assignee_rates:
-- closed-closed [valid_from, valid_to] interval, latest valid_from wins on overlap.
CREATE TABLE IF NOT EXISTS client_budgets (
  budget_id BIGSERIAL PRIMARY KEY,
  client TEXT NOT NULL,
  monthly_amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  valid_from DATE NOT NULL,
  valid_to DATE,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_budgets_client_valid_from_key UNIQUE (client, valid_from)
);
CREATE INDEX IF NOT EXISTS idx_client_budgets_lookup ON client_budgets(client, valid_from, valid_to);
