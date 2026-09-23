import { describe, expect, it } from "vitest";
import { describeExternalOAuthResult } from "@/app/(settings)/settings/external-accounts/oauth-result";

function describe_(query: string) {
	return describeExternalOAuthResult(new URLSearchParams(query));
}

describe("describeExternalOAuthResult", () => {
	it("returns nothing when the page was not reached from the OAuth callback", () => {
		expect(describe_("")).toBeNull();
		expect(describe_("tab=other")).toBeNull();
	});

	it("reports a successful connection", () => {
		expect(describe_("connected=exa_1")).toEqual({
			tone: "success",
			message: "External account connected. The initial import will start shortly.",
		});
	});

	it.each([
		["provider-denied", "Authorization was cancelled or denied by the provider. No account was connected."],
		["invalid", "The provider response was incomplete or has expired. Start the connection again."],
		["reauthenticate", "Your password confirmation expired before the provider returned. Confirm your password and connect again."],
		["forbidden", "You no longer have permission to connect an account to that mailbox."],
		["already-connected", "That external account is already connected to this mailbox."],
		["unavailable", "The provider could not be reached or rejected the connection. Try again in a few minutes."],
	])("maps the %s error code to a user message", (code, message) => {
		expect(describe_(`error=${code}`)).toEqual({ tone: "error", message });
	});

	it("uses a generic message for unknown codes without echoing them", () => {
		const result = describe_("error=%3Cscript%3E");
		expect(result).toEqual({ tone: "error", message: "The external account could not be connected. Try again." });
	});

	it("prefers the error when both values are present", () => {
		expect(describe_("connected=exa_1&error=invalid")?.tone).toBe("error");
	});
});
