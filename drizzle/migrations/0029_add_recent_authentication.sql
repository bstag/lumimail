CREATE TABLE `sessions_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text,
	`token_lookup` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`authenticated_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Session creation is the original password proof. Preserve that exact age so an
-- old session never becomes newly recent merely because this migration ran.
-- Keep the column nullable for rolling-deploy compatibility: the previously
-- deployed Worker can still create sessions between migration and publication.
INSERT INTO `sessions_new` (
	`id`, `user_id`, `organization_id`, `token_lookup`, `token_hash`,
	`expires_at`, `authenticated_at`, `created_at`
)
SELECT
	`id`, `user_id`, `organization_id`, `token_lookup`, `token_hash`,
	`expires_at`, `created_at`, `created_at`
FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `sessions_new` RENAME TO `sessions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_lookup_idx` ON `sessions` (`token_lookup`);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
UPDATE `sessions` SET `authenticated_at` = `authenticated_at` / 1000 WHERE `authenticated_at` > 100000000000;
