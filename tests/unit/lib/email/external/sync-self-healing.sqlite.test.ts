import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import { failExternalSyncJob, reconcileExternalSyncJobs } from "@/lib/email/external/sync-jobs";
import { processExternalSyncQueue } from "@/lib/email/external/sync-queue";

const NOW = new Date("2026-10-01T12:00:00Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

let sqlite: DatabaseSync;
let send: ReturnType<typeof vi.fn>;
let env: CloudflareEnv;

function exec(statement: string, params: unknown[] = []) {
	sqlite.prepare(statement).run(...(params as never[]));
}

function insertAccount(id: string, status: string, retryCount = 0, nextRetryAt: number | null = null) {
	exec(`INSERT INTO external_accounts (id, status, last_sync_at, last_error_code, error_retry_count, next_retry_at, updated_at)
		VALUES (?, ?, NULL, NULL, ?, ?, ?)`, [id, status, retryCount, nextRetryAt, nowSeconds - 100]);
}

function insertJob(id: string, accountId: string, fields: {
	status?: string; suspect?: string | null; strikeMessage?: string | null; strikes?: number; failures?: number;
} = {}) {
	exec(`INSERT INTO external_sync_jobs
		(id, account_id, kind, status, attempts, next_attempt_at, lease_until, created_at,
		 suspect_message_id, strike_message_id, strike_count, failure_count)
		VALUES (?, ?, 'initial', ?, 7, ?, ?, ?, ?, ?, ?, ?)`, [
		id, accountId, fields.status ?? "pending", nowSeconds - 10, null, nowSeconds - 100,
		fields.suspect ?? null, fields.strikeMessage ?? null, fields.strikes ?? 0, fields.failures ?? 0,
	]);
}

const row = <T,>(query: string, ...params: unknown[]) => sqlite.prepare(query).get(...(params as never[])) as T;

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE external_sync_jobs (
			id text PRIMARY KEY NOT NULL, account_id text NOT NULL, kind text NOT NULL, requested_kind text,
			status text NOT NULL, attempts integer NOT NULL DEFAULT 0, next_attempt_at integer NOT NULL,
			lease_until integer, error_code text, suspect_message_id text, strike_message_id text,
			strike_count integer NOT NULL DEFAULT 0, failure_count integer NOT NULL DEFAULT 0,
			created_at integer NOT NULL, completed_at integer
		);
		CREATE UNIQUE INDEX external_sync_jobs_one_active_account_idx
			ON external_sync_jobs (account_id) WHERE status IN ('pending', 'processing');
		CREATE TABLE external_accounts (
			id text, organization_id text, mailbox_id text, owner_user_id text, provider text,
			external_address text, token_ciphertext text, token_iv text, token_key_id text,
			status text, import_mode text, retain_original integer, last_sync_at integer,
			last_error_code text, error_retry_count integer NOT NULL DEFAULT 0, next_retry_at integer,
			updated_at integer
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
	}, async (queries) => queries.map((item) => {
		const statement = sqlite.prepare(item.sql);
		if (item.method === "run") {
			statement.run(...(item.params as never[]));
			return { rows: [] };
		}
		statement.setReturnArrays(true);
		return { rows: statement.all(...(item.params as never[])) as unknown as unknown[][] };
	}));
	send = vi.fn().mockResolvedValue(undefined);
	env = { EXTERNAL_SYNC_QUEUE: { send } } as unknown as CloudflareEnv;
});

afterEach(() => sqlite.close());

describe("claim attributes an abandoned message to a strike", () => {
	const claim = (jobId: string) => processExternalSyncQueue(
		env, { kind: "external-sync", version: 1, jobId }, NOW,
	);
	const strikes = (jobId: string) => row<{ strikeMessageId: string | null; strikeCount: number; suspect: string | null }>(
		`SELECT strike_message_id AS strikeMessageId, strike_count AS strikeCount, suspect_message_id AS suspect
		 FROM external_sync_jobs WHERE id = ?`, jobId);

	it("starts a strike when the previous attempt died on a message", async () => {
		insertJob("exj_1", "exa_1", { suspect: "m1" });
		await claim("exj_1");
		expect(strikes("exj_1")).toEqual({ strikeMessageId: "m1", strikeCount: 1, suspect: null });
	});

	it("adds a strike when the same message is abandoned again", async () => {
		insertJob("exj_1", "exa_1", { suspect: "m1", strikeMessage: "m1", strikes: 2 });
		await claim("exj_1");
		expect(strikes("exj_1")).toEqual({ strikeMessageId: "m1", strikeCount: 3, suspect: null });
	});

	it("restarts the count at one when a different message is abandoned", async () => {
		insertJob("exj_1", "exa_1", { suspect: "m2", strikeMessage: "m1", strikes: 2 });
		await claim("exj_1");
		expect(strikes("exj_1")).toEqual({ strikeMessageId: "m2", strikeCount: 1, suspect: null });
	});

	it("leaves strikes alone when nothing was in flight", async () => {
		insertJob("exj_1", "exa_1", { strikeMessage: "m1", strikes: 2 });
		await claim("exj_1");
		expect(strikes("exj_1")).toEqual({ strikeMessageId: "m1", strikeCount: 2, suspect: null });
	});
});

