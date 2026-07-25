-- Sessions issued before this migration have no lookup digest and cannot gain one,
-- because the plaintext token is never stored. They are removed rather than kept
-- behind a fallback scan, which would preserve the linear cost this replaces.
-- Everyone signs in once more.
DELETE FROM `sessions`;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `token_lookup` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_lookup_idx` ON `sessions` (`token_lookup`);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `routing_rules_domain_idx` ON `routing_rules` (`domain_id`);
--> statement-breakpoint
CREATE INDEX `routing_rules_org_idx` ON `routing_rules` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `message_filters_user_idx` ON `message_filters` (`user_id`);
--> statement-breakpoint
CREATE INDEX `attachments_message_idx` ON `attachments` (`message_id`);
--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);
--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_idx` ON `password_reset_tokens` (`user_id`);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_idx` ON `webhook_deliveries` (`webhook_id`);
--> statement-breakpoint
CREATE INDEX `messages_mailbox_created_idx` ON `messages` (`mailbox_id`,`created_at`);
