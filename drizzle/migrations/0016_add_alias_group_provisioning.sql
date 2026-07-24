ALTER TABLE `aliases` ADD `cloudflare_rule_id` text;
--> statement-breakpoint
ALTER TABLE `group_members` ADD `mailbox_id` text REFERENCES `mailboxes`(`id`) ON DELETE cascade;
--> statement-breakpoint
UPDATE `group_members`
SET `mailbox_id` = (
	SELECT `mailboxes`.`id`
	FROM `mailboxes`
	INNER JOIN `aliases` ON `aliases`.`id` = `group_members`.`alias_id`
	WHERE `mailboxes`.`user_id` = `group_members`.`user_id`
		AND `mailboxes`.`domain_id` = `aliases`.`domain_id`
	LIMIT 1
)
WHERE `group_members`.`user_id` IS NOT NULL
	AND (
		SELECT COUNT(*)
		FROM `mailboxes`
		INNER JOIN `aliases` ON `aliases`.`id` = `group_members`.`alias_id`
		WHERE `mailboxes`.`user_id` = `group_members`.`user_id`
			AND `mailboxes`.`domain_id` = `aliases`.`domain_id`
	) = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX `group_members_alias_mailbox_idx`
	ON `group_members` (`alias_id`, `mailbox_id`);
--> statement-breakpoint
CREATE INDEX `group_members_mailbox_idx` ON `group_members` (`mailbox_id`);
