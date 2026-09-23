-- Keep manually supplied millisecond epochs consistent with Drizzle timestamp seconds.
UPDATE `webhook_deliveries` SET `next_attempt_at` = `next_attempt_at` / 1000 WHERE `next_attempt_at` > 100000000000;
