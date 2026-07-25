CREATE TABLE `vacation_reply_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sender_address` text NOT NULL,
	`last_replied_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vacation_reply_log_user_sender_idx` ON `vacation_reply_log` (`user_id`,`sender_address`);
--> statement-breakpoint
-- Keeps this table inside the millisecond-normalization contract established in
-- 0019. A new table cannot hold legacy corruption, but the guard requires every
-- timestamp column to be covered so a later sweep is complete, and 0019 itself
-- must not be edited once applied.
UPDATE `vacation_reply_log` SET `last_replied_at` = `last_replied_at` / 1000 WHERE `last_replied_at` > 100000000000;
