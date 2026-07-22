import { afterEach, describe, expect, it, vi } from "vitest";
import { submitPasswordReset } from "@/app/reset-password/utils";

afterEach(() => vi.restoreAllMocks());

describe("submitPasswordReset", () => {
	it("posts the link credentials and new password", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({ success: true, data: { ok: true } }),
		);
		await expect(
			submitPasswordReset({ email: "owner@example.com", token: "secret", newPassword: "new-password" }),
		).resolves.toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledWith("/api/auth/reset-password", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "owner@example.com",
				token: "secret",
				newPassword: "new-password",
			}),
		});
	});

	it("rejects an invalid or expired token response", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json(
				{ success: false, error: { message: "Invalid or expired token" } },
				{ status: 400 },
			),
		);
		await expect(
			submitPasswordReset({ email: "owner@example.com", token: "used", newPassword: "new-password" }),
		).rejects.toThrow("Invalid or expired token");
	});
});
