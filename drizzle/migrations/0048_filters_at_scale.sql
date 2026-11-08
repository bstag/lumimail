-- Filters at scale (F101): any-of matching, Focused/Other override, and expiring mail.
ALTER TABLE `message_filters` ADD `match_mode` text DEFAULT 'all' NOT NULL;
--> statement-breakpoint
ALTER TABLE `message_filters` ADD `action_focus` text;
--> statement-breakpoint
ALTER TABLE `message_filters` ADD `action_expire_days` integer;
--> statement-breakpoint
ALTER TABLE `messages` ADD `focus_override` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `expires_at` integer;
--> statement-breakpoint
CREATE INDEX `messages_expires_idx` ON `messages` (`expires_at`) WHERE "messages"."expires_at" is not null;
--> statement-breakpoint
-- Follow the timestamp normalization contract for the new column.
UPDATE `messages` SET `expires_at` = `expires_at` / 1000 WHERE `expires_at` > 100000000000;
