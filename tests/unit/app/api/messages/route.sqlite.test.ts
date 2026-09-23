import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	db: null as unknown,
	getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/messages/enrich", () => ({
	enrichMessagesWithContacts: vi.fn(async (_env, _userId, rows) => rows),
}));

import { GET } from "@/app/api/messages/route";

type CapturedQuery = { sql: string; params: unknown[] };

let sqlite: DatabaseSync;
let queries: CapturedQuery[];

beforeEach(() => {
	queries = [];
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE mailbox_memberships (
			mailbox_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			role TEXT NOT NULL
		);
		CREATE TABLE mailboxes (
			id TEXT PRIMARY KEY,
			organization_id TEXT
		);
		CREATE TABLE labels (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL
		);
		CREATE TABLE message_labels (
			message_id TEXT NOT NULL,
			label_id TEXT NOT NULL
		);
		CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			organization_id TEXT,
			mailbox_id TEXT,
			direction TEXT NOT NULL,
			provider_message_id TEXT,
			rfc_message_id TEXT,
			in_reply_to TEXT,
			references_header TEXT,
			reply_source_message_id TEXT,
			from_addr TEXT NOT NULL,
			to_addr TEXT NOT NULL,
			subject TEXT,
			snippet TEXT,
			status TEXT NOT NULL,
			attachment_status TEXT NOT NULL,
			attachment_error TEXT,
			read INTEGER NOT NULL,
			starred INTEGER NOT NULL,
			thread_id TEXT,
			imap_uid INTEGER,
			created_at INTEGER NOT NULL
		);
	`);

	m.db = drizzle(async (sql, params, method) => {
		queries.push({ sql, params: [...params] });
		const statement = sqlite.prepare(sql);
		if (method === "run") {
			statement.run(...params);
			return { rows: [] };
		}
		statement.setReturnArrays(true);
		return { rows: statement.all(...params) as unknown as unknown[][] };
	});
	m.getCurrentUser.mockReset();
	m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org1" });

	sqlite.prepare("INSERT INTO labels (id, user_id) VALUES (?, ?)").run("lbl1", "u1");
	const insertMessage = sqlite.prepare(`
		INSERT INTO messages (
			id, user_id, organization_id, mailbox_id, direction,
			from_addr, to_addr, subject, snippet, status, attachment_status,
			read, starred, thread_id, created_at
		) VALUES (?, ?, NULL, NULL, 'inbound', ?, ?, ?, ?, 'received', 'none', 0, 0, ?, ?)
	`);
	const insertLabel = sqlite.prepare(
		"INSERT INTO message_labels (message_id, label_id) VALUES (?, ?)",
	);
	for (let index = 0; index < 101; index += 1) {
		const messageId = `m${index}`;
		insertMessage.run(
			messageId,
			"u1",
			`from${index}@example.test`,
			"to@example.test",
			`Subject ${index}`,
			`Snippet ${index}`,
			`thread-${index}`,
			index,
		);
		insertLabel.run(messageId, "lbl1");
	}
});

afterEach(() => {
	vi.unstubAllGlobals();
	sqlite.close();
});

describe("GET /api/messages against SQLite", () => {
	it("keeps label and thread-list parameters within D1 bounds", async () => {
		const response = await GET(
			new Request("https://x.test/api/messages?labelId=lbl1&limit=100"),
		);

		expect(response.status).toBe(200);
		const body = ((await response.json()) as any).data;
		expect(body.total).toBe(101);
		expect(body.messages).toHaveLength(100);
		expect(body.messages.every((message: any) => message.threadCount === 1)).toBe(true);

		expect(queries.length).toBeGreaterThan(0);
		expect(queries.every((query) => query.params.length <= 100)).toBe(true);

		const labelQueries = queries.filter((query) => {
			const sql = query.sql.toLowerCase();
			return sql.includes('"message_labels"') && sql.includes("select");
		});
		expect(labelQueries.length).toBeGreaterThan(0);
		expect(labelQueries.every((query) => query.params.filter((param) => param === "lbl1").length === 1)).toBe(true);

		const aggregateQueries = queries.filter((query) =>
			query.sql.toLowerCase().includes('"messages"."thread_id" in'),
		);
		expect(aggregateQueries).toHaveLength(2);
	});
});
