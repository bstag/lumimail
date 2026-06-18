import { describe, expect, it } from "vitest";
import { selectOutboundProvider } from "@/lib/email/providers";

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

	it("throws on an unknown provider", () => {
		expect(() =>
			selectOutboundProvider({ MAIL_PROVIDER: "sendgrid" } as CloudflareEnv),
		).toThrow("Unknown MAIL_PROVIDER: sendgrid");
	});
});