describe("failExternalSyncJob schedules automatic recovery", () => {
	const fail = (accountStatus: "error" | "resync_required" | "reconnect_required") => failExternalSyncJob(env, {
		jobId: "exj_1", accountId: "exa_1", accountStatus, errorCode: "sync_failed", now: NOW,
	});
	const account = () => row<{ status: string; code: string | null; retries: number; next: number | null }>(
		`SELECT status, last_error_code AS code, error_retry_count AS retries, next_retry_at AS next
		 FROM external_accounts WHERE id = 'exa_1'`);

	it("closes the job, sets the status and error code, and schedules the first retry", async () => {
		insertAccount("exa_1", "initial_sync");
		insertJob("exj_1", "exa_1", { status: "processing" });
		await fail("error");
		expect(row("SELECT status, error_code AS code, lease_until AS lease FROM external_sync_jobs WHERE id = 'exj_1'"))
			.toEqual({ status: "failed", code: "sync_failed", lease: null });
		expect(account()).toEqual({ status: "error", code: "sync_failed", retries: 1, next: nowSeconds + 300 });
	});

	it("backs off further on each failure and stops scheduling when the schedule is spent", async () => {
		insertAccount("exa_1", "error", 3);
		insertJob("exj_1", "exa_1", { status: "processing" });
		await fail("error");
		expect(account()).toMatchObject({ retries: 4, next: nowSeconds + 43_200 });

		exec("DELETE FROM external_sync_jobs");
		insertJob("exj_2", "exa_1", { status: "processing" });
		await failExternalSyncJob(env, { jobId: "exj_2", accountId: "exa_1", accountStatus: "error", errorCode: "x", now: NOW });
		expect(account()).toMatchObject({ retries: 5, next: null });
	});

	it("also retries a resync-required account", async () => {
		insertAccount("exa_1", "active");
		insertJob("exj_1", "exa_1", { status: "processing" });
		await fail("resync_required");
		expect(account()).toMatchObject({ status: "resync_required", retries: 1, next: nowSeconds + 300 });
	});

	it("never schedules a retry when only the user can fix it", async () => {
		insertAccount("exa_1", "active", 2, nowSeconds + 50);
		insertJob("exj_1", "exa_1", { status: "processing" });
		await fail("reconnect_required");
		expect(account()).toMatchObject({ status: "reconnect_required", retries: 2, next: null });
	});
});

describe("reconciliation retries recoverable accounts that are due", () => {
	const resyncJobs = () => sqlite.prepare("SELECT account_id AS accountId, kind FROM external_sync_jobs ORDER BY account_id").all();

	it("requests a resync for an error or resync-required account whose retry is due", async () => {
		insertAccount("exa_error", "error", 1, nowSeconds - 5);
		insertAccount("exa_stale", "resync_required", 1, nowSeconds - 5);

		await reconcileExternalSyncJobs(env, NOW);

		expect(resyncJobs()).toEqual([
			{ accountId: "exa_error", kind: "resync" },
			{ accountId: "exa_stale", kind: "resync" },
		]);
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("clears the due time once the retry job exists so it is not requested again", async () => {
		insertAccount("exa_error", "error", 1, nowSeconds - 5);

		const first = await reconcileExternalSyncJobs(env, NOW);
		const second = await reconcileExternalSyncJobs(env, NOW);

		expect(first.created).toBe(1);
		expect(second.created).toBe(0);
		expect(row("SELECT next_retry_at AS next FROM external_accounts WHERE id = 'exa_error'")).toEqual({ next: null });
		expect(resyncJobs()).toEqual([{ accountId: "exa_error", kind: "resync" }]);
	});

	it("joins a retry already in flight instead of creating or waking a second job", async () => {
		insertAccount("exa_error", "error", 1, nowSeconds - 5);
		insertJob("exj_running", "exa_error", { status: "processing" });
		exec("UPDATE external_sync_jobs SET lease_until = ?", [nowSeconds + 60]);

		await expect(reconcileExternalSyncJobs(env, NOW)).resolves.toEqual({ enqueued: 0, created: 0 });

		expect(resyncJobs()).toEqual([{ accountId: "exa_error", kind: "initial" }]);
		expect(row("SELECT next_retry_at AS next FROM external_accounts WHERE id = 'exa_error'")).toEqual({ next: null });
		expect(send).not.toHaveBeenCalled();
	});

	it("leaves accounts alone when the retry is not due, exhausted, paused, or needs the user", async () => {
		insertAccount("exa_future", "error", 1, nowSeconds + 600);
		insertAccount("exa_exhausted", "error", 5, null);
		insertAccount("exa_paused", "paused", 1, nowSeconds - 5);
		insertAccount("exa_reconnect", "reconnect_required", 1, nowSeconds - 5);

		await reconcileExternalSyncJobs(env, NOW);

		expect(resyncJobs()).toEqual([]);
		expect(send).not.toHaveBeenCalled();
	});
});
