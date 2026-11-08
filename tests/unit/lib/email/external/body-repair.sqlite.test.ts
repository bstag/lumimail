import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown, refresh: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/email/external/credentials", () => ({ refreshExternalAccountCredential: h.refresh }));

import { repairExternalMessageBodies } from "@/lib/email/external/body-repair";

let sqlite: DatabaseSync;
const env = {} as CloudflareEnv;

const htmlOnlyMime = [
	"From: Shop <shop@example.com>",
	"To: me@example.com",
	"Subject: Deal",
	"MIME-Version: 1.0",
	"Content-Type: text/html; charset=utf-8",
	"",
	"<!doctype html>",
	"<html><head><title>Deal</title></head><body><table><tr><td><p>Order now</p></td></tr></table></body></html>",
].join("\r\n");

function exec(statement: string, params: unknown[] = []) {
	sqlite.prepare(statement).run(...(params as never[]));
}

const row = <T,>(query: string, ...params: unknown[]) => sqlite.prepare(query).get(...(params as never[])) as T;

function insertMessage(id: string, account: string, remote: string, html: string | null, text: string | null, snippet = "") {
	exec("INSERT INTO messages (id, snippet) VALUES (?, ?)", [id, snippet]);
	exec("INSERT INTO message_bodies (id, message_id, text_body, html_body) VALUES (?, ?, ?, ?)", [`b_${id}`, id, text, html]);
	exec("INSERT INTO external_messages (id, account_id, remote_message_id, lumimail_message_id) VALUES (?, ?, ?, ?)",
		[`x_${id}`, account, remote, id]);
}

