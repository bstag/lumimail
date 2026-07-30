import { beforeEach, describe, expect, it, vi } from "vitest";

const m = await vi.hoisted(async () => {
	const { createRouteMocks } = await import("../../../helpers/route-mocks");
	return createRouteMocks();
});
const normalizeEmailAddress = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cloudflare", () => m.cloudflareModule());
vi.mock("@/db", () => m.dbModule());
vi.mock("@/lib/auth/cookies", () => m.cookiesModule());
vi.mock("@/lib/email/address", () => ({ normalizeEmailAddress }));
vi.mock("@/lib/contacts/utils", () => ({
	getContactId: (userId: string, email: string) => `${userId}:${email}`,
}));

import { GET, POST } from "@/app/api/contacts/route";
import { jsonRequest } from "../../../helpers/route-mocks";

beforeEach(() => {
	m.reset();
	normalizeEmailAddress.mockReset();
	normalizeEmailAddress.mockImplementation((addr: string) => (addr ?? "").trim().toLowerCase());
});

function postReq(body?: unknown, raw?: string) {
	return jsonRequest("https://x.test/api/contacts", body, raw !== undefined ? { rawBody: raw } : {});
}

describe("GET /api/contacts", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: m.unauthorized() });
		const res = await GET(new Request("https://x.test/api/contacts"));
		expect(res.status).toBe(401);
	});

	it("lists the user's contacts", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.dbMock.queueSelect([{ id: "c1", email: "a@x.test" }]);
		const res = await GET(new Request("https://x.test/api/contacts"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: [{ id: "c1", email: "a@x.test" }] });
	});
});

describe("POST /api/contacts", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: m.unauthorized() });
		const res = await POST(postReq({ email: "a@x.test" }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for invalid JSON", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(postReq(undefined, "{not json"));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Invalid JSON" } });
	});

	it("returns 400 for an invalid body", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(postReq({ email: "not-an-email" }));
		expect(res.status).toBe(400);
	});

	it("returns 400 when the normalized email is empty", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		normalizeEmailAddress.mockReturnValueOnce("");
		const res = await POST(postReq({ email: "valid@x.test" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Invalid email address" } });
	});

	it("updates an existing contact (keeps existing displayName when none provided)", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.dbMock.queueSelect([{ id: "c1", displayName: "Old Name" }]); // existing
		m.dbMock.queueSelect([{ id: "c1", displayName: "Old Name", source: "manual" }]); // returning
		const res = await POST(postReq({ email: "valid@x.test" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { id: "c1", displayName: "Old Name", source: "manual" },
		});
		expect(m.dbMock.updates[0].set).toMatchObject({ displayName: "Old Name", source: "manual" });
	});

	it("updates an existing contact using a provided displayName", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.dbMock.queueSelect([{ id: "c1", displayName: "Old Name" }]);
		m.dbMock.queueSelect([{ id: "c1", displayName: "New Name" }]);
		const res = await POST(postReq({ email: "valid@x.test", displayName: "New Name" }));
		expect(res.status).toBe(200);
		expect(m.dbMock.updates[0].set).toMatchObject({ displayName: "New Name" });
	});

	it("creates a new contact when none exists (null displayName default)", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.dbMock.queueSelect([]); // no existing
		m.dbMock.queueSelect([{ id: "u1:valid@x.test", email: "valid@x.test" }]); // returning
		const res = await POST(postReq({ email: "valid@x.test" }));
		expect(res.status).toBe(201);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { id: "u1:valid@x.test", email: "valid@x.test" },
		});
		expect(m.dbMock.inserts[0].values).toMatchObject({
			id: "u1:valid@x.test",
			userId: "u1",
			email: "valid@x.test",
			displayName: null,
			source: "manual",
		});
	});

	it("creates a new contact carrying the provided displayName", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.dbMock.queueSelect([]);
		m.dbMock.queueSelect([{ id: "u1:valid@x.test" }]);
		const res = await POST(postReq({ email: "valid@x.test", displayName: "Jane" }));
		expect(res.status).toBe(201);
		expect(m.dbMock.inserts[0].values).toMatchObject({ displayName: "Jane" });
	});
});
