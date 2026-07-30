import { beforeEach, describe, expect, it, vi } from "vitest";

const m = await vi.hoisted(async () => {
	const { createRouteMocks } = await import("../../../helpers/route-mocks");
	return createRouteMocks();
});
vi.mock("@/lib/cloudflare", () => m.cloudflareModule());
vi.mock("@/db", () => m.dbModule());
vi.mock("@/lib/auth/cookies", () => m.cookiesModule());
vi.mock("@/lib/ids", () => ({ newId: () => "lbl_1" }));

import { GET, POST } from "@/app/api/labels/route";
import { jsonRequest } from "../../../helpers/route-mocks";

beforeEach(() => m.reset());

function post(body?: unknown, raw?: string) {
	return jsonRequest("https://x.test/api/labels", body, raw !== undefined ? { rawBody: raw } : {});
}

describe("GET /api/labels", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await GET(new Request("https://x.test/api/labels"));
		expect(res.status).toBe(401);
	});

	it("lists the user's labels", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1", name: "Work" }]);
		const res = await GET(new Request("https://x.test/api/labels"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: [{ id: "lbl_1", name: "Work" }] });
	});
});

describe("POST /api/labels", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await POST(post({ name: "Work" }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for invalid JSON", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await POST(post(undefined, "not json"));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Invalid JSON" } });
	});

	it("returns 400 for an invalid body", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await POST(post({ name: "" }));
		expect(res.status).toBe(400);
		expect(((await res.json()) as any).success).toBe(false);
	});

	it("creates a label with provided color and organizationId", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org1" });
		m.dbMock.queueSelect([{ id: "lbl_1", name: "Work", color: "#abcdef" }]);
		const res = await POST(post({ name: "Work", color: "#abcdef" }));
		expect(res.status).toBe(201);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { id: "lbl_1", name: "Work", color: "#abcdef" },
		});
		expect(m.dbMock.inserts[0].values).toMatchObject({
			id: "lbl_1",
			userId: "u1",
			organizationId: "org1",
			name: "Work",
			color: "#abcdef",
		});
	});

	it("trims the label name (shared createLabelSchema)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1", name: "Work" }]);
		const res = await POST(post({ name: "  Work  " }));
		expect(res.status).toBe(201);
		expect(m.dbMock.inserts[0].values).toMatchObject({ name: "Work" });
	});

	it("rejects a whitespace-only name", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await POST(post({ name: "   " }));
		expect(res.status).toBe(400);
	});

	it("defaults color and null organizationId when omitted", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1" }]);
		const res = await POST(post({ name: "Work" }));
		expect(res.status).toBe(201);
		expect(m.dbMock.inserts[0].values).toMatchObject({
			organizationId: null,
			color: "#6366f1",
		});
	});
});
