CREATE TABLE `mcp_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`approving_session_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`profile` text NOT NULL CHECK (`profile` IN ('read', 'actions')),
	`scopes` text NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('pending', 'active', 'revoked')),
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_connections_user_status_idx` ON `mcp_connections` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `mcp_connections_session_idx` ON `mcp_connections` (`approving_session_id`);
--> statement-breakpoint
CREATE TABLE `outbound_idempotency` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_type` text NOT NULL CHECK (`principal_type` IN ('mcp')),
	`principal_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`message_id` text NOT NULL,
	`job_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `mcp_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `outbound_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_idempotency_principal_key_idx` ON `outbound_idempotency` (`principal_type`,`principal_id`,`idempotency_key`);
--> statement-breakpoint
UPDATE `mcp_connections` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `mcp_connections` SET `last_used_at` = `last_used_at` / 1000 WHERE `last_used_at` > 100000000000;
--> statement-breakpoint
UPDATE `mcp_connections` SET `revoked_at` = `revoked_at` / 1000 WHERE `revoked_at` > 100000000000;
--> statement-breakpoint
UPDATE `outbound_idempotency` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
