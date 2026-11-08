import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/ids", () => ({ newId: () => "filter_1" }));

import { GET, POST } from "@/app/api/filters/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset();
});

function post(body: unknown) {
	return new Request("https://x.test/api/filters", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

describe("GET /api/filters", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await GET(new Request("https://x.test/api/filters"));
		expect(res.status).toBe(401);
	});

	it("lists the user's filters", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ id: "filter_1", name: "F" }]);
		const res = await GET(new Request("https://x.test/api/filters"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { filters: [{ id: "filter_1", name: "F" }] } });
	});
});

describe("POST /api/filters", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await POST(post({ name: "F" }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await POST(post({ name: "" }));
		expect(res.status).toBe(400);
		expect(((await res.json()) as any).success).toBe(false);
	});

	it("creates a filter, nulling optional fields when omitted", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await POST(post({ name: "Newsletters", hasWords: "unsubscribe" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { id: "filter_1" } });
		expect(mock.inserts[0].values).toMatchObject({
			id: "filter_1",
			userId: "u1",
			name: "Newsletters",
			fromContains: null,
			toContains: null,
			subjectContains: null,
			hasWords: "unsubscribe",
			matchMode: "all",
			actionFocus: null,
			actionExpireDays: null,
			actionLabelId: null,
			actionStar: false,
			actionMarkRead: false,
			actionArchive: false,
			actionMoveToTrash: false,
		});
	});

	it("rejects a filter with no condition or too many alternatives (F101)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		expect((await POST(post({ name: "Everything", fromContains: "  " }))).status).toBe(400);
		const eleven = Array.from({ length: 11 }, (_, index) => `s${index}.test`).join(",");
		expect((await POST(post({ name: "Many", fromContains: eleven }))).status).toBe(400);
		expect((await POST(post({ name: "Expire", fromContains: "a", actionExpireDays: 0 }))).status).toBe(400);
		expect(mock.inserts).toHaveLength(0);
	});

	it("stores any-of matching, the focus override, and expiry (F101)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await POST(post({
			name: "Deals", fromContains: "amazon.com, ebay.com", matchMode: "any", actionFocus: "other", actionExpireDays: 14,
		}));
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({
			fromContains: "amazon.com, ebay.com", matchMode: "any", actionFocus: "other", actionExpireDays: 14,
		});
	});

	it("creates a filter, preserving provided optional fields", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await POST(
			post({
				name: "Work",
				fromContains: "boss@",
				toContains: "me@",
				subjectContains: "urgent",
				hasWords: "deadline",
				actionLabelId: "lbl_9",
				actionStar: true,
			}),
		);
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({
			fromContains: "boss@",
			toContains: "me@",
			subjectContains: "urgent",
			hasWords: "deadline",
			actionLabelId: "lbl_9",
			actionStar: true,
		});
	});
});
