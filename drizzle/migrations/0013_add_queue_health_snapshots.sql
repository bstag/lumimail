CREATE TABLE `queue_health_snapshots` (
	`queue_key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`backlog_count` integer DEFAULT 0 NOT NULL,
	`backlog_bytes` integer DEFAULT 0 NOT NULL,
	`oldest_message_at` integer,
	`stale_job_count` integer DEFAULT 0 NOT NULL,
	`detail` text,
	`checked_at` integer NOT NULL
);
