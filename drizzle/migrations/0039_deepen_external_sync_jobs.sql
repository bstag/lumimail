ALTER TABLE `external_sync_jobs` ADD `requested_kind` text;

CREATE TABLE `_external_sync_job_survivors` AS
WITH `scored` AS (
	SELECT
		`id`,
		`account_id`,
		`status`,
		`kind`,
		`created_at`,
		CASE `kind`
			WHEN 'resync' THEN 4
			WHEN 'initial' THEN 3
			WHEN 'incremental' THEN 2
			ELSE 1
		END AS `kind_rank`
	FROM `external_sync_jobs`
	WHERE `status` IN ('pending', 'processing')
),
`ranked` AS (
	SELECT
		*,
		ROW_NUMBER() OVER (
			PARTITION BY `account_id`
			ORDER BY
				CASE `status` WHEN 'processing' THEN 0 ELSE 1 END,
				`kind_rank` DESC,
				`created_at`,
				`id`
		) AS `survivor_rank`,
		MAX(`kind_rank`) OVER (PARTITION BY `account_id`) AS `strongest_rank`
	FROM `scored`
)
SELECT
	`account_id`,
	`id` AS `survivor_id`,
	`status` AS `survivor_status`,
	`kind_rank` AS `survivor_kind_rank`,
	CASE `strongest_rank`
		WHEN 4 THEN 'resync'
		WHEN 3 THEN 'initial'
		WHEN 2 THEN 'incremental'
		ELSE 'reconcile'
	END AS `strongest_kind`
FROM `ranked`
WHERE `survivor_rank` = 1;

UPDATE `external_sync_jobs`
SET
	`kind` = CASE
		WHEN `status` = 'pending' THEN (
			SELECT `strongest_kind`
			FROM `_external_sync_job_survivors`
			WHERE `survivor_id` = `external_sync_jobs`.`id`
		)
		ELSE `kind`
	END,
	`requested_kind` = CASE
		WHEN `status` = 'processing' AND (
			SELECT `strongest_rank`
			FROM (
				SELECT
					`survivor_id`,
					CASE `strongest_kind`
						WHEN 'resync' THEN 4
						WHEN 'initial' THEN 3
						WHEN 'incremental' THEN 2
						ELSE 1
					END AS `strongest_rank`
				FROM `_external_sync_job_survivors`
			)
			WHERE `survivor_id` = `external_sync_jobs`.`id`
		) > CASE `kind`
			WHEN 'resync' THEN 4
			WHEN 'initial' THEN 3
			WHEN 'incremental' THEN 2
			ELSE 1
		END THEN (
			SELECT `strongest_kind`
			FROM `_external_sync_job_survivors`
			WHERE `survivor_id` = `external_sync_jobs`.`id`
		)
		ELSE NULL
	END
WHERE `id` IN (SELECT `survivor_id` FROM `_external_sync_job_survivors`);

UPDATE `external_sync_jobs`
SET
	`status` = 'failed',
	`lease_until` = NULL,
	`error_code` = 'superseded_by_active_job',
	`completed_at` = unixepoch()
WHERE `status` IN ('pending', 'processing')
	AND `id` NOT IN (SELECT `survivor_id` FROM `_external_sync_job_survivors`);

DROP TABLE `_external_sync_job_survivors`;

CREATE UNIQUE INDEX `external_sync_jobs_one_active_account_idx`
	ON `external_sync_jobs` (`account_id`)
	WHERE `status` IN ('pending', 'processing');
