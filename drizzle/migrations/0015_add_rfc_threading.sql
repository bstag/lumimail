ALTER TABLE `messages` ADD `rfc_message_id` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `in_reply_to` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `references_header` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `reply_source_message_id` text;
--> statement-breakpoint
CREATE INDEX `messages_mailbox_rfc_message_idx` ON `messages` (`mailbox_id`,`rfc_message_id`);
