import { describe, expect, it } from "vitest";
import { forwardRefusalMessage } from "@/app/api/routing-rules/utils";

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
