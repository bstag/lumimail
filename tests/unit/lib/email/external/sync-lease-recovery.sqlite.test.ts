import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import {
	reconcileExternalSyncJobs,
	requestExternalSyncJob,
} from "@/lib/email/external/sync-jobs";
import { processExternalSyncQueue } from "@/lib/email/external/sync-queue";

const NOW = new Date("2026-09-30T12:00:00Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);
const expired = nowSeconds - 3600;
const live = nowSeconds + 60;

let sqlite: DatabaseSync;
let send: ReturnType<typeof vi.fn>;
let env: CloudflareEnv;

function insertJob(id: string, status: string, leaseUntil: number | null, nextAttemptAt = expired) {
	sqlite.prepare(`INSERT INTO external_sync_jobs
		(id, account_id, kind, status, attempts, next_attempt_at, lease_until, created_at)
		VALUES (?, 'exa_1', 'initial', ?, 196, ?, ?, ?)`)
		.run(id, status, nextAttemptAt, leaseUntil, expired);
}

function job(id: string) {
	return sqlite.prepare("SELECT status, attempts, error_code AS errorCode FROM external_sync_jobs WHERE id = ?")
		.get(id) as { status: string; attempts: number; errorCode: string | null };
}

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE external_sync_jobs (
			id text PRIMARY KEY NOT NULL,
			account_id text NOT NULL,
			kind text NOT NULL,
			requested_kind text,
			status text NOT NULL,
			attempts integer NOT NULL DEFAULT 0,
			next_attempt_at integer NOT NULL,
			lease_until integer,
			error_code text,
			created_at integer NOT NULL,
			completed_at integer
		);
		CREATE UNIQUE INDEX external_sync_jobs_one_active_account_idx
			ON external_sync_jobs (account_id) WHERE status IN ('pending', 'processing');
		CREATE TABLE external_accounts (
			id text, organization_id text, mailbox_id text, owner_user_id text, provider text,
			external_address text, token_ciphertext text, token_iv text, token_key_id text,
			status text, import_mode text, retain_original integer, last_sync_at integer,
			last_error_code text, updated_at integer
		);
		CREATE TABLE mailboxes (
			id text, user_id text, organization_id text, local_part text, display_name text, domain_id text
		);
		CREATE TABLE domains (id text, hostname text);
	`);
	h.db = drizzle(async (query, params, method) => {
		const statement = sqlite.prepare(query);
		if (method === "run") {
			statement.run(...(params as never[]));
			return { rows: [] };
		}
		statement.setReturnArrays(true);
		return { rows: statement.all(...(params as never[])) as unknown as unknown[][] };
	});
	send = vi.fn().mockResolvedValue(undefined);
	env = { EXTERNAL_SYNC_QUEUE: { send } } as unknown as CloudflareEnv;
});

afterEach(() => sqlite.close());

describe("external sync job lease recovery", () => {
	it("reconciliation re-enqueues a processing job whose lease expired", async () => {
		insertJob("exj_crashed", "processing", expired);

		await reconcileExternalSyncJobs(env, NOW);

		expect(send).toHaveBeenCalledWith({ kind: "external-sync", version: 1, jobId: "exj_crashed" });
	});

	it("reconciliation leaves a processing job with a live lease alone", async () => {
		insertJob("exj_running", "processing", live);

		await reconcileExternalSyncJobs(env, NOW);

		expect(send).not.toHaveBeenCalled();
	});

	it("a manual sync request wakes an expired processing job instead of coalescing silently", async () => {
		insertJob("exj_crashed", "processing", expired);

		await expect(requestExternalSyncJob(env, "exa_1", "incremental", NOW))
			.resolves.toEqual({ jobId: "exj_crashed", created: false, enqueued: true });
		expect(send).toHaveBeenCalledWith({ kind: "external-sync", version: 1, jobId: "exj_crashed" });
	});

	it("a manual sync request does not wake a processing job with a live lease", async () => {
		insertJob("exj_running", "processing", live);

		await expect(requestExternalSyncJob(env, "exa_1", "incremental", NOW))
			.resolves.toEqual({ jobId: "exj_running", created: false, enqueued: false });
		expect(send).not.toHaveBeenCalled();
	});

	it("the queue consumer reclaims a processing job whose lease expired", async () => {
		insertJob("exj_crashed", "processing", expired);

		await expect(processExternalSyncQueue(
			env, { kind: "external-sync", version: 1, jobId: "exj_crashed" }, NOW,
		)).resolves.toEqual({ action: "ack" });

		// No account row exists, so a reclaimed job is terminally closed; an unclaimed one stays untouched.
		expect(job("exj_crashed")).toEqual({ status: "failed", attempts: 197, errorCode: "account_inactive" });
	});

	it("the queue consumer never steals a processing job that holds a live lease", async () => {
		insertJob("exj_running", "processing", live);

		await expect(processExternalSyncQueue(
			env, { kind: "external-sync", version: 1, jobId: "exj_running" }, NOW,
		)).resolves.toEqual({ action: "ack" });

		expect(job("exj_running")).toEqual({ status: "processing", attempts: 196, errorCode: null });
	});
});
