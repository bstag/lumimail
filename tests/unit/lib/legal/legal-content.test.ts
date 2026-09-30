import { describe, expect, it } from "vitest";
import { getExternalOAuthProvider } from "@/lib/email/external/oauth-provider";
import {
	LEGAL_OPERATOR,
	googleScopeDisclosures,
	privacyPolicy,
	termsOfService,
	type LegalDocument,
} from "@/lib/legal/legal-content";

const documents: Array<[string, LegalDocument]> = [
	["privacy policy", privacyPolicy],
	["terms of service", termsOfService],
];

function fullText(document: LegalDocument): string {
	return [
		document.title,
		document.summary,
		...document.sections.flatMap((section) => [
			section.title,
			...(section.paragraphs ?? []),
			...(section.items ?? []),
			...(section.links ?? []).map((link) => link.label),
		]),
	].join("\n");
}

describe("legal content", () => {
	it("names the operator, the service, and a contact address", () => {
		expect(LEGAL_OPERATOR).toEqual({
			company: "Stagware",
			service: "Picket",
			contactEmail: "support@henriksen.dev",
			origin: "https://mail.henriksen.dev",
		});
		for (const [, document] of documents) {
			const text = fullText(document);
			expect(text).toContain("Stagware");
			expect(text).toContain("Picket");
			expect(text).toContain("support@henriksen.dev");
		}
	});

	it.each(documents)("%s has a valid, non-future ISO effective date", (_name, document) => {
		expect(document.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const parsed = new Date(`${document.effectiveDate}T00:00:00Z`);
		expect(Number.isNaN(parsed.getTime())).toBe(false);
		expect(parsed.getTime()).toBeLessThanOrEqual(Date.now());
	});

	it.each(documents)("%s has unique kebab-case section ids and no empty content", (_name, document) => {
		const ids = document.sections.map((section) => section.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const section of document.sections) {
			expect(section.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
			expect(section.title.trim()).not.toBe("");
			const blocks = [...(section.paragraphs ?? []), ...(section.items ?? [])];
			expect(blocks.length).toBeGreaterThan(0);
			for (const block of blocks) expect(block.trim()).not.toBe("");
		}
	});

	it.each(documents)("%s has only https or mailto links and no unfilled placeholders", (_name, document) => {
		for (const section of document.sections) {
			for (const link of section.links ?? []) {
				expect(link.href).toMatch(/^(https:\/\/|mailto:)/);
				expect(link.label.trim()).not.toBe("");
			}
		}
		expect(fullText(document)).not.toMatch(/TODO|TBD|lorem|\[[A-Za-z ]+\]|example\.com/i);
	});

	it("cross-checks its disclosed Google scopes against the scopes the OAuth code requests", () => {
		const requested = getExternalOAuthProvider({
			PUBLIC_APP_URL: LEGAL_OPERATOR.origin,
			GOOGLE_OAUTH_CLIENT_ID: "id",
			GOOGLE_OAUTH_CLIENT_SECRET: "secret",
		} as unknown as CloudflareEnv, "google").scopes;

		expect(googleScopeDisclosures.map((item) => item.scope).sort()).toEqual([...requested].sort());
		const text = fullText(privacyPolicy);
		for (const item of googleScopeDisclosures) {
			expect(item.purpose.trim()).not.toBe("");
			expect(text).toContain(item.scope);
			expect(text).toContain(item.purpose);
		}
	});

	it("carries the Google Limited Use commitment and the required data-handling disclosures", () => {
		const text = fullText(privacyPolicy);
		expect(text).toContain(
			"adhere to the Google API Services User Data Policy, including the Limited Use requirements",
		);
		expect(text).toMatch(/does not read|do not read/i);
		expect(text).toMatch(/advertis/i);
		expect(text).toMatch(/sell/i);
		expect(text).toMatch(/AI or machine-learning|machine learning/i);
		expect(text).toMatch(/everyone with read access/i);
		expect(text).toMatch(/myaccount\.google\.com\/permissions/);
		expect(text).toMatch(/Disconnect/);
	});

	it("links to Google's user data policy and permission management", () => {
		const hrefs = privacyPolicy.sections.flatMap((section) => (section.links ?? []).map((link) => link.href));
		expect(hrefs).toContain("https://developers.google.com/terms/api-services-user-data-policy");
		expect(hrefs).toContain("https://myaccount.google.com/permissions");
		expect(hrefs).toContain(`mailto:${LEGAL_OPERATOR.contactEmail}`);
	});

	it("does not overstate the service as a backup and states the shared-mailbox visibility", () => {
		const text = fullText(termsOfService);
		expect(text).toMatch(/not a backup/i);
		expect(text).toMatch(/as is/i);
		expect(text).toMatch(/acceptable use/i);
	});
});
