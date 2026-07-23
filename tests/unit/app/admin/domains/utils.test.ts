import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { createDomain, fetchDomainDns, reconcileDomainSending } from "@/app/(admin)/domains/utils";

beforeEach(() => authFetch.mockReset());

describe("admin domain requests", () => {
	it("unwraps a created domain", async () => {
		const data = { domain: { id: "dom_1", hostname: "example.com" }, dns: {} };
		authFetch.mockResolvedValue(Response.json({ success: true, data }));
		await expect(createDomain("example.com")).resolves.toEqual(data);
	});

	it("surfaces the canonical domain creation error", async () => {
		authFetch.mockResolvedValue(
			Response.json({ success: false, error: { message: "Domain already exists" } }, { status: 409 }),
		);
		await expect(createDomain("example.com")).rejects.toThrow("Domain already exists");
	});

	it("unwraps DNS details", async () => {
		const data = {
			domain: { id: "dom_1", hostname: "example.com" },
			dns: { routing: {}, sending: { enabled: true, records: [] } },
		};
		authFetch.mockResolvedValue(Response.json({ success: true, data }));
		await expect(fetchDomainDns("dom_1")).resolves.toEqual(data);
		expect(authFetch).toHaveBeenCalledWith("/api/domains/dom_1/dns");
	});

	it.each(["verify", "enable"] as const)("requests a provider-backed %s action", async (action) => {
		const data = {
			domain: { id: "dom_1", hostname: "example.com", sendingEnabled: action === "enable" },
			dns: { sending: { enabled: action === "enable", records: [] } },
		};
		authFetch.mockResolvedValue(Response.json({ success: true, data }));

		await expect(reconcileDomainSending("dom_1", action)).resolves.toEqual(data);
		expect(authFetch).toHaveBeenCalledWith("/api/domains/dom_1/sending", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action }),
		});
	});

	it("surfaces a safe provider reconciliation error", async () => {
		authFetch.mockResolvedValue(
			Response.json(
				{ success: false, error: { message: "Cloudflare could not verify Email Sending" } },
				{ status: 400 },
			),
		);
		await expect(reconcileDomainSending("dom_1", "verify")).rejects.toThrow(
			"Cloudflare could not verify Email Sending",
		);
	});
});