function gmailResponse(id: string, mime: string) {
	return new Response(JSON.stringify({ id, raw: Buffer.from(mime).toString("base64url") }), {
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE external_accounts (
			id text, organization_id text, mailbox_id text, owner_user_id text, provider text,
			token_ciphertext text, token_iv text, token_key_id text, status text
		);
		CREATE TABLE external_messages (id text, account_id text, remote_message_id text, lumimail_message_id text);
		CREATE TABLE messages (id text, snippet text);
		CREATE TABLE message_bodies (id text, message_id text, text_body text, html_body text);
	`);
	exec(`INSERT INTO external_accounts VALUES ('exa_1', 'org_1', 'mbx_1', 'usr_1', 'google', 'c', 'i', 'k', 'active')`);
	exec(`INSERT INTO external_accounts VALUES ('exa_off', 'org_1', 'mbx_1', 'usr_1', 'google', 'c', 'i', 'k', 'disconnected')`);
	h.refresh.mockResolvedValue({ status: "ready", accessToken: "token" });
	h.db = drizzle(async (query, params, method) => {
		const statement = sqlite.prepare(query);
		if (method === "run") {
			statement.run(...(params as never[]));
			return { rows: [] };
		}
		statement.setReturnArrays(true);
		return { rows: statement.all(...(params as never[])) as unknown as unknown[][] };
	}, async (queries) => queries.map((item) => {
		sqlite.prepare(item.sql).run(...(item.params as never[]));
		return { rows: [] };
	}));
});

describe("repairExternalMessageBodies", () => {
	it("re-downloads only rows stored with empty HTML and restores HTML and snippet", async () => {
		insertMessage("msg_broken", "exa_1", "g_broken", "", null);
		insertMessage("msg_plain", "exa_1", "g_plain", null, "plain only", "plain only");
		insertMessage("msg_ok", "exa_1", "g_ok", "<p>fine</p>", "fine", "fine");
		insertMessage("msg_inactive", "exa_off", "g_off", "", null);
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			expect(String(input)).toContain("/messages/g_broken");
			return gmailResponse("g_broken", htmlOnlyMime);
		});

		const result = await repairExternalMessageBodies(env, { fetcher });

		expect(result).toEqual({ repaired: 1, abandoned: 0, deferred: false });
		expect(fetcher).toHaveBeenCalledTimes(1);
		const body = row<{ html_body: string }>("SELECT html_body FROM message_bodies WHERE message_id = 'msg_broken'");
		expect(body.html_body).toContain("<p>Order now</p>");
		expect(row<{ snippet: string }>("SELECT snippet FROM messages WHERE id = 'msg_broken'").snippet).toBe("Order now");
		expect(row<{ html_body: string }>("SELECT html_body FROM message_bodies WHERE message_id = 'msg_inactive'").html_body).toBe("");
	});

	it("keeps an existing text body and snippet", async () => {
		insertMessage("msg_1", "exa_1", "g_1", "", "Original text", "Original text");
		await repairExternalMessageBodies(env, { fetcher: async () => gmailResponse("g_1", htmlOnlyMime) });

		expect(row<{ text_body: string }>("SELECT text_body FROM message_bodies WHERE message_id = 'msg_1'").text_body)
			.toBe("Original text");
		expect(row<{ snippet: string }>("SELECT snippet FROM messages WHERE id = 'msg_1'").snippet).toBe("Original text");
	});

	it("marks a message gone at the provider as having no HTML so it is not retried", async () => {
		insertMessage("msg_gone", "exa_1", "g_gone", "", "text");
		const result = await repairExternalMessageBodies(env, {
			fetcher: async () => new Response("{}", { status: 404 }),
		});

		expect(result).toEqual({ repaired: 0, abandoned: 1, deferred: false });
		expect(row<{ html_body: string | null }>("SELECT html_body FROM message_bodies WHERE message_id = 'msg_gone'").html_body)
			.toBeNull();
	});

	it("defers on throttling and leaves rows for the next run", async () => {
		insertMessage("msg_a", "exa_1", "g_a", "", null);
		insertMessage("msg_b", "exa_1", "g_b", "", null);
		const fetcher = vi.fn(async () => new Response("{}", { status: 429 }));

		const result = await repairExternalMessageBodies(env, { fetcher });

		expect(result).toEqual({ repaired: 0, abandoned: 0, deferred: true });
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(row<{ n: number }>("SELECT count(*) n FROM message_bodies WHERE html_body = ''").n).toBe(2);
	});

	it("defers an account whose credential cannot be refreshed", async () => {
		insertMessage("msg_a", "exa_1", "g_a", "", null);
		h.refresh.mockResolvedValue({ status: "error", code: "x", retryable: true, revoked: false, cause: null });
		const fetcher = vi.fn();

		expect(await repairExternalMessageBodies(env, { fetcher })).toEqual({ repaired: 0, abandoned: 0, deferred: true });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("respects the batch size and skips accounts with nothing to repair", async () => {
		for (const id of ["1", "2", "3"]) insertMessage(`msg_${id}`, "exa_1", `g_${id}`, "", null);
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const id = String(input).match(/messages\/(g_\d)/)?.[1] ?? "";
			return gmailResponse(id, htmlOnlyMime);
		});

		expect((await repairExternalMessageBodies(env, { fetcher, batchSize: 2 })).repaired).toBe(2);
		expect((await repairExternalMessageBodies(env, { fetcher, batchSize: 2 })).repaired).toBe(1);
		expect(await repairExternalMessageBodies(env, { fetcher })).toEqual({ repaired: 0, abandoned: 0, deferred: false });
		expect(h.refresh).toHaveBeenCalledTimes(2);
	});

	it("stores NULL when the re-parsed HTML sanitizes to nothing, so the row is not retried", async () => {
		insertMessage("msg_s", "exa_1", "g_s", "", "text");
		const scriptOnly = htmlOnlyMime.replace(/<!doctype html>[\s\S]*$/, "<script>alert(1)</script>");
		await repairExternalMessageBodies(env, { fetcher: async () => gmailResponse("g_s", scriptOnly) });

		expect(row<{ html_body: string | null }>("SELECT html_body FROM message_bodies WHERE message_id = 'msg_s'").html_body)
			.toBeNull();
	});

	it("re-downloads Microsoft messages through Graph", async () => {
		exec(`INSERT INTO external_accounts VALUES ('exa_ms', 'org_1', 'mbx_1', 'usr_1', 'microsoft', 'c', 'i', 'k', 'active')`);
		insertMessage("msg_ms", "exa_ms", "AAMk1", "", null);
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			expect(String(input)).toBe("https://graph.microsoft.com/v1.0/me/messages/AAMk1/$value");
			return new Response(htmlOnlyMime, { headers: { "content-type": "message/rfc822" } });
		});

		expect((await repairExternalMessageBodies(env, { fetcher })).repaired).toBe(1);
	});
});

