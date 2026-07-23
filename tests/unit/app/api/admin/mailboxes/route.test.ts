import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardOrgAdmin: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));

import { GET } from "@/app/api/admin/mailboxes/route";

let mock: DbMock;
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockReset();
});

describe("GET /api/admin/mailboxes", () => {
	it("returns the organization guard error", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		expect((await GET(new Request("https://x.test/api/admin/mailboxes"))).status).toBe(403);
	});

	it("lists every organization mailbox without granting content access", async () => {
		m.guardOrgAdmin.mockResolvedValue({
			orgUser: { id: "owner_1", organizationId: "org_1", role: "owner", email: "owner@example.com" },
		});
		mock.queueSelect([
			{ id: "mbx_1", localPart: "support", hostname: "example.com", role: "manager" },
			{ id: "mbx_2", localPart: "private", hostname: "example.com", role: null },
		]);
		const response = await GET(new Request("https://x.test/api/admin/mailboxes"));
		expect(response.status).toBe(200);
		expect((await response.json()) as unknown).toEqual({
			mailboxes: [
				{ id: "mbx_1", localPart: "support", hostname: "example.com", role: "manager", isPrimary: false },
				{ id: "mbx_2", localPart: "private", hostname: "example.com", role: null, isPrimary: false },
			],
			canSelfAssign: true,
			currentUserId: "owner_1",
		});
	});

	it("does not offer self-assignment to an organization admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({
			orgUser: { id: "admin_1", organizationId: "org_1", role: "admin", email: "admin@example.com" },
		});
		mock.queueSelect([]);
		const response = await GET(new Request("https://x.test/api/admin/mailboxes"));
		expect((await response.json()) as unknown).toMatchObject({ canSelfAssign: false, currentUserId: "admin_1" });
	});
});
