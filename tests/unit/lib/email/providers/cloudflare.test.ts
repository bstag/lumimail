import { describe, expect, it, vi } from "vitest";
import { createCloudflareProvider } from "@/lib/email/providers/cloudflare";
import { OutboundProviderError } from "@/lib/email/providers/types";

function makeEnv(send: ReturnType<typeof vi.fn>) {
	return { EMAIL: { send } } as unknown as CloudflareEnv;
}

describe("createCloudflareProvider", () => {
	it("exposes the cloudflare id", () => {
		const provider = createCloudflareProvider(makeEnv(vi.fn()));
		expect(provider.id).toBe("cloudflare");
	});

	it("forwards the message to env.EMAIL.send and normalizes the result", async () => {
		const send = vi.fn().mockResolvedValue({ messageId: "cf-123" });
		const provider = createCloudflareProvider(makeEnv(send));

		const result = await provider.send({
			from: "agent@example.com",
			to: "user@elsewhere.com",
			subject: "Hi",
			html: "<p>Hi</p>",
			text: "Hi",
		});

		expect(send).toHaveBeenCalledWith({
			from: "agent@example.com",
			to: "user@elsewhere.com",
			subject: "Hi",
			html: "<p>Hi</p>",
			text: "Hi",
		});
		expect(result).toEqual({ providerMessageId: "cf-123" });
	});

	it("passes undefined html/text through unchanged", async () => {
		const send = vi.fn().mockResolvedValue({ messageId: "cf-456" });
		const provider = createCloudflareProvider(makeEnv(send));

		await provider.send({ from: "a@example.com", to: "b@example.com", subject: "S" });

		expect(send).toHaveBeenCalledWith({
			from: "a@example.com",
			to: "b@example.com",
			subject: "S",
			html: undefined,
			text: undefined,
		});
	});

	it.each([
		["E_RATE_LIMIT_EXCEEDED", true],
		["E_DELIVERY_FAILED", true],
		["E_INTERNAL_SERVER_ERROR", true],
		["E_SENDER_NOT_VERIFIED", false],
		[undefined, false],
	] as const)("normalizes provider error %s with retryable=%s", async (code, retryable) => {
		const original = Object.assign(new Error("Cloudflare rejected the send"), { code });
		const provider = createCloudflareProvider(makeEnv(vi.fn().mockRejectedValue(original)));

		const promise = provider.send({ from: "a@example.com", to: "b@example.com", subject: "S" });
		await expect(promise).rejects.toBeInstanceOf(OutboundProviderError);
		await expect(promise).rejects.toMatchObject({
			message: "Cloudflare rejected the send",
			code,
			retryable,
		});
	});

	it.each([
		["non-error", "Cloudflare email send failed", undefined],
		[Object.assign(new Error(""), { code: 42 }), "Cloudflare email send failed", undefined],
	] as const)("normalizes malformed thrown values", async (thrown, message, code) => {
		const provider = createCloudflareProvider(makeEnv(vi.fn().mockRejectedValue(thrown)));
		await expect(
			provider.send({ from: "a@example.com", to: "b@example.com", subject: "S" }),
		).rejects.toMatchObject({ message, code, retryable: false });
	});
});
