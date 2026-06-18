import { describe, expect, it, vi } from "vitest";
import { createCloudflareProvider } from "@/lib/email/providers/cloudflare";

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
});
