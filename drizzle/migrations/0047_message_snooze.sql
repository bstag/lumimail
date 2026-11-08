-- Snooze (F100): received mail hidden from the Inbox until this time, then shown first.
ALTER TABLE `messages` ADD `snoozed_until` integer;
--> statement-breakpoint
CREATE INDEX `messages_snoozed_idx` ON `messages` (`snoozed_until`) WHERE "messages"."snoozed_until" is not null;
--> statement-breakpoint
-- Follow the timestamp normalization contract for the new column.
UPDATE `messages` SET `snoozed_until` = `snoozed_until` / 1000 WHERE `snoozed_until` > 100000000000;
