ALTER TABLE `outbound_jobs` ADD `attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `outbound_jobs` ADD `delivery_token` text;
--> statement-breakpoint
ALTER TABLE `outbound_jobs` ADD `last_attempt_at` integer;
--> statement-breakpoint
CREATE INDEX `outbound_jobs_status_updated_idx` ON `outbound_jobs` (`status`,`updated_at`);
