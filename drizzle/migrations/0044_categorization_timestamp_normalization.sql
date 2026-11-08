-- Follow the timestamp normalization contract for all newly introduced columns.
UPDATE `messages` SET `received_at` = `received_at` / 1000 WHERE `received_at` > 100000000000;
--> statement-breakpoint
UPDATE `categorization_versions` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `categorization_preferences` SET `automatic_since` = `automatic_since` / 1000 WHERE `automatic_since` > 100000000000;
--> statement-breakpoint
UPDATE `categorization_preferences` SET `checked_at` = `checked_at` / 1000 WHERE `checked_at` > 100000000000;
--> statement-breakpoint
UPDATE `categorization_results` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
--> statement-breakpoint
UPDATE `categorization_jobs` SET `since` = `since` / 1000 WHERE `since` > 100000000000;
--> statement-breakpoint
UPDATE `categorization_jobs` SET `cutoff` = `cutoff` / 1000 WHERE `cutoff` > 100000000000;
--> statement-breakpoint
UPDATE `categorization_jobs` SET `cursor_at` = `cursor_at` / 1000 WHERE `cursor_at` > 100000000000;
--> statement-breakpoint
UPDATE `categorization_jobs` SET `lease_until` = `lease_until` / 1000 WHERE `lease_until` > 100000000000;
--> statement-breakpoint
UPDATE `categorization_jobs` SET `created_at` = `created_at` / 1000 WHERE `created_at` > 100000000000;
