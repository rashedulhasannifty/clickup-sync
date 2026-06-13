-- Relabel mislabeled USD time entries.
--
-- The business operates in USD and every assignee_rates row is USD, but the
-- cost calculator historically defaulted the `currency` of NO_RATE_FOUND
-- entries to 'AUD'. Those rows have cost_cents = 0, so this is a pure label
-- correction (no cost recomputation needed). The cost-calculator default is
-- fixed to 'USD' in the same change, so no new 'AUD' rows will be written.
UPDATE "clickup_time_entries"
SET "currency" = 'USD'
WHERE "currency" = 'AUD';
