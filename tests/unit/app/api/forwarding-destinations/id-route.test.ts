import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardOrgAdmin: vi.fn(),
	listDestinationAddresses: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/cloudflare-api", () => ({
	listDestinationAddresses: m.listDestinationAddresses,
}));

import { DELETE } from "@/app/api/forwarding-destinations/[id]/route";
import { POST as REFRESH } from "@/app/api/forwarding-destinations/[id]/refresh/route";

let mock: DbMock;
const params = { params: Promise.resolve({ id: "fwd_1" }) };
const destination = { id: "fwd_1", address: "ops@example.net" };

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockResolvedValue({
		orgUser: { id: "u1", organizationId: "org_1", role: "owner" },
		errorResponse: null,
	});
});

function request() {
	return new Request("https://x.test/api/forwarding-destinations/fwd_1", { method: "POST" });
}

describe("DELETE /api/forwarding-destinations/[id]", () => {
	it("returns the guard response for a non-admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({
			orgUser: null,
			errorResponse: new Response(null, { status: 403 }),
		});

		expect((await DELETE(request(), { params: Promise.resolve({ id: "fwd_1" }) })).status).toBe(403);
	});

	it("returns 404 for a destination owned by another organization", async () => {
		mock.queueSelect([]);

		expect((await DELETE(request(), { params: Promise.resolve({ id: "fwd_1" }) })).status).toBe(404);
		expect(mock.deletes).toHaveLength(0);
	});

	it("refuses while a routing rule still forwards to it", async () => {
		mock.queueSelect([destination]);
		mock.queueSelect([{ id: "rule_1" }]);

		expect((await DELETE(request(), { params: Promise.resolve({ id: "fwd_1" }) })).status).toBe(409);
		expect(mock.deletes).toHaveLength(0);
	});

	// No alias-dependency check: the app never writes a non-null aliases.forwardTo,
	// so routing rules are the only possible dependents.

	it("removes ownership once nothing depends on it", async () => {
		mock.queueSelect([destination]);
		mock.queueSelect([]);

		const res = await DELETE(request(), { params: Promise.resolve({ id: "fwd_1" }) });

		expect(res.status).toBe(200);
		expect(mock.deletes).toHaveLength(1);
	});
});

describe("POST /api/forwarding-destinations/[id]/refresh", () => {
	it("returns the guard response for a non-admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({
			orgUser: null,
			errorResponse: new Response(null, { status: 403 }),
		});

		expect((await REFRESH(request(), params)).status).toBe(403);
	});

	it("returns 404 for a destination owned by another organization", async () => {
		mock.queueSelect([]);

		expect((await REFRESH(request(), params)).status).toBe(404);
	});

	it("records verification once Cloudflare reports it", async () => {
		mock.queueSelect([destination]);
		m.listDestinationAddresses.mockResolvedValue([
			{ email: "OPS@example.net", verified: "2026-07-24T00:00:00Z" },
		]);

		const res = await REFRESH(request(), params);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ data: { verified: true } });
		expect(mock.updates).toHaveLength(1);
	});

	it("clears verification when Cloudflare no longer reports the address", async () => {
		mock.queueSelect([destination]);
		m.listDestinationAddresses.mockResolvedValue([]);

		const res = await REFRESH(request(), params);

		expect(await res.json()).toMatchObject({ data: { verified: false } });
	});

	it("reports a Cloudflare outage without changing stored state", async () => {
		mock.queueSelect([destination]);
		m.listDestinationAddresses.mockRejectedValue(new Error("network"));

		expect((await REFRESH(request(), params)).status).toBe(502);
		expect(mock.updates).toHaveLength(0);
	});
});
