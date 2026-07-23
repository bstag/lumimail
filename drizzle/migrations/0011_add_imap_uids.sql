ALTER TABLE `messages` ADD `imap_uid` integer;
--> statement-breakpoint
CREATE TABLE `imap_uid_counter` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `imap_uid_counter` (`id`, `value`) VALUES (1, 0);
--> statement-breakpoint
UPDATE `messages`
SET `imap_uid` = (
	SELECT `numbered`.`uid`
	FROM (
		SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at`, `id`) AS `uid`
		FROM `messages`
	) AS `numbered`
	WHERE `numbered`.`id` = `messages`.`id`
);
--> statement-breakpoint
UPDATE `imap_uid_counter`
SET `value` = COALESCE((SELECT MAX(`imap_uid`) FROM `messages`), 0)
WHERE `id` = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_imap_uid_idx` ON `messages` (`imap_uid`);
--> statement-breakpoint
CREATE TRIGGER `messages_assign_imap_uid`
AFTER INSERT ON `messages`
WHEN NEW.`imap_uid` IS NULL
BEGIN
	UPDATE `imap_uid_counter` SET `value` = `value` + 1 WHERE `id` = 1;
	UPDATE `messages`
	SET `imap_uid` = (SELECT `value` FROM `imap_uid_counter` WHERE `id` = 1)
	WHERE `id` = NEW.`id`;
END;
