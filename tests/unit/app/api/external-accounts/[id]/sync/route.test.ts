import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	sync: vi.fn(),
	enforce: vi.fn(),
	rate: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/email/external/account-management", () => ({ requestExternalAccountSync: h.sync }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: h.enforce, rateLimitUser: h.rate }));

import { POST } from "@/app/api/external-accounts/[id]/sync/route";

const params = () => ({ params: Promise.resolve({ id: "exa_1" }) });
const request = (origin = "https://mail.example") => new Request(
	"https://mail.example/api/external-accounts/exa_1/sync", { method: "POST", headers: { origin } },
);

beforeEach(() => {
	vi.clearAllMocks();
	h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.enforce.mockResolvedValue(null);
	h.sync.mockResolvedValue({ status: "accepted", jobId: "exj_1" });
});

describe("POST /api/external-accounts/[id]/sync", () => {
	it("accepts a bounded queued sync", async () => {
		const response = await POST(request(), params());
		expect(response.status).toBe(202);
		expect(((await response.json()) as any).data).toEqual({ jobId: "exj_1" });
	});

	it("enforces origin, organization, configuration, and rate limiting", async () => {
		expect((await POST(request("https://evil.example"), params())).status).toBe(403);
		h.env = {} as CloudflareEnv;
		expect((await POST(request(), params())).status).toBe(503);
		h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
		h.user = { id: "usr_1", organizationId: null };
		expect((await POST(request(), params())).status).toBe(403);
		h.user = { id: "usr_1", organizationId: "org_1" };
		h.enforce.mockImplementation(async (_check, options) => options.respond("limited", 429));
		expect((await POST(request(), params())).status).toBe(429);
	});

	it("maps hidden and conflicting account states", async () => {
		h.sync.mockResolvedValue({ status: "not-found" });
		expect((await POST(request(), params())).status).toBe(404);
		h.sync.mockResolvedValue({ status: "conflict" });
		expect((await POST(request(), params())).status).toBe(409);
	});
});
