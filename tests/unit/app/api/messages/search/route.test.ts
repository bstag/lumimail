import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardUser: vi.fn(),
	getContactDisplayNameMap: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/contacts/service", () => ({
	getContactDisplayNameMap: m.getContactDisplayNameMap,
}));
vi.mock("@/lib/email/address", () => ({
	normalizeEmailAddress: (addr: string) => (addr ?? "").toLowerCase(),
}));
vi.mock("@/lib/email/reply-content-utils", () => ({
	getLatestEmailContent: (s: string) => `latest:${s}`,
}));

import { GET } from "@/app/api/messages/search/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.getContactDisplayNameMap.mockReset();
	m.getContactDisplayNameMap.mockResolvedValue(new Map());
});

function get(qs = "") {
	return GET(new Request(`https://x.test/api/messages/search${qs}`));
}

describe("GET /api/messages/search", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ user: null, errorResponse: unauth });
		const res = await get("?q=hi");
		expect(res.status).toBe(401);
	});

	it("searches with no q and no mailbox", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" }, errorResponse: null });
		mock.queueSelect([{ id: "m1", snippet: "s", fromAddr: "A@x", toAddr: "B@x" }]);
		const res = await get();
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.messages[0]).toMatchObject({
			snippet: "latest:s",
			fromContactName: null,
			toContactName: null,
		});
	});

	it("applies the q and mailboxId filters and enriches contact names", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" }, errorResponse: null });
		m.getContactDisplayNameMap.mockResolvedValue(new Map([["a@x", "Alice"]]));
		mock.queueSelect([{ id: "m1", snippet: "s", fromAddr: "A@x", toAddr: "B@x" }]);
		const res = await get("?q=report&mailboxId=mb1");
		const body = (await res.json()) as any;
		expect(body.messages[0].fromContactName).toBe("Alice");
		expect(body.messages[0].toContactName).toBeNull();
	});
});
