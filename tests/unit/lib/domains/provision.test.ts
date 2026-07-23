import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cloudflare-api", () => ({
	ensureSendingDomain: vi.fn(),
	enableEmailRouting: vi.fn(),
	findZoneByHostname: vi.fn(),
}));

import { provisionDomainOnCloudflare } from "@/lib/domains/provision";
import { ensureSendingDomain, enableEmailRouting, findZoneByHostname } from "@/lib/cloudflare-api";

const env = {} as CloudflareEnv;
const findZone = vi.mocked(findZoneByHostname);
const enableRouting = vi.mocked(enableEmailRouting);
const ensureSending = vi.mocked(ensureSendingDomain);

const apexZone = { id: "z1", name: "example.com" };

beforeEach(() => {
	vi.clearAllMocks();
});

describe("provisionDomainOnCloudflare", () => {
	it("throws when no zone is found", async () => {
		findZone.mockResolvedValue(null);
		await expect(provisionDomainOnCloudflare(env, "example.com")).rejects.toThrow(
			/Zone not found for "example.com"/,
		);
	});

	it("normalizes the hostname (lowercase + trim) before zone lookup", async () => {
		findZone.mockResolvedValue(apexZone);
		enableRouting.mockResolvedValue({ enabled: true, status: "ready" });

		const result = await provisionDomainOnCloudflare(env, "  Example.COM  ", {
			enableSending: false,
		});

		expect(findZone).toHaveBeenCalledWith(env, "example.com");
		expect(result.hostname).toBe("example.com");
	});

	it("enables routing for the apex without a routing name and uses returned enabled/status", async () => {
		findZone.mockResolvedValue(apexZone);
		enableRouting.mockResolvedValue({ enabled: false, status: "pending" });

		const result = await provisionDomainOnCloudflare(env, "example.com", {
			enableSending: false,
		});

		expect(enableRouting).toHaveBeenCalledWith(env, "z1", undefined);
		expect(result.routingEnabled).toBe(false);
		expect(result.routingStatus).toBe("pending");
		// apex => sending disabled
		expect(result.sendingEnabled).toBe(false);
		expect(result.sendingSubdomainTag).toBeNull();
	});

	it("passes the hostname as routing name for a subdomain and defaults enabled to true when nullish", async () => {
		findZone.mockResolvedValue(apexZone);
		// enabled omitted => routing.enabled ?? true => true
		enableRouting.mockResolvedValue({ status: "ready" });
		ensureSending.mockResolvedValue({ tag: "tag1", name: "mail.example.com", enabled: true });

		const result = await provisionDomainOnCloudflare(env, "mail.example.com");

		expect(enableRouting).toHaveBeenCalledWith(env, "z1", "mail.example.com");
		expect(result.routingEnabled).toBe(true);
		expect(result.routingStatus).toBe("ready");
	});

	it("skips routing when enableRouting is false", async () => {
		findZone.mockResolvedValue(apexZone);
		ensureSending.mockResolvedValue({ tag: "tag1", name: "mail.example.com", enabled: true });

		const result = await provisionDomainOnCloudflare(env, "mail.example.com", {
			enableRouting: false,
		});

		expect(enableRouting).not.toHaveBeenCalled();
		expect(result.routingEnabled).toBe(false);
		expect(result.routingStatus).toBeUndefined();
	});

	it("uses the exact provider sending domain returned for a nested hostname", async () => {
		findZone.mockResolvedValue(apexZone);
		enableRouting.mockResolvedValue({ enabled: true });
		ensureSending.mockResolvedValue({ tag: "tag-existing", name: "mail.example.com", enabled: true });

		const result = await provisionDomainOnCloudflare(env, "mail.example.com");

		expect(ensureSending).toHaveBeenCalledWith(env, "z1", "mail.example.com");
		expect(result.sendingSubdomainTag).toBe("tag-existing");
		expect(result.sendingEnabled).toBe(true);
	});

	it("preserves a provider-pending result", async () => {
		findZone.mockResolvedValue(apexZone);
		enableRouting.mockResolvedValue({ enabled: true });
		ensureSending.mockResolvedValue({ tag: "tag-new", name: "mail.example.com", enabled: false });

		const result = await provisionDomainOnCloudflare(env, "mail.example.com");

		expect(result.sendingSubdomainTag).toBe("tag-new");
		expect(result.sendingEnabled).toBe(false);
	});

	it("onboards an apex domain through the provider instead of hard-coding false", async () => {
		findZone.mockResolvedValue(apexZone);
		enableRouting.mockResolvedValue({ enabled: true });
		ensureSending.mockResolvedValue({ tag: "tag-apex", name: "example.com", enabled: true });

		const result = await provisionDomainOnCloudflare(env, "example.com");

		expect(ensureSending).toHaveBeenCalledWith(env, "z1", "example.com");
		expect(result.sendingEnabled).toBe(true);
		expect(result.sendingSubdomainTag).toBe("tag-apex");
	});

	it("skips sending when enableSending is false", async () => {
		findZone.mockResolvedValue(apexZone);
		enableRouting.mockResolvedValue({ enabled: true });

		const result = await provisionDomainOnCloudflare(env, "mail.example.com", {
			enableSending: false,
		});

		expect(ensureSending).not.toHaveBeenCalled();
		expect(result.sendingEnabled).toBe(false);
		expect(result.sendingSubdomainTag).toBeNull();
	});
});
