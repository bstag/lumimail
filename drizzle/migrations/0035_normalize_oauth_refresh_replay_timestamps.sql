UPDATE `oauth_refresh_token_uses` SET `used_at` = `used_at` / 1000 WHERE `used_at` > 100000000000;
--> statement-breakpoint
UPDATE `oauth_refresh_token_uses` SET `expires_at` = `expires_at` / 1000 WHERE `expires_at` > 100000000000;
