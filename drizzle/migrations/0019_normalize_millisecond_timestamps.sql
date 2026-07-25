UPDATE `aliases` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `api_keys` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `api_keys` SET `last_used_at` = `last_used_at` / 1000 WHERE `last_used_at` > 100000000000;
--> statement-breakpoint
UPDATE `api_keys` SET `revoked_at` = `revoked_at` / 1000 WHERE `revoked_at` > 100000000000;
--> statement-breakpoint
UPDATE `attachments` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `contacts` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `contacts` SET `last_seen_at` = `last_seen_at` / 1000 WHERE `last_seen_at` > 100000000000;
--> statement-breakpoint
UPDATE `domains` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `forwarding_destinations` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `forwarding_destinations` SET `last_checked_at` = `last_checked_at` / 1000 WHERE `last_checked_at` > 100000000000;
--> statement-breakpoint
UPDATE `forwarding_destinations` SET `updated_at` = `updated_at` / 1000 WHERE `updated_at` > 100000000000;
--> statement-breakpoint
UPDATE `forwarding_destinations` SET `verified_at` = `verified_at` / 1000 WHERE `verified_at` > 100000000000;
--> statement-breakpoint
UPDATE `group_members` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `labels` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `mailbox_memberships` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `mailbox_memberships` SET `updated_at` = `updated_at` / 1000 WHERE `updated_at` > 100000000000;
--> statement-breakpoint
UPDATE `mailboxes` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `message_filters` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `messages` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `org_invites` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `org_invites` SET `expires_at` = `expires_at` / 1000 WHERE `expires_at` > 100000000000;
--> statement-breakpoint
UPDATE `organization_members` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `organizations` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `organizations` SET `updated_at` = `updated_at` / 1000 WHERE `updated_at` > 100000000000;
--> statement-breakpoint
UPDATE `outbound_jobs` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `outbound_jobs` SET `last_attempt_at` = `last_attempt_at` / 1000 WHERE `last_attempt_at` > 100000000000;
--> statement-breakpoint
UPDATE `outbound_jobs` SET `recovered_at` = `recovered_at` / 1000 WHERE `recovered_at` > 100000000000;
--> statement-breakpoint
UPDATE `outbound_jobs` SET `updated_at` = `updated_at` / 1000 WHERE `updated_at` > 100000000000;
--> statement-breakpoint
UPDATE `password_reset_tokens` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `password_reset_tokens` SET `expires_at` = `expires_at` / 1000 WHERE `expires_at` > 100000000000;
--> statement-breakpoint
UPDATE `queue_health_snapshots` SET `checked_at` = `checked_at` / 1000 WHERE `checked_at` > 100000000000;
--> statement-breakpoint
UPDATE `queue_health_snapshots` SET `oldest_message_at` = `oldest_message_at` / 1000 WHERE `oldest_message_at` > 100000000000;
--> statement-breakpoint
UPDATE `routing_rules` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `sessions` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `sessions` SET `expires_at` = `expires_at` / 1000 WHERE `expires_at` > 100000000000;
--> statement-breakpoint
UPDATE `users` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `vacation_responders` SET `end_date` = `end_date` / 1000 WHERE `end_date` > 100000000000;
--> statement-breakpoint
UPDATE `vacation_responders` SET `start_date` = `start_date` / 1000 WHERE `start_date` > 100000000000;
--> statement-breakpoint
UPDATE `vacation_responders` SET `updated_at` = `updated_at` / 1000 WHERE `updated_at` > 100000000000;
--> statement-breakpoint
UPDATE `webhook_deliveries` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `webhooks` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
