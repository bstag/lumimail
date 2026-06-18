import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import { createDomain, createMailbox, getDomains } from "@/app/onboarding/utils";

function jsonResponse(ok: boolean, body: unknown) {
	return { ok, json: async () => body } as unknown as Response;
}

beforeEach(() => {
	authFetch.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("getDomains", () => {
	it("fetches and returns the parsed domain list", async () => {
		const body = { domains: [] };
		authFetch.mockResolvedValue(jsonResponse(true, body));
		await expect(getDomains()).resolves.toBe(body);
		expect(authFetch).toHaveBeenCalledWith("/api/domains");
	});
});

describe("createDomain", () => {
	it("posts the domain with routing and sending enabled (ok=true)", async () => {
		const body = { domain: { id: "dom_1" } };
		authFetch.mockResolvedValue(jsonResponse(true, body));

		const result = await createDomain("example.com");

		expect(result).toEqual({ ok: true, data: body });
		expect(authFetch).toHaveBeenCalledWith("/api/domains", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ hostname: "example.com", enableRouting: true, enableSending: true }),
		});
	});

	it("reports ok=false when the request fails", async () => {
		authFetch.mockResolvedValue(jsonResponse(false, { error: "no" }));
		const result = await createDomain("example.com");
		expect(result.ok).toBe(false);
		expect(result.data).toEqual({ error: "no" });
	});
});

describe("createMailbox", () => {
	it("posts the mailbox using the local part as the display name (ok=true)", async () => {
		const body = { mailbox: { id: "mb_1" } };
		authFetch.mockResolvedValue(jsonResponse(true, body));

		const result = await createMailbox("dom_1", "alice");

		expect(result).toEqual({ ok: true, data: body });
		expect(authFetch).toHaveBeenCalledWith("/api/mailboxes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domainId: "dom_1", localPart: "alice", displayName: "alice" }),
		});
	});

	it("reports ok=false when the request fails", async () => {
		authFetch.mockResolvedValue(jsonResponse(false, { error: "no" }));
		const result = await createMailbox("dom_1", "alice");
		expect(result.ok).toBe(false);
		expect(result.data).toEqual({ error: "no" });
	});
});
