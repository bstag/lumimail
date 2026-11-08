import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
	db: null as unknown,
	evaluate: vi.fn(),
	configured: vi.fn(),
	beforeQuery: null as null | ((sql: string) => void),
	beforeBatch: null as null | (() => Promise<void>),
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/categorization/jev", () => ({
	isJevConfigured: h.configured,
	evaluateMail: h.evaluate,
}));
import {
	readConfiguration,
	activateConfiguration,
	previewConfiguration,
	createJob,
	runJob,
	listJobs,
	cancelJob,
	correctMessage,
	reconcileCategorization,
	readInsights,
} from "@/lib/categorization/service";
import { DEFAULT_CONFIG } from "@/lib/categorization/engine";
let sqlite: DatabaseSync;
const actor = { id: "u1", organizationId: "org1" };
const env = {} as CloudflareEnv;
const config = { ...DEFAULT_CONFIG, questions: [] };
beforeEach(() => {
	h.beforeQuery = null;
	h.beforeBatch = null;
	h.configured.mockReset().mockReturnValue(true);
	sqlite = new DatabaseSync(":memory:");
	for (const file of readdirSync("drizzle/migrations")
		.filter((f) => f.endsWith(".sql"))
		.sort())
		sqlite.exec(readFileSync(`drizzle/migrations/${file}`, "utf8"));
	const query = async (sql: string, params: unknown[], method: string) => {
		// Cloudflare D1 limits bound parameters per statement, including commit guards.
		expect(params.length).toBeLessThanOrEqual(100);
		h.beforeQuery?.(sql);
		const stmt = sqlite.prepare(sql);
		if (method === "run") {
			stmt.run(...(params as never[]));
			return { rows: [] };
		}
		stmt.setReturnArrays(true);
		const rows = stmt.all(...(params as never[])) as unknown as unknown[][];
		return { rows: method === "get" ? (rows[0] ?? []) : rows };
	};
	h.db = drizzle(query, async (batch) => {
		await h.beforeBatch?.();
		sqlite.exec("BEGIN");
		try {
			const results = [];
			for (const q of batch)
				results.push(await query(q.sql, q.params, q.method));
			sqlite.exec("COMMIT");
			return results;
		} catch (e) {
			sqlite.exec("ROLLBACK");
			throw e;
		}
	});
	sqlite.exec(
		"INSERT INTO organizations(id,name,created_at,updated_at) VALUES ('org1','One',1,1),('org2','Two',1,1)",
	);
	sqlite.exec(
		"INSERT INTO users(id,email,password_hash,name,organization_id,created_at) VALUES ('u1','one@example.com','hash','One','org1',1),('u2','two@example.com','hash','Two','org2',1)",
	);
	h.evaluate.mockReset().mockResolvedValue({
		tags: [{ tag: "Newsletters", reason: "Email type" }],
		uncertain: [],
		answers: {},
		model: "rules",
	});
});
afterEach(() => sqlite.close());
function message(
	id: string,
	user = "u1",
	fields: { status?: string; date?: number; mailbox?: string } = {},
) {
	sqlite
		.prepare(
			"INSERT INTO messages(id,user_id,organization_id,mailbox_id,direction,from_addr,to_addr,subject,status,created_at,received_at) VALUES (?,?,?,?, 'inbound','Brief <digest@brief.example>','one@example.com','Daily brief',?,?,?)",
		)
		.run(
			id,
			user,
			user === "u1" ? "org1" : "org2",
			fields.mailbox ?? null,
			fields.status ?? "received",
			fields.date ?? 10,
			10,
		);
}
function mailbox() {
	sqlite.exec(
		"INSERT INTO domains(id,user_id,organization_id,hostname,zone_id,created_at) VALUES ('d1','u1','org1','example.com','zone',1)",
	);
	sqlite.exec(
		"INSERT INTO mailboxes(id,user_id,organization_id,domain_id,local_part,created_at) VALUES ('mb1','u1','org1','d1','team',1)",
	);
	sqlite.exec(
		"INSERT INTO mailbox_memberships(id,mailbox_id,user_id,role,created_at,updated_at) VALUES ('grant','mb1','u1','viewer',1,1)",
	);
}
async function activate(automatic = false) {
	return activateConfiguration(env, actor, {
		config,
		expectedVersion: null,
		automatic,
		consent: true,
	});
}
describe("categorization against SQLite", () => {
	it("groups the actual sender when a quoted display name contains angle brackets", async () => {
		message("m1");
		message("m2");
		sqlite
			.prepare("UPDATE messages SET from_addr=? WHERE id='m2'")
			.run('"Brief <display>" <DIGEST@BRIEF.EXAMPLE>');
		const data = await readInsights(
			env,
			actor,
			{ days: 30, mailboxId: null, sender: null, offset: 0 },
			new Date(20000),
		);
		expect(data.senders).toEqual([
			{ sender: "digest@brief.example", total: 2 },
		]);
	});
	it("stops further provider disclosures after revocation within a selected batch", async () => {
		mailbox();
		message("m1", "u1", { mailbox: "mb1" });
		message("m2", "u1", { mailbox: "mb1" });
		await activate();
		h.evaluate.mockImplementation(async () => {
			sqlite.exec("DELETE FROM mailbox_memberships");
			return { tags: [], uncertain: [], answers: {}, model: "rules" };
		});
		expect(
			await previewConfiguration(env, actor, {
				config,
				mailboxId: "mb1",
				consent: true,
			}),
		).toEqual([]);
		expect(h.evaluate).toHaveBeenCalledTimes(1);
		sqlite.exec(
			"INSERT INTO mailbox_memberships(id,mailbox_id,user_id,role,created_at,updated_at) VALUES ('grant','mb1','u1','viewer',1,1)",
		);
		h.evaluate.mockClear();
		await runJob(env, actor, (await createJob(env, actor, "mb1")).id);
		expect(h.evaluate).toHaveBeenCalledTimes(1);
		expect(
			sqlite.prepare("SELECT count(*) n FROM categorization_states").get()?.n,
		).toBe(0);
	});
	it("requires an idle job slot for retry and cancels obsolete failed automatic work on activation", async () => {
		const saved = await activate(true);
		const failed = await createJob(env, actor, null, true);
		sqlite
			.prepare("UPDATE categorization_jobs SET status='failed' WHERE id=?")
			.run(failed.id);
		const active = await createJob(env, actor, null);
		await expect(runJob(env, actor, failed.id, true)).rejects.toThrow(
			"already active",
		);
		await cancelJob(env, actor, active.id);
		await activateConfiguration(env, actor, {
			config,
			expectedVersion: saved.activeVersion,
			automatic: false,
			consent: false,
		});
		expect(
			(await listJobs(env, actor)).find((job) => job.id === failed.id)?.status,
		).toBe("cancelled");
	});
	it("creates immutable versions, rejects stale activation, and scopes history", async () => {
		expect((await readConfiguration(env, actor)).activeVersion).toBeNull();
		const saved = await activate();
		expect(saved.activeVersion).toBeTruthy();
		await expect(activate()).rejects.toThrow("changed");
		const newer = await activateConfiguration(env, actor, {
			config,
			expectedVersion: saved.activeVersion,
			automatic: false,
			consent: true,
		});
		expect(newer.versions).toHaveLength(2);
		expect(
			(await readConfiguration(env, { id: "u2", organizationId: "org2" }))
				.versions,
		).toEqual([]);
	});
	it("previews only accessible inbound mail without changing labels", async () => {
		message("mine");
		message("foreign", "u2");
		message("trash", "u1", { status: "trash" });
		const sample = await previewConfiguration(env, actor, {
			config,
			mailboxId: null,
			consent: true,
		});
		expect(sample.map((row) => row.messageId)).toEqual(["mine"]);
		expect(
			sqlite.prepare("SELECT count(*) AS n FROM message_labels").get()?.n,
		).toBe(0);
	});
	it("processes a bounded backfill and preserves corrections on reclassification", async () => {
		await activate();
		for (let i = 0; i < 7; i++) message(`m${i}`);
		const job = await createJob(env, actor, null);
		expect((await runJob(env, actor, job.id)).processed).toBe(5);
		expect((await runJob(env, actor, job.id)).status).toBe("complete");
		await correctMessage(env, actor, "m0", ["Personal"]);
		const second = await createJob(env, actor, null);
		await runJob(env, actor, second.id);
		expect(
			JSON.parse(
				String(
					sqlite
						.prepare(
							"SELECT tags FROM categorization_states WHERE message_id='m0'",
						)
						.get()?.tags,
				),
			),
		).toEqual(["Personal"]);
		await correctMessage(env, actor, "m0", null);
		expect(
			JSON.parse(
				String(
					sqlite
						.prepare(
							"SELECT tags FROM categorization_states WHERE message_id='m0'",
						)
						.get()?.tags,
				),
			),
		).toEqual(["Newsletters"]);
		await expect(correctMessage(env, actor, "foreign", [])).rejects.toThrow(
			"not found",
		);
	});
	it("cancels jobs and hides another user's job", async () => {
		await activate();
		const job = await createJob(env, actor, null);
		await expect(
			cancelJob(env, { id: "u2", organizationId: "org2" }, job.id),
		).rejects.toThrow("not found");
		await cancelJob(env, actor, job.id);
		expect((await runJob(env, actor, job.id)).status).toBe("cancelled");
		expect(await listJobs(env, { id: "u2", organizationId: "org2" })).toEqual(
			[],
		);
	});
	it("automatically classifies only new arrivals after opt-in", async () => {
		message("old");
		await activate(true);
		message("new", "u1", { date: Math.floor(Date.now() / 1000) + 1 });
		await reconcileCategorization(env, new Date(Date.now() + 2000));
		expect(
			sqlite.prepare("SELECT message_id FROM categorization_states").all(),
		).toEqual([{ message_id: "new" }]);
	});
	it("aggregates received-date history without foreign mail", async () => {
		message("mine");
		message("foreign", "u2");
		const insights = await readInsights(
			env,
			actor,
			{ days: 30, mailboxId: null, sender: null, offset: 0 },
			new Date(20_000),
		);
		expect(insights.total).toBe(1);
		expect(insights.senders).toEqual([
			{ sender: "digest@brief.example", total: 1 },
		]);
	});
	it("rejects overlapping jobs and avoids empty automatic jobs", async () => {
		await activate(true);
		await reconcileCategorization(env);
		expect(await listJobs(env, actor)).toEqual([]);
		const job = await createJob(env, actor, null);
		await expect(createJob(env, actor, null)).rejects.toThrow("already active");
		await cancelJob(env, actor, job.id);
		expect((await createJob(env, actor, null)).status).toBe("pending");
	});
	it("does not apply results after cancellation or an organization change", async () => {
		await activate();
		message("m1");
		const job = await createJob(env, actor, null);
		h.evaluate.mockImplementationOnce(async () => {
			await cancelJob(env, actor, job.id);
			return {
				tags: [{ tag: "Newsletters", reason: "Type" }],
				uncertain: [],
				answers: {},
				model: "rules",
			};
		});
		expect((await runJob(env, actor, job.id)).status).toBe("cancelled");
		expect(
			sqlite.prepare("SELECT count(*) AS n FROM message_labels").get()?.n,
		).toBe(0);
		const next = await createJob(env, actor, null);
		h.evaluate.mockImplementationOnce(async () => {
			sqlite.exec("UPDATE users SET organization_id='org2' WHERE id='u1'");
			return {
				tags: [{ tag: "Newsletters", reason: "Type" }],
				uncertain: [],
				answers: {},
				model: "rules",
			};
		});
		await runJob(env, actor, next.id);
		expect(
			sqlite.prepare("SELECT count(*) AS n FROM categorization_states").get()
				?.n,
		).toBe(0);
	});
	it("requires saved consent and provider readiness only for enabled questions", async () => {
		await expect(createJob(env, actor, null)).rejects.toThrow("Activate");
		const input = {
			config: DEFAULT_CONFIG,
			expectedVersion: null,
			automatic: true,
			consent: false,
		};
		await expect(activateConfiguration(env, actor, input)).rejects.toThrow(
			"Consent",
		);
		h.configured.mockReturnValue(false);
		await expect(
			activateConfiguration(env, actor, { ...input, consent: true }),
		).rejects.toThrow("not configured");
		const saved = await activateConfiguration(env, actor, {
			...input,
			automatic: false,
		});
		await expect(createJob(env, actor, null)).rejects.toThrow("Consent");
		await activateConfiguration(env, actor, {
			...input,
			expectedVersion: saved.activeVersion,
			automatic: false,
			consent: true,
		});
		await expect(createJob(env, actor, null)).rejects.toThrow("not configured");
		h.configured.mockReturnValue(true);
		expect((await createJob(env, actor, null)).status).toBe("pending");
	});
	it("handles activation races without retaining unused versions", async () => {
		const saved = await activate();
		h.beforeQuery = (query) => {
			if (
				!query.startsWith(
					'update "categorization_preferences" set "active_version"',
				)
			)
				return;
			h.beforeQuery = null;
			sqlite.exec("DELETE FROM categorization_preferences");
		};
		await expect(
			activateConfiguration(env, actor, {
				config,
				expectedVersion: saved.activeVersion,
				automatic: false,
				consent: true,
			}),
		).rejects.toThrow("changed");
		expect(
			sqlite.prepare("SELECT count(*) n FROM categorization_versions").get()?.n,
		).toBe(1);
		await activate();
		const job = await createJob(env, actor, null);
		await cancelJob(env, actor, job.id);
		h.beforeQuery = (query) => {
			if (!query.startsWith('insert into "categorization_jobs"')) return;
			h.beforeQuery = null;
			sqlite
				.prepare("UPDATE categorization_jobs SET status='pending' WHERE id=?")
				.run(job.id);
		};
		await expect(createJob(env, actor, null)).rejects.toThrow("already active");
	});
	it("reads an active version outside the bounded history and supports personal accounts", async () => {
		const saved = await activate();
		sqlite
			.prepare("UPDATE categorization_versions SET created_at=1 WHERE id=?")
			.run(saved.activeVersion);
		for (let i = 0; i < 51; i++)
			sqlite
				.prepare(
					"INSERT INTO categorization_versions(id,user_id,organization_id,config,created_at) VALUES (?, 'u1', 'org1', ?, 20)",
				)
				.run(`v${i}`, JSON.stringify(config));
		expect((await readConfiguration(env, actor)).config).toEqual(config);
		sqlite.exec("UPDATE users SET organization_id=NULL WHERE id='u2'");
		const personal = { id: "u2", organizationId: null };
		expect((await readConfiguration(env, personal)).automatic).toBe(false);
		await activateConfiguration(env, personal, {
			config,
			expectedVersion: null,
			automatic: false,
			consent: false,
		});
		await expect(createJob(env, personal, "foreign")).rejects.toThrow(
			"Mailbox not found",
		);
		expect(
			(await runJob(env, personal, (await createJob(env, personal, null)).id))
				.status,
		).toBe("complete");
	});
	it("backs off provider failures, honors leases, and explicitly retries after three failures", async () => {
		await activate();
		message("m1");
		const job = await createJob(env, actor, null);
		h.evaluate.mockRejectedValue(new Error("secret provider failure"));
		const now = new Date();
		for (let attempt = 1; attempt <= 3; attempt++) {
			const failed = await runJob(
				env,
				actor,
				job.id,
				false,
				new Date(now.getTime() + attempt * 300000),
			);
			expect(failed.attempts).toBe(attempt);
			expect(failed.error).not.toContain("secret");
			expect(failed.status).toBe(attempt === 3 ? "failed" : "pending");
			await runJob(
				env,
				actor,
				job.id,
				false,
				new Date(now.getTime() + attempt * 300000),
			);
			expect(h.evaluate).toHaveBeenCalledTimes(attempt);
		}
		h.evaluate.mockResolvedValue({
			tags: [],
			uncertain: [],
			answers: {},
			model: "rules",
		});
		expect((await runJob(env, actor, job.id, true)).status).toBe("complete");
		await runJob(env, actor, job.id, true);
	});
	it("preserves unrelated manual attachments and reports classifications in insights", async () => {
		await activate();
		message("m1");
		message("plain");
		sqlite.exec(
			"INSERT INTO labels(id,user_id,organization_id,name,created_at) VALUES ('manual','u1','org1','Newsletters',1),('unrelated','u1','org1','Keep',1)",
		);
		sqlite.exec(
			"INSERT INTO message_labels(message_id,label_id) VALUES ('m1','manual'),('m1','unrelated')",
		);
		await runJob(env, actor, (await createJob(env, actor, null)).id);
		await correctMessage(env, actor, "m1", ["Personal"]);
		expect(
			sqlite
				.prepare(
					"SELECT label_id FROM message_labels WHERE message_id='m1' ORDER BY label_id",
				)
				.all(),
		).toEqual(
			expect.arrayContaining([
				{ label_id: "manual" },
				{ label_id: "unrelated" },
			]),
		);
		const insights = await readInsights(
			env,
			actor,
			{ days: 7, mailboxId: null, sender: "DIGEST@BRIEF.EXAMPLE", offset: 0 },
			new Date(20000),
		);
		expect(insights.total).toBe(2);
		expect(insights.tags.map((t) => t.name)).toContain("Personal");
		expect(insights.messages.find((m) => m.id === "m1")?.correction).toEqual([
			"Personal",
		]);
		expect(
			insights.messages.every((m) => m.evaluation?.model === "rules"),
		).toBe(true);
		sqlite.exec("DELETE FROM categorization_results");
		await expect(correctMessage(env, actor, "m1", [])).rejects.toThrow(
			"not found",
		);
	});
	it("checks cancellation and concurrent corrections inside the atomic write batch", async () => {
		await activate();
		message("m1");
		let job = await createJob(env, actor, null);
		h.beforeBatch = async () => {
			h.beforeBatch = null;
			await cancelJob(env, actor, job.id);
		};
		await runJob(env, actor, job.id);
		expect(
			sqlite.prepare("SELECT count(*) n FROM message_labels").get()?.n,
		).toBe(0);
		job = await createJob(env, actor, null);
		await runJob(env, actor, job.id);
		job = await createJob(env, actor, null);
		h.beforeBatch = async () => {
			h.beforeBatch = null;
			await correctMessage(env, actor, "m1", ["Protected"]);
		};
		await runJob(env, actor, job.id);
		expect(
			JSON.parse(
				String(
					sqlite.prepare("SELECT tags FROM categorization_states").get()?.tags,
				),
			),
		).toEqual(["Protected"]);
	});
	it("allows read-only mailbox tags but excludes revoked messages from previews and jobs", async () => {
		mailbox();
		message("shared", "u1", { mailbox: "mb1" });
		await expect(createJob(env, actor, "foreign")).rejects.toThrow(
			"Mailbox not found",
		);
		const saved = await activateConfiguration(env, actor, {
			config: DEFAULT_CONFIG,
			expectedVersion: null,
			automatic: true,
			consent: true,
		});
		await activateConfiguration(env, actor, {
			config,
			expectedVersion: saved.activeVersion,
			automatic: true,
			consent: false,
		});
		await runJob(env, actor, (await createJob(env, actor, "mb1")).id);
		await correctMessage(env, actor, "shared", ["Reviewed"]);
		const input = { config, mailboxId: "mb1", consent: true as const };
		const sample = await previewConfiguration(env, actor, input);
		expect(sample[0]).toMatchObject({
			current: ["Reviewed"],
			correction: ["Reviewed"],
		});
		h.evaluate.mockImplementationOnce(async () => {
			sqlite.exec("DELETE FROM mailbox_memberships");
			return { tags: [], uncertain: [], answers: {}, model: "rules" };
		});
		expect(await previewConfiguration(env, actor, input)).toEqual([]);
		await expect(
			readInsights(env, actor, {
				days: 30,
				mailboxId: "mb1",
				sender: null,
				offset: 0,
			}),
		).rejects.toThrow("Mailbox not found");
		await expect(correctMessage(env, actor, "shared", [])).rejects.toThrow(
			"not found",
		);
	});
});
