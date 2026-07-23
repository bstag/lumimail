import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	authenticateApiKey: vi.fn(),
}));

vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/api/auth", () => ({
	authenticateApiKey: m.authenticateApiKey,
	requireScope: (scopes: string[], scope: string) => scopes.includes(scope),
}));

import { GET } from "@/app/api/v1/session/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.authenticateApiKey.mockReset();
});

function req(auth = "Bearer ep_key") {
	return new Request("https://x.test/api/v1/session", {
		headers: auth ? { authorization: auth } : {},
	});
}

describe("GET /api/v1/session", () => {
	it("returns the key owner and only explicitly assigned mailboxes", async () => {
		m.authenticateApiKey.mockResolvedValue({
			userId: "u1",
			email: "person@example.net",
			organizationId: "o1",
			scopes: ["read", "send"],
		});
		mock.queueSelect([
			{
				id: "mb1",
				localPart: "support",
				hostname: "example.com",
				displayName: "Support",
				role: "responder",
			},
		]);

		const res = await GET(req());

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			data: {
				user: { id: "u1", email: "person@example.net" },
				scopes: ["read", "send"],
				mailboxes: [
					{
						id: "mb1",
						address: "support@example.com",
						displayName: "Support",
						role: "responder",
						canRead: true,
						canSend: true,
					},
				],
			},
		});
	});

	it("derives viewer capabilities without granting send", async () => {
		m.authenticateApiKey.mockResolvedValue({
			userId: "u1",
			email: "viewer@example.net",
			organizationId: "o1",
			scopes: ["read", "send"],
		});
		mock.queueSelect([
			{
				id: "mb1",
				localPart: "info",
				hostname: "example.com",
				displayName: null,
				role: "viewer",
			},
		]);

		const res = await GET(req());
		const body = await res.json() as { data: { mailboxes: Array<{ canRead: boolean; canSend: boolean }> } };

		expect(body.data.mailboxes[0]).toMatchObject({ canRead: true, canSend: false });
	});

	it("rejects an invalid key with the canonical error envelope", async () => {
		m.authenticateApiKey.mockResolvedValue(null);

		const res = await GET(req());

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			success: false,
			error: { message: "Unauthorized" },
		});
	});

	it("returns no mailboxes for a legacy key owner without an organization", async () => {
		m.authenticateApiKey.mockResolvedValue({
			userId: "u1",
			email: "legacy@example.net",
			organizationId: null,
			scopes: ["read"],
		});

		const res = await GET(req());

		expect(await res.json()).toMatchObject({
			data: { mailboxes: [] },
		});
		expect(mock.db.select).not.toHaveBeenCalled();
	});
});
