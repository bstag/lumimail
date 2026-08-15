import { describe, expect, it } from "vitest";
import { parseDeliverySnapshot } from "@/lib/email/outbound/snapshot";

describe("external outbound snapshot", () => {
	it("keeps only a bounded external account id in the immutable payload", () => {
		expect(parseDeliverySnapshot(JSON.stringify({
			from: "a@example.com", to: "b@example.com", subject: "Hi", externalAccountId: "exa_1",
		}))).toMatchObject({ externalAccountId: "exa_1" });
		for (const externalAccountId of ["", "x".repeat(101), 42]) {
			expect(parseDeliverySnapshot(JSON.stringify({
				from: "a@example.com", to: "b@example.com", subject: "Hi", externalAccountId,
			}))).toBeNull();
		}
	});
});
