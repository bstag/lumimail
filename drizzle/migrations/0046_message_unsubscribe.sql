-- RFC 2369 / RFC 8058 unsubscribe targets captured at ingest (F98).
ALTER TABLE `messages` ADD `unsubscribe_url` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `unsubscribe_mailto` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `unsubscribe_one_click` integer DEFAULT false NOT NULL;
