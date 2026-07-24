import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
	guardOrgOwner: vi.fn(),
	read: vi.fn(),
	run: vi.fn(),
	env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgOwner: h.guardOrgOwner }));
vi.mock("@/lib/queue-health", () => ({
	readQueueHealthSnapshots: h.read,
	runQueueHealthCheck: h.run,
}));

import { GET, POST } from "@/app/api/admin/queue-health/route";

const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const queues = [{
	queue: "inbound",
	label: "Inbound mail",
	status: "healthy",
	backlogCount: 0,
	backlogBytes: 0,
	oldestMessageAt: null,
	staleJobCount: 0,
	detail: null,
	checkedAt: "2026-07-24T12:00:00.000Z",
}];

beforeEach(() => {
	vi.clearAllMocks();
	h.guardOrgOwner.mockResolvedValue({
		orgUser: { id: "owner_1", organizationId: "org_1", role: "owner" },
		errorResponse: null,
	});
});

describe("/api/admin/queue-health", () => {
	it("rejects non-owners for both methods", async () => {
		h.guardOrgOwner.mockResolvedValue({ orgUser: null, errorResponse: forbidden });
		expect((await GET(new Request("https://x.test/api/admin/queue-health"))).status).toBe(403);
		expect((await POST(new Request("https://x.test/api/admin/queue-health", { method: "POST" }))).status).toBe(403);
		expect(h.read).not.toHaveBeenCalled();
		expect(h.run).not.toHaveBeenCalled();
	});

	it("returns the latest snapshots without running a check", async () => {
		h.read.mockResolvedValue(queues);
		const response = await GET(new Request("https://x.test/api/admin/queue-health"));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ queues });
		expect(h.run).not.toHaveBeenCalled();
	});

	it("runs a manual check and returns its snapshots", async () => {
		h.run.mockResolvedValue(queues);
		const response = await POST(new Request("https://x.test/api/admin/queue-health", { method: "POST" }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ queues });
		expect(h.run).toHaveBeenCalledWith(h.env);
	});
});
