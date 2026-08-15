import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rateLimitIp: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitIp: h.rateLimitIp }));

import { enforceMcpClientRegistrationPolicy } from "@/lib/mcp/registration-policy";

const request = new Request("https://mail.example/oauth/register", {
	method: "POST",
	headers: { "cf-connecting-ip": "192.0.2.1" },
});

beforeEach(() => h.rateLimitIp.mockReset());

describe("MCP dynamic client registration policy", () => {
	it("rejects unverified software statements before storage", async () => {
		await expect(enforceMcpClientRegistrationPolicy({} as CloudflareEnv, {
			request,
			clientMetadata: { software_statement: "unverified.jwt" },
		})).resolves.toEqual(expect.objectContaining({ code: "unapproved_software_statement", status: 400 }));
		expect(h.rateLimitIp).not.toHaveBeenCalled();
	});

	it("allows a bounded registration", async () => {
		h.rateLimitIp.mockResolvedValue({ allowed: true, remaining: 19 });
		await expect(enforceMcpClientRegistrationPolicy({} as CloudflareEnv, {
			request,
			clientMetadata: { client_name: "Agent" },
		})).resolves.toBeUndefined();
		expect(h.rateLimitIp).toHaveBeenCalledWith(expect.anything(), request, "mcp-client-registration", 20, 3_600_000);
	});

	it("fails closed when the registration budget or its storage is unavailable", async () => {
		h.rateLimitIp.mockResolvedValueOnce({ allowed: false, remaining: 0 });
		await expect(enforceMcpClientRegistrationPolicy({} as CloudflareEnv, {
			request, clientMetadata: {},
		})).resolves.toEqual(expect.objectContaining({ code: "temporarily_unavailable", status: 429 }));
		h.rateLimitIp.mockRejectedValueOnce(new Error("D1 unavailable"));
		await expect(enforceMcpClientRegistrationPolicy({} as CloudflareEnv, {
			request, clientMetadata: {},
		})).resolves.toEqual(expect.objectContaining({ code: "server_error", status: 503 }));
	});
});
