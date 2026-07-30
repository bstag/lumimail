import { describe, expect, it } from "vitest";
import { selectOutboundProvider } from "@/lib/email/providers";
import { OutboundProviderError } from "@/lib/email/providers/types";

describe("selectOutboundProvider", () => {
	it("defaults to cloudflare when MAIL_PROVIDER is unset", () => {
		const provider = selectOutboundProvider({ EMAIL: {} } as unknown as CloudflareEnv);
		expect(provider.id).toBe("cloudflare");
	});

	it("selects cloudflare explicitly", () => {
		const provider = selectOutboundProvider({ MAIL_PROVIDER: "cloudflare", EMAIL: {} } as unknown as CloudflareEnv);
		expect(provider.id).toBe("cloudflare");
	});

	it("selects resend and is case/whitespace insensitive", () => {
		const provider = selectOutboundProvider({
			MAIL_PROVIDER: "  ReSeNd ",
			RESEND_API_KEY: "re_x",
		} as CloudflareEnv);
		expect(provider.id).toBe("resend");
	});

	it("throws a retryable provider error on an unknown provider", () => {
		let thrown: unknown;
		try {
			selectOutboundProvider({ MAIL_PROVIDER: "sendgrid" } as CloudflareEnv);
		} catch (error) {
			thrown = error;
		}
		// Config errors must be retryable: a transient deploy misconfiguration
		// (wrong MAIL_PROVIDER) must not permanently fail queued jobs.
		expect(thrown).toBeInstanceOf(OutboundProviderError);
		expect((thrown as OutboundProviderError).retryable).toBe(true);
		expect((thrown as OutboundProviderError).code).toBe("PROVIDER_CONFIG");
		expect((thrown as Error).message).toContain("Unknown MAIL_PROVIDER: sendgrid");
	});
});
