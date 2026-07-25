ALTER TABLE `outbound_jobs` ADD `recovered_at` integer;
--> statement-breakpoint
ALTER TABLE `outbound_jobs` ADD `recovery_count` integer DEFAULT 0 NOT NULL;
