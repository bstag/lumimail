CREATE TABLE `inbound_deliveries` (
	`raw_r2_key` text NOT NULL,
	`mailbox_id` text NOT NULL REFERENCES `mailboxes`(`id`) ON DELETE cascade,
	`message_id` text REFERENCES `messages`(`id`) ON DELETE set null,
	`push_event_id` text,
	`stage` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_deliveries_raw_mailbox_idx` ON `inbound_deliveries` (`raw_r2_key`, `mailbox_id`);
--> statement-breakpoint
CREATE INDEX `inbound_deliveries_message_idx` ON `inbound_deliveries` (`message_id`);
--> statement-breakpoint
CREATE INDEX `inbound_deliveries_stage_created_idx` ON `inbound_deliveries` (`stage`, `created_at`);
--> statement-breakpoint
ALTER TABLE `message_bodies` ADD `repair_attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `message_bodies` ADD `repair_lease_until` integer;
--> statement-breakpoint
CREATE INDEX `message_bodies_raw_r2_key_idx` ON `message_bodies` (`raw_r2_key`) WHERE `raw_r2_key` is not null;
--> statement-breakpoint
CREATE INDEX `attachments_r2_key_idx` ON `attachments` (`r2_key`);
--> statement-breakpoint
CREATE TABLE `r2_retention_cursors` (
	`prefix` text PRIMARY KEY NOT NULL,
	`cursor` text
);
--> statement-breakpoint
-- Preserve message IDs for deliveries in flight when the new Worker is deployed.
INSERT OR IGNORE INTO `inbound_deliveries` (`raw_r2_key`, `mailbox_id`, `message_id`, `push_event_id`, `stage`, `created_at`)
SELECT body.raw_r2_key, msg.mailbox_id, msg.id, event.id, 'filters', msg.created_at
FROM message_bodies AS body
JOIN messages AS msg ON msg.id = body.message_id
LEFT JOIN push_notification_events AS event ON event.message_id = msg.id
WHERE body.raw_r2_key LIKE 'inbound/%' AND msg.direction = 'inbound' AND msg.mailbox_id IS NOT NULL
ORDER BY msg.created_at, msg.id;
--> statement-breakpoint
UPDATE `inbound_deliveries` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `message_bodies` SET `repair_lease_until` = `repair_lease_until` / 1000 WHERE `repair_lease_until` > 100000000000;
