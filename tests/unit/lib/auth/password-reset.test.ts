import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@/lib/email/providers", () => ({
	selectOutboundProvider: vi.fn(() => ({ id: "test", send })),
}));

import {
	buildPasswordResetLink,
	hashPasswordResetToken,
	sendPasswordResetEmail,
} from "@/lib/auth/password-reset";

beforeEach(() => {
	send.mockReset().mockResolvedValue({ providerMessageId: "provider_1" });
});

describe("password reset helpers", () => {
	it("hashes a high-entropy token deterministically without retaining the token", async () => {
		await expect(hashPasswordResetToken("pwr_secret")).resolves.toBe(
			"62f22985250b538d346fb28579739c1c43d8ba88086a4f60b1c4b419a23693fe",
		);
	});

	it("builds a reset link from the configured public URL", () => {
		expect(
			buildPasswordResetLink("https://mail.example.com/base", "pwr_secret", "Owner@Example.com"),
		).toBe(
			"https://mail.example.com/reset-password?token=pwr_secret&email=Owner%40Example.com",
		);
	});

	it("rejects an invalid or non-HTTPS public URL", () => {
		expect(() => buildPasswordResetLink("not-a-url", "token", "a@example.com")).toThrow(
			"PUBLIC_APP_URL must be a valid HTTPS URL",
		);
		expect(() => buildPasswordResetLink("http://mail.example.com", "token", "a@example.com")).toThrow(
			"PUBLIC_APP_URL must be a valid HTTPS URL",
		);
	});

	it("sends plain-text and HTML recovery mail through the configured provider", async () => {
		const env = {
			PASSWORD_RESET_FROM: "noreply@example.com",
		} as CloudflareEnv;
		const resetLink = "https://mail.example.com/reset-password?token=secret&email=a%40example.com";

		await sendPasswordResetEmail(env, "recovery@example.net", resetLink);

		expect(send).toHaveBeenCalledWith({
			from: "noreply@example.com",
			to: "recovery@example.net",
			subject: "Reset your Lumimail password",
			text: expect.stringContaining(resetLink),
			html: expect.stringContaining(resetLink.replaceAll("&", "&amp;")),
		});
	});

	it("requires an explicitly configured sender", async () => {
		await expect(
			sendPasswordResetEmail({} as CloudflareEnv, "recovery@example.net", "https://app.test/reset"),
		).rejects.toThrow("PASSWORD_RESET_FROM is required");
		expect(send).not.toHaveBeenCalled();
	});
});
