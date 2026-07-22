CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_members_user_org_idx` ON `organization_members` (`user_id`,`organization_id`);
--> statement-breakpoint
CREATE TABLE `aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`local_part` text NOT NULL,
	`target_mailbox_id` text,
	`forward_to` text,
	`is_group` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aliases_address_idx` ON `aliases` (`domain_id`,`local_part`);
--> statement-breakpoint
CREATE TABLE `group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`alias_id` text NOT NULL,
	`user_id` text,
	`email` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`alias_id`) REFERENCES `aliases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `organization_id` text REFERENCES organizations(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `domains` ADD `organization_id` text REFERENCES organizations(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `organization_id` text REFERENCES organizations(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `contacts` ADD `organization_id` text REFERENCES organizations(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `api_keys` ADD `organization_id` text REFERENCES organizations(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `messages` ADD `organization_id` text REFERENCES organizations(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `outbound_jobs` ADD `organization_id` text REFERENCES organizations(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `routing_rules` ADD `organization_id` text REFERENCES organizations(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `webhooks` ADD `organization_id` text REFERENCES organizations(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `organization_id` text REFERENCES organizations(id) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `domains_org_idx` ON `domains` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `mailboxes_org_idx` ON `mailboxes` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `contacts_org_idx` ON `contacts` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `messages_org_idx` ON `messages` (`organization_id`);
