CREATE TABLE `oauth_refresh_token_uses` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`used_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_uses_expiry_idx` ON `oauth_refresh_token_uses` (`expires_at`);
