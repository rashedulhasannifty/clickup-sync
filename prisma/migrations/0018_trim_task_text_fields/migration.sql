-- prisma/migrations/0018_trim_task_text_fields/migration.sql
-- Backfill: trim stray leading/trailing whitespace from ClickUp-derived text
-- fields on clickup_tasks.
--
-- A ClickUp dropdown option literally named "Call A tradie Pty " (trailing
-- space) was stored verbatim. The dashboard facet counts the padded value
-- (GROUP BY client -> 592), but the Tasks/Time Entries filter TRIMS the value
-- it sends, so `client IN ('Call A tradie Pty')` matched none of the padded
-- rows and both pages showed nothing for that client. custom-field-extractor.ts
-- now trims on ingestion (cleanText); this cleans the rows already stored.
--
-- [[:space:]] matches the same ASCII whitespace set JS String.prototype.trim()
-- strips (space, tab, newline, CR, FF, VT) — the confirmed value is a plain
-- trailing space. Whitespace-only values collapse to NULL to match cleanText().
-- Only rows whose value actually changes are touched; the counts are raised as
-- NOTICEs so the deploy output shows the blast radius.

DO $$
DECLARE
  n int;
BEGIN
  UPDATE clickup_tasks
     SET client = NULLIF(regexp_replace(client, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
   WHERE client IS NOT NULL
     AND client <> regexp_replace(client, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'trim clickup_tasks.client: % row(s) updated', n;

  UPDATE clickup_tasks
     SET department = NULLIF(regexp_replace(department, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
   WHERE department IS NOT NULL
     AND department <> regexp_replace(department, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'trim clickup_tasks.department: % row(s) updated', n;

  UPDATE clickup_tasks
     SET executive_name = NULLIF(regexp_replace(executive_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
   WHERE executive_name IS NOT NULL
     AND executive_name <> regexp_replace(executive_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'trim clickup_tasks.executive_name: % row(s) updated', n;

  UPDATE clickup_tasks
     SET sprint_name = NULLIF(regexp_replace(sprint_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
   WHERE sprint_name IS NOT NULL
     AND sprint_name <> regexp_replace(sprint_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'trim clickup_tasks.sprint_name: % row(s) updated', n;
END $$;
