import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardOrgAdmin: vi.fn(),
	createDestinationAddress: vi.fn(),
	listDestinationAddresses: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/cloudflare-api", () => ({
	createDestinationAddress: m.createDestinationAddress,
	listDestinationAddresses: m.listDestinationAddresses,
}));
vi.mock("@/lib/ids", () => ({ newId: (p?: string) => `${p}_new` }));

import { GET, POST } from "@/app/api/forwarding-destinations/route";

let mock: DbMock;

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockResolvedValue({
		orgUser: { id: "u1", organizationId: "org_1", role: "owner" },
		errorResponse: null,
	});
});

function post(address: unknown) {
	return POST(new Request("https://x.test/api/forwarding-destinations", {
		method: "POST",
		body: JSON.stringify({ address }),
	}));
}

describe("GET /api/forwarding-destinations", () => {
	it("returns the guard response for a non-admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({
			orgUser: null,
			errorResponse: new Response(null, { status: 403 }),
		});

		expect((await GET(new Request("https://x.test"))).status).toBe(403);
	});

	it("reports verification state for the organization's destinations", async () => {
		mock.queueSelect([
			{ id: "fwd_1", address: "ops@example.net", verifiedAt: new Date(), lastCheckedAt: null, createdAt: new Date() },
			{ id: "fwd_2", address: "pending@example.net", verifiedAt: null, lastCheckedAt: null, createdAt: new Date() },
		]);

		const body = (await (await GET(new Request("https://x.test"))).json()) as {
			data: { address: string; verified: boolean }[];
		};

		expect(body.data.map((row) => [row.address, row.verified])).toEqual([
			["ops@example.net", true],
			["pending@example.net", false],
		]);
	});
});

describe("POST /api/forwarding-destinations", () => {
	it("returns the guard response for a non-admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({
			orgUser: null,
			errorResponse: new Response(null, { status: 403 }),
		});

		expect((await post("ops@example.net")).status).toBe(403);
	});

	it("rejects a malformed address", async () => {
		expect((await post("not-an-address")).status).toBe(400);
		expect((await post(42)).status).toBe(400);
	});

	it("refuses an address on a domain Lumimail manages", async () => {
		mock.queueSelect([{ id: "dom_1" }]);

		expect((await post("someone@managed.com")).status).toBe(422);
		expect(m.createDestinationAddress).not.toHaveBeenCalled();
	});

	it("refuses a duplicate registration", async () => {
		mock.queueSelect([]);
		mock.queueSelect([{ id: "fwd_1" }]);

		expect((await post("ops@example.net")).status).toBe(409);
		expect(m.createDestinationAddress).not.toHaveBeenCalled();
	});

	it("registers a new destination as unverified and asks Cloudflare to verify it", async () => {
		mock.queueSelect([]);
		mock.queueSelect([]);
		m.createDestinationAddress.mockResolvedValue({ email: "ops@example.net", verified: null });

		const res = await post("  OPS@Example.net ");

		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({
			success: true,
			data: { id: "fwd_new", address: "ops@example.net", verified: false },
		});
		expect(m.createDestinationAddress).toHaveBeenCalledWith(expect.anything(), "ops@example.net");
		expect(mock.inserts).toHaveLength(1);
	});

	it("records immediate verification when Cloudflare already trusts the address", async () => {
		mock.queueSelect([]);
		mock.queueSelect([]);
		m.createDestinationAddress.mockResolvedValue({
			email: "ops@example.net",
			verified: "2026-07-24T00:00:00Z",
		});

		const res = await post("ops@example.net");

		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ data: { verified: true } });
	});

	it("adopts an existing account address that is still unverified", async () => {
		mock.queueSelect([]);
		mock.queueSelect([]);
		m.createDestinationAddress.mockRejectedValue(new Error("already exists"));
		m.listDestinationAddresses.mockResolvedValue([
			{ email: "ops@example.net", verified: null },
		]);

		const res = await post("ops@example.net");

		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ data: { verified: false } });
	});

	it("adopts an address already verified elsewhere on the account", async () => {
		mock.queueSelect([]);
		mock.queueSelect([]);
		m.createDestinationAddress.mockRejectedValue(new Error("already exists"));
		m.listDestinationAddresses.mockResolvedValue([
			{ email: "OPS@example.net", verified: "2026-07-24T00:00:00Z" },
		]);

		const res = await post("ops@example.net");

		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ data: { verified: true } });
	});

	it("fails when Cloudflare rejects the address and it is not listed", async () => {
		mock.queueSelect([]);
		mock.queueSelect([]);
		m.createDestinationAddress.mockRejectedValue(new Error("bad"));
		m.listDestinationAddresses.mockResolvedValue([]);

		expect((await post("ops@example.net")).status).toBe(502);
		expect(mock.inserts).toHaveLength(0);
	});

	it("fails when Cloudflare cannot be reached at all", async () => {
		mock.queueSelect([]);
		mock.queueSelect([]);
		m.createDestinationAddress.mockRejectedValue(new Error("bad"));
		m.listDestinationAddresses.mockRejectedValue(new Error("network"));

		expect((await post("ops@example.net")).status).toBe(502);
		expect(mock.inserts).toHaveLength(0);
	});

	it("rejects a body that is not valid JSON", async () => {
		const res = await POST(new Request("https://x.test/api/forwarding-destinations", {
			method: "POST",
			body: "{",
		}));

		expect(res.status).toBe(400);
	});
});
