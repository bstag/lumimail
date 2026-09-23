ALTER TABLE webhook_deliveries ADD COLUMN next_attempt_at integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Historical pending attempts have an unknown external outcome. Do not replay them.
UPDATE webhook_deliveries SET status = 'failed' WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (status, next_attempt_at);
