-- prisma/migrations/0017_assignee_rate_no_overlap/migration.sql
-- Invariant: at most one active rate per assignee (no overlapping [valid_from, valid_to]).

-- btree_gist lets a GiST exclusion constraint mix `=` (assignee_id) with `&&` (range).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Normalize any pre-existing overlaps first: an EXCLUDE constraint cannot be added
-- while violating rows exist (no NOT VALID for exclusion constraints). For each
-- assignee, cap every row that runs into the next row's start at (next start - 1 day).
-- The (assignee_id, valid_from) unique key guarantees next_from > valid_from, so the
-- capped range stays valid.
WITH ordered AS (
  SELECT rate_id,
         valid_to,
         LEAD(valid_from) OVER (PARTITION BY assignee_id ORDER BY valid_from) AS next_from
  FROM assignee_rates
)
UPDATE assignee_rates r
SET valid_to = o.next_from - 1
FROM ordered o
WHERE r.rate_id = o.rate_id
  AND o.next_from IS NOT NULL
  AND (r.valid_to IS NULL OR r.valid_to >= o.next_from);

-- Enforce the invariant for every write path (API, imports, concurrency).
ALTER TABLE assignee_rates
  ADD CONSTRAINT no_overlapping_rates
  EXCLUDE USING gist (
    assignee_id WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  );
