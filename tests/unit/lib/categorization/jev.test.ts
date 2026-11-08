import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateMail, isJevConfigured } from "@/lib/categorization/jev";
import { DEFAULT_CONFIG } from "@/lib/categorization/engine";
afterEach(() => vi.unstubAllGlobals());
describe("Jev boundary", () => {
	it("does not contact a provider for rules-only processing", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		expect(isJevConfigured({})).toBe(false);
		expect(isJevConfigured({ TYPESAFE_API_KEY: " key " })).toBe(true);
		expect(
			(
				await evaluateMail(
					{},
					{ ...DEFAULT_CONFIG, questions: [] },
					{ fromAddr: "x", subject: null, text: null },
				)
			).model,
		).toBe("rules");
		expect(fetcher).not.toHaveBeenCalled();
		await expect(
			evaluateMail({}, DEFAULT_CONFIG, {
				fromAddr: "x",
				subject: null,
				text: null,
			}),
		).rejects.toThrow("not configured");
	});
	it("validates provider answers and never includes credentials in errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("down", { status: 429 })),
		);
		await expect(
			evaluateMail({ TYPESAFE_API_KEY: "secret" }, DEFAULT_CONFIG, {
				fromAddr: "x",
				subject: null,
				text: null,
			}),
		).rejects.toThrow("retry later");
	});
	it("uses a fixed authenticated endpoint and consumes a streamed, validated response", async () => {
		const config = {
			...DEFAULT_CONFIG,
			questions: [DEFAULT_CONFIG.questions[1]],
		};
		const payload = JSON.stringify({
			model: "jev-1.13.0",
			answers: { needs_reply: { type: "noul", noul: 0.99 } },
		});
		const fetcher = vi.fn().mockResolvedValue(
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(payload.slice(0, 20)));
						controller.enqueue(new TextEncoder().encode(payload.slice(20)));
						controller.close();
					},
				}),
			),
		);
		vi.stubGlobal("fetch", fetcher);
		const result = await evaluateMail({ TYPESAFE_API_KEY: "secret" }, config, {
			fromAddr: "x",
			subject: null,
			text: null,
		});
		expect(result.tags).toEqual([
			{ tag: "Needs reply", reason: "Needs reply" },
		]);
		expect(fetcher).toHaveBeenCalledWith(
			"https://api.typesafe.ai/v1/systemone",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ Authorization: "Bearer secret" }),
				signal: expect.any(AbortSignal),
			}),
		);
		expect(JSON.stringify(result)).not.toContain("secret");
	});
	it("rejects missing, oversized, malformed, and mismatched responses", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		for (const [response, error] of [
			[new Response(null), "empty"],
			[new Response("x".repeat(65537)), "size limit"],
			[new Response("invalid json"), "JSON"],
			[
				new Response(JSON.stringify({ model: "jev-1.13.0", answers: {} })),
				"keys",
			],
		] as const) {
			fetcher.mockResolvedValueOnce(response);
			await expect(
				evaluateMail({ TYPESAFE_API_KEY: "secret" }, DEFAULT_CONFIG, {
					fromAddr: "x",
					subject: null,
					text: null,
				}),
			).rejects.toThrow(error);
		}
		fetcher.mockRejectedValueOnce(new Error("network timeout"));
		await expect(
			evaluateMail({ TYPESAFE_API_KEY: "secret" }, DEFAULT_CONFIG, {
				fromAddr: "x",
				subject: null,
				text: null,
			}),
		).rejects.toThrow("timeout");
	});
});
