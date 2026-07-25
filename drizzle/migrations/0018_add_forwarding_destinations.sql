CREATE TABLE `forwarding_destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`address` text NOT NULL,
	`verified_at` integer,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forwarding_destinations_org_address_idx` ON `forwarding_destinations` (`organization_id`,`address`);
