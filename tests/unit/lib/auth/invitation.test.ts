import { describe, expect, it } from "vitest";
import { hashInvitationToken } from "@/lib/auth/invitation";

describe("invitation token storage", () => {
	it("hashes tokens deterministically without retaining the raw secret", async () => {
		const first = await hashInvitationToken("tok_example-secret");
		const second = await hashInvitationToken("tok_example-secret");

		expect(first).toBe(second);
		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(first).not.toContain("example-secret");
	});

	it("produces a different hash for a rotated token", async () => {
		await expect(hashInvitationToken("tok_one")).resolves.not.toBe(
			await hashInvitationToken("tok_two"),
		);
	});
});
