import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	guardOrgOwner: vi.fn(),
	reportR2Retention: vi.fn(),
	deleteR2Orphans: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgOwner: m.guardOrgOwner }));
vi.mock("@/lib/r2-retention", () => ({
	reportR2Retention: m.reportR2Retention,
	deleteR2Orphans: m.deleteR2Orphans,
}));

import { GET, POST } from "@/app/api/admin/r2-retention/route";

const report = { scanned: 10, orphans: 3, bytes: 900, oldestUploadedAt: null, sample: [] };

beforeEach(() => {
	vi.clearAllMocks();
	m.guardOrgOwner.mockResolvedValue({ orgUser: { id: "u1" }, errorResponse: null });
	m.reportR2Retention.mockResolvedValue(report);
	m.deleteR2Orphans.mockResolvedValue({ deleted: 3, bytes: 900, remaining: 0 });
});

function post(body: unknown) {
	return POST(new Request("https://x.test/api/admin/r2-retention", {
		method: "POST",
		body: JSON.stringify(body),
	}));
}

describe("GET /api/admin/r2-retention", () => {
	it("denies a non-owner", async () => {
		m.guardOrgOwner.mockResolvedValue({
			orgUser: null,
			errorResponse: new Response(null, { status: 403 }),
		});

		expect((await GET(new Request("https://x.test"))).status).toBe(403);
		expect(m.reportR2Retention).not.toHaveBeenCalled();
	});

	it("reports without deleting anything", async () => {
		const res = await GET(new Request("https://x.test"));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, data: report });
		expect(m.deleteR2Orphans).not.toHaveBeenCalled();
	});
});

describe("POST /api/admin/r2-retention", () => {
	it("denies a non-owner", async () => {
		m.guardOrgOwner.mockResolvedValue({
			orgUser: null,
			errorResponse: new Response(null, { status: 403 }),
		});

		expect((await post({ confirm: "delete" })).status).toBe(403);
		expect(m.deleteR2Orphans).not.toHaveBeenCalled();
	});

	it("requires the exact confirmation string", async () => {
		expect((await post({})).status).toBe(400);
		expect((await post({ confirm: true })).status).toBe(400);
		expect((await post({ confirm: "DELETE" })).status).toBe(400);
		expect(m.deleteR2Orphans).not.toHaveBeenCalled();
	});

	it("rejects a body that is not valid JSON", async () => {
		const res = await POST(new Request("https://x.test/api/admin/r2-retention", {
			method: "POST",
			body: "{",
		}));

		expect(res.status).toBe(400);
		expect(m.deleteR2Orphans).not.toHaveBeenCalled();
	});

	it("deletes once confirmed", async () => {
		const res = await post({ confirm: "delete" });

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			data: { deleted: 3, bytes: 900, remaining: 0 },
		});
		expect(m.deleteR2Orphans).toHaveBeenCalledWith(expect.anything(), { limit: undefined });
	});

	it("passes a positive limit through and ignores an invalid one", async () => {
		await post({ confirm: "delete", limit: 50 });
		expect(m.deleteR2Orphans).toHaveBeenCalledWith(expect.anything(), { limit: 50 });

		await post({ confirm: "delete", limit: -1 });
		expect(m.deleteR2Orphans).toHaveBeenLastCalledWith(expect.anything(), { limit: undefined });

		await post({ confirm: "delete", limit: "many" });
		expect(m.deleteR2Orphans).toHaveBeenLastCalledWith(expect.anything(), { limit: undefined });
	});
});
