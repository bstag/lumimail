import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPasswordReset } from "@/app/forgot-password/utils";

afterEach(() => vi.restoreAllMocks());

describe("requestPasswordReset", () => {
	it("posts the email and returns the canonical acknowledgement", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({ success: true, data: { message: "Check your email" } }),
		);
		await expect(requestPasswordReset("owner@example.com")).resolves.toBe("Check your email");
		expect(fetchMock).toHaveBeenCalledWith("/api/auth/forgot-password", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "owner@example.com" }),
		});
	});

	it("rejects canonical API errors", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json(
				{ success: false, error: { message: "A valid email is required" } },
				{ status: 400 },
			),
		);
		await expect(requestPasswordReset("bad")).rejects.toThrow("A valid email is required");
	});
});
