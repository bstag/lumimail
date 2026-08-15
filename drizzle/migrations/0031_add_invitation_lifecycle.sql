ALTER TABLE `org_invites` ADD `delivery_status` text DEFAULT 'not_sent' NOT NULL;
--> statement-breakpoint
ALTER TABLE `org_invites` ADD `last_delivery_attempt_at` integer;
--> statement-breakpoint
ALTER TABLE `org_invites` ADD `last_delivered_at` integer;
--> statement-breakpoint
ALTER TABLE `org_invites` ADD `accepted_at` integer;
--> statement-breakpoint
UPDATE `org_invites` SET `last_delivery_attempt_at` = `last_delivery_attempt_at` / 1000 WHERE `last_delivery_attempt_at` > 100000000000;
--> statement-breakpoint
UPDATE `org_invites` SET `last_delivered_at` = `last_delivered_at` / 1000 WHERE `last_delivered_at` > 100000000000;
--> statement-breakpoint
UPDATE `org_invites` SET `accepted_at` = `accepted_at` / 1000 WHERE `accepted_at` > 100000000000;
--> statement-breakpoint
CREATE INDEX `org_invites_org_created_idx` ON `org_invites` (`organization_id`, `created_at`);
