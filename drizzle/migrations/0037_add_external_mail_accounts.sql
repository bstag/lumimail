CREATE TABLE `external_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`approving_session_id` text NOT NULL,
	`provider` text NOT NULL CHECK (`provider` IN ('google', 'microsoft')),
	`external_address` text COLLATE NOCASE NOT NULL,
	`token_ciphertext` text NOT NULL,
	`token_iv` text NOT NULL,
	`token_key_id` text NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('connecting', 'initial_sync', 'active', 'paused', 'reconnect_required', 'resync_required', 'error', 'disconnected')),
	`import_mode` text NOT NULL CHECK (`import_mode` IN ('from_now', 'recent_30_days')),
	`retain_original` integer NOT NULL DEFAULT 0,
	`last_sync_at` integer,
	`last_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_accounts_mailbox_provider_address_idx` ON `external_accounts` (`mailbox_id`,`provider`,`external_address`);
--> statement-breakpoint
CREATE INDEX `external_accounts_owner_org_status_idx` ON `external_accounts` (`owner_user_id`,`organization_id`,`status`);
--> statement-breakpoint
CREATE INDEX `external_accounts_due_sync_idx` ON `external_accounts` (`status`,`last_sync_at`);
--> statement-breakpoint
CREATE TABLE `external_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`state_hash` text NOT NULL,
	`organization_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`user_id` text NOT NULL,
	`approving_session_id` text NOT NULL,
	`provider` text NOT NULL CHECK (`provider` IN ('google', 'microsoft')),
	`import_mode` text NOT NULL CHECK (`import_mode` IN ('from_now', 'recent_30_days')),
	`retain_original` integer NOT NULL DEFAULT 0,
	`verifier_ciphertext` text NOT NULL,
	`verifier_iv` text NOT NULL,
	`verifier_key_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approving_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_oauth_states_hash_idx` ON `external_oauth_states` (`state_hash`);
--> statement-breakpoint
CREATE INDEX `external_oauth_states_expiry_idx` ON `external_oauth_states` (`expires_at`,`used_at`);
--> statement-breakpoint
CREATE TABLE `external_sync_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remote_folder_key` text NOT NULL,
	`cursor_type` text NOT NULL CHECK (`cursor_type` IN ('gmail_history', 'microsoft_delta')),
	`cursor_ciphertext` text NOT NULL,
	`cursor_iv` text NOT NULL,
	`cursor_key_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `external_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_sync_cursors_account_folder_idx` ON `external_sync_cursors` (`account_id`,`remote_folder_key`);
--> statement-breakpoint
CREATE TABLE `external_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remote_message_id` text NOT NULL,
	`remote_thread_id` text,
	`remote_folder_key` text NOT NULL,
	`lumimail_message_id` text NOT NULL,
	`remote_revision` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `external_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lumimail_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_messages_account_remote_idx` ON `external_messages` (`account_id`,`remote_message_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_messages_account_lumimail_idx` ON `external_messages` (`account_id`,`lumimail_message_id`);
--> statement-breakpoint
CREATE INDEX `external_messages_lumimail_idx` ON `external_messages` (`lumimail_message_id`);
--> statement-breakpoint
CREATE TABLE `external_sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL CHECK (`kind` IN ('initial', 'incremental', 'resync', 'reconcile')),
	`status` text NOT NULL CHECK (`status` IN ('pending', 'processing', 'completed', 'failed')),
	`attempts` integer NOT NULL DEFAULT 0,
	`next_attempt_at` integer NOT NULL,
	`lease_until` integer,
	`error_code` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `external_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `external_sync_jobs_due_idx` ON `external_sync_jobs` (`status`,`next_attempt_at`);
--> statement-breakpoint
CREATE INDEX `external_sync_jobs_account_status_idx` ON `external_sync_jobs` (`account_id`,`status`);
--> statement-breakpoint
CREATE TABLE `external_originals` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remote_message_id` text NOT NULL,
	`lumimail_message_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`retained_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `external_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lumimail_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_originals_account_remote_idx` ON `external_originals` (`account_id`,`remote_message_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_originals_message_idx` ON `external_originals` (`lumimail_message_id`);
--> statement-breakpoint
UPDATE `external_accounts` SET `last_sync_at` = `last_sync_at` / 1000 WHERE `last_sync_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_accounts` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_accounts` SET `updated_at` = `updated_at` / 1000 WHERE `updated_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_accounts` SET `revoked_at` = `revoked_at` / 1000 WHERE `revoked_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_oauth_states` SET `expires_at` = `expires_at` / 1000 WHERE `expires_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_oauth_states` SET `used_at` = `used_at` / 1000 WHERE `used_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_oauth_states` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_sync_cursors` SET `updated_at` = `updated_at` / 1000 WHERE `updated_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_messages` SET `first_seen_at` = `first_seen_at` / 1000 WHERE `first_seen_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_messages` SET `last_seen_at` = `last_seen_at` / 1000 WHERE `last_seen_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_messages` SET `removed_at` = `removed_at` / 1000 WHERE `removed_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_sync_jobs` SET `next_attempt_at` = `next_attempt_at` / 1000 WHERE `next_attempt_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_sync_jobs` SET `lease_until` = `lease_until` / 1000 WHERE `lease_until` > 100000000000;
--> statement-breakpoint
UPDATE `external_sync_jobs` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_sync_jobs` SET `completed_at` = `completed_at` / 1000 WHERE `completed_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_originals` SET `retained_at` = `retained_at` / 1000 WHERE `retained_at` > 100000000000;
