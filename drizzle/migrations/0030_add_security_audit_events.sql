CREATE TABLE `security_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`affected_count` integer NOT NULL,
	`request_id` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `security_audit_events_org_created_idx` ON `security_audit_events` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_audit_events_request_idx` ON `security_audit_events` (`request_id`);
--> statement-breakpoint
UPDATE `security_audit_events` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
