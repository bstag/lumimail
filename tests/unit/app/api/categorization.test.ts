import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
	user: vi.fn(),
	read: vi.fn(),
	activate: vi.fn(),
	preview: vi.fn(),
	jobs: vi.fn(),
	create: vi.fn(),
	run: vi.fn(),
	cancel: vi.fn(),
	correct: vi.fn(),
	insights: vi.fn(),
	limit: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
	rateLimitUser: vi.fn(),
	enforceRateLimit: h.limit,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: h.user }));
vi.mock("@/lib/categorization/service", async () => {
	const actual = await vi.importActual<
		typeof import("@/lib/categorization/service")
	>("@/lib/categorization/service");
	return {
		CategorizationError: actual.CategorizationError,
		readConfiguration: h.read,
		activateConfiguration: h.activate,
		previewConfiguration: h.preview,
		listJobs: h.jobs,
		createJob: h.create,
		runJob: h.run,
		cancelJob: h.cancel,
		correctMessage: h.correct,
		readInsights: h.insights,
	};
});
import { GET, POST } from "@/app/api/categorization/route";
import { POST as preview } from "@/app/api/categorization/preview/route";
import {
	GET as jobs,
	POST as create,
} from "@/app/api/categorization/jobs/route";
import {
	POST as run,
	PATCH as cancel,
} from "@/app/api/categorization/jobs/[id]/route";
import { POST as correct } from "@/app/api/categorization/corrections/route";
import { GET as insights } from "@/app/api/insights/route";
import { DEFAULT_CONFIG } from "@/lib/categorization/engine";
import { CategorizationError } from "@/lib/categorization/service";
const request = (path: string, data: unknown, method = "POST") =>
	new Request(`https://x.test${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
const context = { params: Promise.resolve({ id: "job" }) };
beforeEach(() => {
	vi.resetAllMocks();
	h.limit.mockResolvedValue(null);
	h.user.mockResolvedValue({ id: "u1", organizationId: "org1" });
	for (const fn of [
		h.read,
		h.activate,
		h.preview,
		h.jobs,
		h.create,
		h.run,
		h.cancel,
		h.correct,
		h.insights,
	])
		fn.mockResolvedValue({ ok: true });
});
describe("categorization APIs", () => {
	it("reads configuration and handles unauthorized calls", async () => {
		expect(
			(await GET(new Request("https://x.test/api/categorization"))).status,
		).toBe(200);
		h.user.mockResolvedValue(null);
		expect(
			(await GET(new Request("https://x.test/api/categorization"))).status,
		).toBe(401);
	});
	it("validates activation and preview bodies", async () => {
		expect((await POST(request("/api/categorization", {}))).status).toBe(400);
		expect(
			(
				await POST(
					request("/api/categorization", {
						config: DEFAULT_CONFIG,
						expectedVersion: null,
						automatic: true,
						consent: true,
					}),
				)
			).status,
		).toBe(200);
		expect(
			(
				await preview(
					request("/api/categorization/preview", {
						config: DEFAULT_CONFIG,
						mailboxId: null,
						consent: true,
					}),
				)
			).status,
		).toBe(200);
		expect(
			(await preview(request("/api/categorization/preview", {}))).status,
		).toBe(400);
	});
	it("lists creates runs cancels jobs and validates corrections", async () => {
		expect(
			(await jobs(new Request("https://x.test/api/categorization/jobs")))
				.status,
		).toBe(200);
		expect(
			(await create(request("/api/categorization/jobs", { mailboxId: null })))
				.status,
		).toBe(200);
		expect((await create(request("/api/categorization/jobs", {}))).status).toBe(
			400,
		);
		expect(
			(
				await run(
					request("/api/categorization/jobs/job", { retry: false }),
					context,
				)
			).status,
		).toBe(200);
		expect(
			(await run(request("/api/categorization/jobs/job", {}), context)).status,
		).toBe(400);
		expect(
			(
				await cancel(
					request("/api/categorization/jobs/job", { cancel: true }, "PATCH"),
					context,
				)
			).status,
		).toBe(200);
		expect(
			(
				await cancel(
					request("/api/categorization/jobs/job", {}, "PATCH"),
					context,
				)
			).status,
		).toBe(400);
		expect(
			(
				await correct(
					request("/api/categorization/corrections", {
						messageId: "m1",
						tags: [],
					}),
				)
			).status,
		).toBe(200);
		expect(
			(await correct(request("/api/categorization/corrections", {}))).status,
		).toBe(400);
	});
	it("validates insight queries and shapes service failures safely", async () => {
		expect(
			(
				await insights(
					new Request("https://x.test/api/insights?days=7&offset=0"),
				)
			).status,
		).toBe(200);
		expect(
			(await insights(new Request("https://x.test/api/insights?days=8")))
				.status,
		).toBe(400);
		h.read.mockRejectedValue(new CategorizationError("Not found", 404));
		expect(
			(await GET(new Request("https://x.test/api/categorization"))).status,
		).toBe(404);
		h.read.mockRejectedValue(new Error("secret database failure"));
		const failed = await GET(new Request("https://x.test/api/categorization"));
		expect(failed.status).toBe(503);
		expect(JSON.stringify(await failed.json())).not.toContain("secret");
		expect(
			(
				await insights(
					new Request(
						"https://x.test/api/insights?mailboxId=m1&sender=a@example.com",
					),
				)
			).status,
		).toBe(200);
	});
	it("enforces preview throttling and authenticates every operation", async () => {
		for (const status of [429, 503]) {
			h.limit.mockResolvedValue(new Response(null, { status }));
			expect(
				(
					await preview(
						request("/api/categorization/preview", {
							config: DEFAULT_CONFIG,
							mailboxId: null,
							consent: true,
						}),
					)
				).status,
			).toBe(status);
		}
		expect(h.preview).not.toHaveBeenCalled();
		h.user.mockResolvedValue(null);
		for (const call of [
			() => POST(request("/api/categorization", {})),
			() => preview(request("/api/categorization/preview", {})),
			() => jobs(new Request("https://x.test/api/categorization/jobs")),
			() => create(request("/api/categorization/jobs", {})),
			() => run(request("/api/categorization/jobs/job", {}), context),
			() =>
				cancel(request("/api/categorization/jobs/job", {}, "PATCH"), context),
			() => correct(request("/api/categorization/corrections", {})),
			() => insights(new Request("https://x.test/api/insights")),
		])
			expect((await call()).status).toBe(401);
	});
});
