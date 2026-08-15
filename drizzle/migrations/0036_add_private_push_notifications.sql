CREATE TABLE `push_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`approving_session_id` text NOT NULL,
	`name` text NOT NULL,
	`endpoint` text NOT NULL,
	`endpoint_hash` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`status` text NOT NULL DEFAULT 'active',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_delivered_at` integer,
	`revoked_at` integer,
	`expired_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approving_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_devices_endpoint_hash_idx` ON `push_devices` (`endpoint_hash`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `push_devices_active_session_idx` ON `push_devices` (`approving_session_id`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX `push_devices_user_org_status_idx` ON `push_devices` (`user_id`,`organization_id`,`status`);
--> statement-breakpoint
CREATE INDEX `push_devices_cleanup_idx` ON `push_devices` (`status`,`revoked_at`,`expired_at`);
--> statement-breakpoint
CREATE TABLE `push_device_mailboxes` (
	`device_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `push_devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_device_mailboxes_pair_idx` ON `push_device_mailboxes` (`device_id`,`mailbox_id`);
--> statement-breakpoint
CREATE INDEX `push_device_mailboxes_mailbox_idx` ON `push_device_mailboxes` (`mailbox_id`,`device_id`);
--> statement-breakpoint
CREATE TABLE `push_notification_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`message_id` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`expansion_cursor` text,
	`attempts` integer NOT NULL DEFAULT 0,
	`next_attempt_at` integer NOT NULL,
	`lease_until` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_notification_events_message_idx` ON `push_notification_events` (`message_id`);
--> statement-breakpoint
CREATE INDEX `push_notification_events_due_idx` ON `push_notification_events` (`status`,`next_attempt_at`);
--> statement-breakpoint
CREATE TABLE `push_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`device_id` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`attempts` integer NOT NULL DEFAULT 0,
	`next_attempt_at` integer NOT NULL,
	`lease_until` integer,
	`provider_outcome` text,
	`created_at` integer NOT NULL,
	`delivered_at` integer,
	`terminal_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `push_notification_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `push_devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_deliveries_event_device_idx` ON `push_deliveries` (`event_id`,`device_id`);
--> statement-breakpoint
CREATE INDEX `push_deliveries_due_idx` ON `push_deliveries` (`status`,`next_attempt_at`);
--> statement-breakpoint
CREATE INDEX `push_deliveries_cleanup_idx` ON `push_deliveries` (`status`,`terminal_at`);
--> statement-breakpoint
UPDATE `push_devices` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_devices` SET `updated_at` = `updated_at` / 1000 WHERE `updated_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_devices` SET `last_delivered_at` = `last_delivered_at` / 1000 WHERE `last_delivered_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_devices` SET `revoked_at` = `revoked_at` / 1000 WHERE `revoked_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_devices` SET `expired_at` = `expired_at` / 1000 WHERE `expired_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_device_mailboxes` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_notification_events` SET `next_attempt_at` = `next_attempt_at` / 1000 WHERE `next_attempt_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_notification_events` SET `lease_until` = `lease_until` / 1000 WHERE `lease_until` > 100000000000;
--> statement-breakpoint
UPDATE `push_notification_events` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_notification_events` SET `completed_at` = `completed_at` / 1000 WHERE `completed_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_deliveries` SET `next_attempt_at` = `next_attempt_at` / 1000 WHERE `next_attempt_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_deliveries` SET `lease_until` = `lease_until` / 1000 WHERE `lease_until` > 100000000000;
--> statement-breakpoint
UPDATE `push_deliveries` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_deliveries` SET `delivered_at` = `delivered_at` / 1000 WHERE `delivered_at` > 100000000000;
--> statement-breakpoint
UPDATE `push_deliveries` SET `terminal_at` = `terminal_at` / 1000 WHERE `terminal_at` > 100000000000;
