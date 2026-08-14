import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ hash: vi.fn(async () => "digest"), id: vi.fn(() => "rfc_claim") }));
vi.mock("@/lib/crypto-utils", () => ({ sha256Hex: h.hash }));
vi.mock("@/lib/ids", () => ({ newId: h.id }));

import { handleMcpOAuthTokenRequest, purgeMcpRefreshTokenUses } from "../../worker-mcp-refresh";

const endpoint = "https://mail.example/oauth/token";
const resource = "https://mail.example/mcp";

function request(fields: Record<string, string>) {
	return new Request(endpoint, {
		method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(fields),
	});
}

function env(claim: string | null = "rfc_claim") {
	const first = vi.fn().mockResolvedValue(claim ? { claimId: claim } : null);
	const run = vi.fn().mockResolvedValue({ success: true });
	const bind = vi.fn(() => ({ first, run }));
	const prepare = vi.fn(() => ({ bind }));
	return { value: { DB: { prepare } } as never, prepare, bind, first, run };
}

describe("MCP refresh-token replay protection", () => {
	it("delegates non-refresh and wrong-resource requests without consuming a claim", async () => {
		for (const fields of [
			{ grant_type: "authorization_code", code: "opaque" },
			{ grant_type: "refresh_token", refresh_token: "usr:grant:token", resource: "https://mail.example/wrong" },
		] as Array<Record<string, string>>) {
			const database = env();
			const providerFetch = vi.fn().mockResolvedValue(new Response("provider", { status: 400 }));
			const response = await handleMcpOAuthTokenRequest(request(fields), database.value, resource, providerFetch);
			expect(response.status).toBe(400);
			expect(providerFetch).toHaveBeenCalledOnce();
			expect(database.prepare).not.toHaveBeenCalled();
		}
	});

	it("atomically retains a digest claim after a successful refresh", async () => {
		const database = env();
		const providerFetch = vi.fn().mockResolvedValue(Response.json({ access_token: "private" }));
		const response = await handleMcpOAuthTokenRequest(request({
			grant_type: "refresh_token", refresh_token: "usr:grant:token", resource,
		}), database.value, resource, providerFetch, () => 1_000_000);
		expect(response.status).toBe(200);
		expect(h.hash).toHaveBeenCalledWith("usr:grant:token");
		expect(database.bind).toHaveBeenCalledWith("digest", "rfc_claim", 1000, expect.any(Number));
		expect(database.prepare).toHaveBeenCalledTimes(1);
	});

	it("rejects a duplicate claim without reaching the provider", async () => {
		const database = env(null);
		const providerFetch = vi.fn();
		const response = await handleMcpOAuthTokenRequest(request({
			grant_type: "refresh_token", refresh_token: "usr:grant:token", resource,
		}), database.value, resource, providerFetch);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual(expect.objectContaining({ error: "invalid_grant" }));
		expect(providerFetch).not.toHaveBeenCalled();
	});

	it("releases only its own claim after a failed provider response", async () => {
		const database = env();
		const providerFetch = vi.fn().mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 }));
		const response = await handleMcpOAuthTokenRequest(request({
			grant_type: "refresh_token", refresh_token: "usr:grant:token", resource,
		}), database.value, resource, providerFetch);
		expect(response.status).toBe(400);
		expect(database.prepare).toHaveBeenCalledTimes(2);
		expect(database.bind).toHaveBeenLastCalledWith("digest", "rfc_claim");
	});

	it("releases its claim and rethrows a provider exception", async () => {
		const database = env();
		await expect(handleMcpOAuthTokenRequest(request({
			grant_type: "refresh_token", refresh_token: "usr:grant:token", resource,
		}), database.value, resource, vi.fn().mockRejectedValue(new Error("provider unavailable"))))
			.rejects.toThrow("provider unavailable");
		expect(database.bind).toHaveBeenLastCalledWith("digest", "rfc_claim");
	});

	it("fails closed when durable claim storage is unavailable", async () => {
		const database = env();
		database.first.mockRejectedValue(new Error("D1 unavailable"));
		const response = await handleMcpOAuthTokenRequest(request({
			grant_type: "refresh_token", refresh_token: "usr:grant:token", resource,
		}), database.value, resource, vi.fn());
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual(expect.objectContaining({ error: "server_error" }));
	});

	it("purges expired digest claims without propagating storage failures", async () => {
		const database = env();
		await expect(purgeMcpRefreshTokenUses(database.value, () => 2_000_000)).resolves.toBeUndefined();
		expect(database.bind).toHaveBeenCalledWith(2000);
		database.run.mockRejectedValueOnce(new Error("D1 unavailable"));
		await expect(purgeMcpRefreshTokenUses(database.value)).resolves.toBeUndefined();
	});
});
