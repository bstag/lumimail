-- F84 fixed, content-free managed-D1 evidence bundle.
-- This file must remain read-only and must never select message/address/token content.

SELECT
  (SELECT COUNT(*) FROM organizations) AS organizations,
  (SELECT COUNT(*) FROM domains) AS domains,
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM mailboxes) AS mailboxes,
  (SELECT COUNT(*) FROM messages) AS messages,
  (SELECT COUNT(*) FROM attachments) AS attachments,
  (SELECT COUNT(*) FROM routing_rules) AS routing_rules,
  (SELECT COUNT(*) FROM sessions) AS sessions,
  (SELECT COUNT(*) FROM outbound_jobs) AS outbound_jobs;

SELECT
  COUNT(*) AS terminal_jobs,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_jobs,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs,
  ROUND(AVG(CASE WHEN status = 'sent' THEN updated_at - created_at END), 3) AS average_sent_seconds,
  MAX(CASE WHEN status = 'sent' THEN updated_at - created_at END) AS maximum_sent_seconds
FROM outbound_jobs
WHERE status IN ('sent', 'failed');

SELECT queue_key, status, backlog_count, stale_job_count, checked_at
FROM queue_health_snapshots
ORDER BY queue_key;

EXPLAIN QUERY PLAN
SELECT id FROM messages
WHERE mailbox_id = '__f84_probe__' AND direction = 'inbound'
ORDER BY created_at DESC LIMIT 25;

EXPLAIN QUERY PLAN
SELECT id FROM messages
WHERE mailbox_id = '__f84_probe__' AND (subject LIKE '%__f84_probe__%' OR snippet LIKE '%__f84_probe__%')
ORDER BY created_at DESC LIMIT 25;

EXPLAIN QUERY PLAN
SELECT id FROM messages
WHERE thread_id = '__f84_probe__'
ORDER BY created_at ASC;

EXPLAIN QUERY PLAN
SELECT id FROM sessions
WHERE token_lookup = '__f84_probe__' AND expires_at > 0
LIMIT 1;

EXPLAIN QUERY PLAN
SELECT id FROM routing_rules
WHERE domain_id = '__f84_probe__'
ORDER BY priority DESC;
