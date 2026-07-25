CREATE TABLE `vacation_responders_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`subject` text DEFAULT 'Out of office' NOT NULL,
	`body` text DEFAULT 'I am currently out of office and will reply when I return.' NOT NULL,
	`start_date` integer,
	`end_date` integer,
	`reply_to_contacts` integer DEFAULT false NOT NULL,
	`reply_to_organization` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Fan each existing per-user responder out to every mailbox that user owns, which
-- is exactly the set that was already auto-replying. Observable behavior is
-- unchanged by the migration; narrowing it is then a deliberate act in the UI.
INSERT INTO `vacation_responders_new` (
	`id`, `user_id`, `mailbox_id`, `enabled`, `subject`, `body`,
	`start_date`, `end_date`, `reply_to_contacts`, `reply_to_organization`, `updated_at`
)
SELECT
	'vac_' || lower(hex(randomblob(12))),
	v.`user_id`,
	m.`id`,
	v.`enabled`,
	v.`subject`,
	v.`body`,
	v.`start_date`,
	v.`end_date`,
	v.`reply_to_contacts`,
	v.`reply_to_organization`,
	v.`updated_at`
FROM `vacation_responders` v
JOIN `mailboxes` m ON m.`user_id` = v.`user_id`;
--> statement-breakpoint
DROP TABLE `vacation_responders`;
--> statement-breakpoint
ALTER TABLE `vacation_responders_new` RENAME TO `vacation_responders`;
--> statement-breakpoint
CREATE UNIQUE INDEX `vacation_responders_mailbox_id_unique` ON `vacation_responders` (`mailbox_id`);
--> statement-breakpoint
CREATE TABLE `vacation_reply_log_new` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`sender_address` text NOT NULL,
	`last_replied_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Fan the reply history out the same way. Carrying "already replied" to every
-- mailbox is the conservative direction: it can only suppress a duplicate notice,
-- never cause an unexpected one immediately after the migration.
INSERT INTO `vacation_reply_log_new` (`id`, `mailbox_id`, `sender_address`, `last_replied_at`)
SELECT
	'vrl_' || lower(hex(randomblob(12))),
	m.`id`,
	l.`sender_address`,
	l.`last_replied_at`
FROM `vacation_reply_log` l
JOIN `mailboxes` m ON m.`user_id` = l.`user_id`;
--> statement-breakpoint
DROP TABLE `vacation_reply_log`;
--> statement-breakpoint
ALTER TABLE `vacation_reply_log_new` RENAME TO `vacation_reply_log`;
--> statement-breakpoint
CREATE UNIQUE INDEX `vacation_reply_log_mailbox_sender_idx` ON `vacation_reply_log` (`mailbox_id`,`sender_address`);
--> statement-breakpoint
UPDATE `vacation_reply_log` SET `last_replied_at` = `last_replied_at` / 1000 WHERE `last_replied_at` > 100000000000;
