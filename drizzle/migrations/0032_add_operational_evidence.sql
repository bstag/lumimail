CREATE TABLE `operational_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`category` text NOT NULL CHECK (`category` IN ('recovery', 'release', 'smoke', 'mail_flow')),
	`outcome` text NOT NULL CHECK (`outcome` IN ('passed', 'failed')),
	`passed_checks` integer NOT NULL CHECK (`passed_checks` >= 0 AND `passed_checks` <= 1000),
	`total_checks` integer NOT NULL CHECK (`total_checks` >= 1 AND `total_checks` <= 1000),
	`observed_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`passed_checks` <= `total_checks`),
	CHECK ((`outcome` = 'passed' AND `passed_checks` = `total_checks`) OR (`outcome` = 'failed' AND `passed_checks` < `total_checks`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operational_evidence_org_category_observed_idx` ON `operational_evidence` (`organization_id`,`category`,`observed_at`);
--> statement-breakpoint
CREATE INDEX `operational_evidence_org_recorded_idx` ON `operational_evidence` (`organization_id`,`recorded_at`);
--> statement-breakpoint
UPDATE `operational_evidence` SET `observed_at` = `observed_at` / 1000 WHERE `observed_at` > 100000000000;
--> statement-breakpoint
UPDATE `operational_evidence` SET `recorded_at` = `recorded_at` / 1000 WHERE `recorded_at` > 100000000000;
--> statement-breakpoint
CREATE TRIGGER `operational_evidence_org_retention` AFTER INSERT ON `operational_evidence`
BEGIN
	DELETE FROM `operational_evidence`
	WHERE `organization_id` = NEW.`organization_id`
		AND `id` IN (
			SELECT `id` FROM `operational_evidence`
			WHERE `organization_id` = NEW.`organization_id`
			ORDER BY `recorded_at` DESC, `id` DESC
			LIMIT -1 OFFSET 200
		);
END;
