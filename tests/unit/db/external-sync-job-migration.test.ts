import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	resolve(process.cwd(), "drizzle/migrations/0039_deepen_external_sync_jobs.sql"),
	"utf8",
);

function createDatabase(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec(`
		CREATE TABLE external_sync_jobs (
			id text PRIMARY KEY NOT NULL,
			account_id text NOT NULL,
			kind text NOT NULL,
			status text NOT NULL,
			attempts integer NOT NULL DEFAULT 0,
			next_attempt_at integer NOT NULL,
			lease_until integer,
			error_code text,
			created_at integer NOT NULL,
			completed_at integer
		);
	`);
	return db;
}

describe("0039 external sync job deepening migration", () => {
	it("coalesces existing active work without deleting job history", () => {
		const db = createDatabase();
		try {
			db.exec(`
				INSERT INTO external_sync_jobs VALUES
					('exj_processing', 'exa_1', 'incremental', 'processing', 1, 10, 20, NULL, 1, NULL),
					('exj_resync', 'exa_1', 'resync', 'pending', 0, 10, NULL, NULL, 2, NULL),
					('exj_reconcile', 'exa_1', 'reconcile', 'pending', 0, 10, NULL, NULL, 3, NULL),
					('exj_completed', 'exa_1', 'initial', 'completed', 1, 5, NULL, NULL, 0, 5);
			`);

			db.exec(migration);

			const active = db.prepare(`
				SELECT id, kind, requested_kind AS requestedKind
				FROM external_sync_jobs
				WHERE status IN ('pending', 'processing')
			`).all() as Array<{ id: string; kind: string; requestedKind: string | null }>;
			expect(active).toEqual([{
				id: "exj_processing",
				kind: "incremental",
				requestedKind: "resync",
			}]);

			const superseded = db.prepare(`
				SELECT id, status, error_code AS errorCode
				FROM external_sync_jobs
				WHERE id IN ('exj_resync', 'exj_reconcile')
				ORDER BY id
			`).all();
			expect(superseded).toEqual([
				{ id: "exj_reconcile", status: "failed", errorCode: "superseded_by_active_job" },
				{ id: "exj_resync", status: "failed", errorCode: "superseded_by_active_job" },
			]);
			expect(db.prepare("SELECT COUNT(*) AS count FROM external_sync_jobs").get())
				.toEqual({ count: 4 });
		} finally {
			db.close();
		}
	});

	it("keeps the strongest pending intent and enforces one active job per account", () => {
		const db = createDatabase();
		try {
			db.exec(`
				INSERT INTO external_sync_jobs VALUES
					('exj_initial', 'exa_1', 'initial', 'pending', 0, 10, NULL, NULL, 1, NULL),
					('exj_resync', 'exa_1', 'resync', 'pending', 0, 10, NULL, NULL, 2, NULL);
			`);
			db.exec(migration);

			expect(db.prepare(`
				SELECT id, kind, requested_kind AS requestedKind
				FROM external_sync_jobs
				WHERE status = 'pending'
			`).get()).toEqual({ id: "exj_resync", kind: "resync", requestedKind: null });

			expect(() => db.prepare(`
				INSERT INTO external_sync_jobs
					(id, account_id, kind, status, attempts, next_attempt_at, created_at)
				VALUES ('exj_duplicate', 'exa_1', 'incremental', 'pending', 0, 20, 20)
			`).run()).toThrow(/UNIQUE/);

			expect(() => db.prepare(`
				INSERT INTO external_sync_jobs
					(id, account_id, kind, status, attempts, next_attempt_at, created_at, completed_at)
				VALUES ('exj_history', 'exa_1', 'incremental', 'completed', 1, 20, 20, 21)
			`).run()).not.toThrow();
		} finally {
			db.close();
		}
	});
});
