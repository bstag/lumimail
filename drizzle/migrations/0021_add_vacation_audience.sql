ALTER TABLE `vacation_responders` ADD `reply_to_contacts` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `vacation_responders` ADD `reply_to_organization` integer DEFAULT false NOT NULL;
