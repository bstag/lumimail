CREATE TABLE `mailbox_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_memberships_mailbox_user_idx` ON `mailbox_memberships` (`mailbox_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `mailbox_memberships_user_mailbox_idx` ON `mailbox_memberships` (`user_id`,`mailbox_id`);
--> statement-breakpoint
CREATE INDEX `mailbox_memberships_mailbox_role_idx` ON `mailbox_memberships` (`mailbox_id`,`role`);
--> statement-breakpoint
INSERT INTO `mailbox_memberships` (`id`, `mailbox_id`, `user_id`, `role`, `created_at`, `updated_at`)
SELECT 'mbm_' || lower(hex(randomblob(12))), `id`, `user_id`, 'manager', unixepoch(), unixepoch()
FROM `mailboxes`
WHERE `organization_id` IS NOT NULL
ON CONFLICT (`mailbox_id`, `user_id`) DO NOTHING;
--> statement-breakpoint
UPDATE `messages`
SET `organization_id` = (
	SELECT `mailboxes`.`organization_id`
	FROM `mailboxes`
	WHERE `mailboxes`.`id` = `messages`.`mailbox_id`
)
WHERE `mailbox_id` IS NOT NULL AND `organization_id` IS NULL;
