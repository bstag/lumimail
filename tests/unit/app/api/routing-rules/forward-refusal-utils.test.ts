import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { firstZodMessage, forwardRefusalMessage } from "@/app/api/routing-rules/utils";

describe("forwardRefusalMessage", () => {
	it("explains each refusal reason without exposing internal state", () => {
		expect(forwardRefusalMessage("invalid_address")).toBe(
			"A valid forwarding destination is required",
		);
		expect(forwardRefusalMessage("managed_domain")).toBe(
			"Cannot forward to an address on a domain Lumimail manages",
		);
		expect(forwardRefusalMessage("not_verified")).toBe(
			"That destination has not confirmed Cloudflare's verification email yet",
		);
		expect(forwardRefusalMessage("not_owned")).toBe(
			"Register this forwarding destination before using it",
		);
	});
});

describe("firstZodMessage", () => {
	it("names the offending field so the envelope's single string stays useful", () => {
		const result = z.object({ priority: z.number() }).safeParse({ priority: "high" });

		expect(result.success).toBe(false);
		expect(firstZodMessage(result.error!)).toMatch(/^priority: /);
	});

	it("returns the bare message when the issue has no path to name", () => {
		const result = z.number().safeParse("nope");

		// No field prefix is prepended; the message is passed through unchanged.
		expect(firstZodMessage(result.error!)).toBe(result.error!.issues[0].message);
	});

	it("falls back when an error carries no issues at all", () => {
		expect(firstZodMessage(new ZodError([]))).toBe("Invalid request");
	});
});
