# Grafana starter queries

## Last webhook received

```sql
SELECT max(received_at) AS last_webhook_received_at
FROM clickup_webhook_events;
```

## Webhook events by type

```sql
SELECT event_type, count(*)
FROM clickup_webhook_events
WHERE received_at > now() - interval '24 hours'
GROUP BY event_type
ORDER BY count(*) DESC;
```

## Failed jobs

```sql
SELECT queue_name, job_name, count(*)
FROM sync_job_logs
WHERE status = 'failed'
  AND created_at > now() - interval '7 days'
GROUP BY queue_name, job_name
ORDER BY count(*) DESC;
```

## Time entries missing rates

```sql
SELECT user_name, count(*) AS entries, sum(duration_hours) AS hours
FROM clickup_time_entries
WHERE status = 'NO_RATE_FOUND'
GROUP BY user_name
ORDER BY entries DESC;
```

## Cost by client

```sql
SELECT t.client, sum(e.cost_cents) / 100.0 AS cost
FROM clickup_time_entries e
JOIN clickup_tasks t ON t.task_id = e.task_id
WHERE e.start_time >= date_trunc('month', now())
GROUP BY t.client
ORDER BY cost DESC;
```
