ALTER TABLE `messages` ADD `attachment_status` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `messages` ADD `attachment_error` text;
