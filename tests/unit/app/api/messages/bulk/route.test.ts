import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));

import { POST } from "@/app/api/messages/bulk/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset();
});

function post(body: unknown) {
	return POST(
		new Request("https://x.test/api/messages/bulk", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	);
}

describe("POST /api/messages/bulk", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await post({ messageIds: ["m1"], action: "trash" });
		expect(res.status).toBe(401);
	});

	it("returns 400 when messageIds is empty (after filtering falsy)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await post({ messageIds: ["", null], action: "trash" });
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ error: "Invalid bulk message action" });
	});

	it("returns 400 when messageIds is omitted", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await post({ action: "trash" });
		expect(res.status).toBe(400);
	});

	it("returns 400 for a disallowed action", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await post({ messageIds: ["m1"], action: "nope" });
		expect(res.status).toBe(400);
	});

	it("applies a status-changing action (trash)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await post({ messageIds: ["m1", "m2"], action: "trash" });
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ ok: true });
		expect(mock.updates[0].set).toEqual({ status: "trash" });
	});

	it("applies the inbox action (maps to received status)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await post({ messageIds: ["m1"], action: "inbox" });
		expect(res.status).toBe(200);
		expect(mock.updates[0].set).toEqual({ status: "received" });
	});

	it("applies a read-changing action (read => read=true)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await post({ messageIds: ["m1"], action: "read" });
		expect(res.status).toBe(200);
		expect(mock.updates[0].set).toEqual({ read: true });
	});

	it("applies the unread action (read=false)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await post({ messageIds: ["m1"], action: "unread" });
		expect(res.status).toBe(200);
		expect(mock.updates[0].set).toEqual({ read: false });
	});

	// NOTE: The `if (Object.keys(values).length === 0)` -> 400 "No changes
	// requested" branch is unreachable: every allowed bulk action (archive,
	// trash, spam, inbox, read, unread) yields a non-empty `values` object via
	// getStatusForBulkAction / getReadValueForBulkAction. Left uncovered by
	// design rather than encoding an impossible state.
});
