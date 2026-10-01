ALTER TABLE `external_sync_jobs` ADD `suspect_message_id` text;
--> statement-breakpoint
ALTER TABLE `external_sync_jobs` ADD `strike_message_id` text;
--> statement-breakpoint
ALTER TABLE `external_sync_jobs` ADD `strike_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `external_sync_jobs` ADD `failure_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `external_accounts` ADD `error_retry_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `external_accounts` ADD `next_retry_at` integer;
--> statement-breakpoint
CREATE INDEX `external_accounts_retry_due_idx` ON `external_accounts` (`status`,`next_retry_at`);
--> statement-breakpoint
CREATE TABLE `external_message_skips` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remote_message_id` text NOT NULL,
	`remote_folder_key` text NOT NULL,
	`reason` text NOT NULL CHECK (`reason` IN ('too_large', 'repeated_failure')),
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `external_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_message_skips_account_remote_idx` ON `external_message_skips` (`account_id`,`remote_message_id`);
--> statement-breakpoint
UPDATE `external_accounts` SET `next_retry_at` = `next_retry_at` / 1000 WHERE `next_retry_at` > 100000000000;
--> statement-breakpoint
UPDATE `external_message_skips` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
