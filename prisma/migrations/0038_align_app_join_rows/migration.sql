-- People: since 0037 the app's own join row drives the join date in the history fold, and a
-- profile join-date edit moves it. Before 0037 a profile edit left the row on the old date, so put
-- every such row back on the employee's join date. Employees with a past-record join are left
-- alone: there the app's row only says when they were added to this system.

UPDATE "employment_events" ev
SET "effective_date" = e."join_date"
FROM "employees" e
WHERE ev."employee_id" = e."id"
  AND ev."source" = 'APP'
  AND ev."type" IN ('JOINED', 'JOINED_AS_INTERN')
  AND ev."effective_date" <> e."join_date"
  AND NOT EXISTS (
    SELECT 1 FROM "employment_events" p
    WHERE p."employee_id" = e."id"
      AND p."source" = 'PAST_RECORD'
      AND p."type" IN ('JOINED', 'JOINED_AS_INTERN')
  );
