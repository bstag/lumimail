ALTER TABLE `external_oauth_states` ADD `reconnect_account_id` text;
--> statement-breakpoint
CREATE INDEX `external_oauth_states_reconnect_idx` ON `external_oauth_states` (`reconnect_account_id`);
