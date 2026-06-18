import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

vi.mock("@/lib/ids", () => ({ newId: vi.fn(() => "dom_new") }));

vi.mock("@/lib/cloudflare-api", () => ({
	disableEmailRouting: vi.fn(),
	getEmailRoutingDns: vi.fn(),
	getEmailRoutingSettings: vi.fn(),
	getSendingSubdomainDns: vi.fn(),
	deleteSendingSubdomain: vi.fn(),
}));

vi.mock("@/lib/domains/cloudflare-cleanup", () => ({
	deleteEmailRoutingRulesForDomain: vi.fn(),
}));

vi.mock("@/lib/domains/provision", () => ({
	provisionDomainOnCloudflare: vi.fn(),
}));

import {
	addDomainForUser,
	getDomainDns,
	getDomainForUser,
	listUserDomains,
	removeDomainForUser,
} from "@/lib/domains/service";
import {
	disableEmailRouting,
	getEmailRoutingDns,
	getEmailRoutingSettings,
	getSendingSubdomainDns,
	deleteSendingSubdomain,
} from "@/lib/cloudflare-api";
import { deleteEmailRoutingRulesForDomain } from "@/lib/domains/cloudflare-cleanup";
import { provisionDomainOnCloudflare } from "@/lib/domains/provision";

const env = {} as CloudflareEnv;
let mock: DbMock;

const provisionMock = vi.mocked(provisionDomainOnCloudflare);
const routingDnsMock = vi.mocked(getEmailRoutingDns);
const routingSettingsMock = vi.mocked(getEmailRoutingSettings);
const sendingDnsMock = vi.mocked(getSendingSubdomainDns);
const cleanupMock = vi.mocked(deleteEmailRoutingRulesForDomain);
const disableRoutingMock = vi.mocked(disableEmailRouting);
const deleteSubMock = vi.mocked(deleteSendingSubdomain);

function defaultDnsMocks() {
	routingDnsMock.mockResolvedValue({ records: [{ id: "rec" } as never], missing: [] });
	routingSettingsMock.mockResolvedValue({ status: "ready" });
	sendingDnsMock.mockResolvedValue([{ id: "send" } as never]);
}

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	h.db = mock.db;
});

describe("listUserDomains", () => {
	it("returns the rows for the organization", async () => {
		mock.queueSelect([{ id: "dom_1", organizationId: "org1" }]);
		const rows = await listUserDomains(env, "org1");
		expect(rows).toEqual([{ id: "dom_1", organizationId: "org1" }]);
	});
});

describe("addDomainForUser", () => {
	const baseProvisioned = {
		hostname: "mail.example.com",
		zone: { id: "z1", name: "example.com" },
		routingEnabled: true,
		sendingEnabled: true,
		sendingSubdomainTag: "tag1",
		routingStatus: "ready",
	};

	it("throws when the domain belongs to a different organization", async () => {
		provisionMock.mockResolvedValue(baseProvisioned);
		mock.queueSelect([{ id: "dom_x", organizationId: "other-org", hostname: "mail.example.com" }]);

		await expect(addDomainForUser(env, "u1", "org1", "mail.example.com")).rejects.toThrow(
			"Domain is already registered",
		);
	});

	it("inserts a new domain (active status) when none exists and reads it back with DNS", async () => {
		provisionMock.mockResolvedValue(baseProvisioned);
		defaultDnsMocks();
		// existing lookup -> none; read-back -> the row
		mock
			.queueSelect([])
			.queueSelect([{ id: "dom_new", hostname: "mail.example.com", zoneId: "z1", sendingSubdomainTag: "tag1" }]);

		const result = await addDomainForUser(env, "u1", "org1", "Mail.Example.com");

		expect(mock.inserts).toHaveLength(1);
		expect(mock.updates).toHaveLength(0);
		expect(mock.inserts[0].values).toMatchObject({
			id: "dom_new",
			userId: "u1",
			organizationId: "org1",
			hostname: "mail.example.com",
			zoneId: "z1",
			status: "active",
			routingStatus: "ready",
			sendingSubdomainTag: "tag1",
			sendingEnabled: true,
			routingEnabled: true,
		});
		expect(result.domain).toMatchObject({ id: "dom_new" });
		expect(result.dns.routing.status).toBe("ready");
		expect(result.dns.sending).toEqual([{ id: "send" }]);
	});

	it("updates an existing domain of the same org and sets pending status with null routingStatus", async () => {
		provisionMock.mockResolvedValue({
			...baseProvisioned,
			routingEnabled: false,
			sendingEnabled: false,
			sendingSubdomainTag: null,
			routingStatus: undefined,
		});
		routingDnsMock.mockResolvedValue({ records: [], missing: [] });
		routingSettingsMock.mockResolvedValue({ status: undefined });
		// existing lookup -> same org; read-back -> updated row (no sending tag)
		mock
			.queueSelect([{ id: "dom_existing", organizationId: "org1", hostname: "mail.example.com" }])
			.queueSelect([{ id: "dom_existing", hostname: "mail.example.com", zoneId: "z1", sendingSubdomainTag: null }]);

		const result = await addDomainForUser(env, "u1", "org1", "mail.example.com");

		expect(mock.updates).toHaveLength(1);
		expect(mock.inserts).toHaveLength(0);
		expect(mock.updates[0].set).toMatchObject({
			id: "dom_existing",
			status: "pending",
			routingStatus: null,
			sendingSubdomainTag: null,
			sendingEnabled: false,
			routingEnabled: false,
		});
		expect(result.domain).toMatchObject({ id: "dom_existing" });
		// no sending tag => sending stays empty, getSendingSubdomainDns not called
		expect(sendingDnsMock).not.toHaveBeenCalled();
		expect(result.dns.sending).toEqual([]);
	});

	it("treats sending-only enablement as active status", async () => {
		provisionMock.mockResolvedValue({
			...baseProvisioned,
			routingEnabled: false,
			sendingEnabled: true,
		});
		defaultDnsMocks();
		mock
			.queueSelect([])
			.queueSelect([{ id: "dom_new", hostname: "mail.example.com", zoneId: "z1", sendingSubdomainTag: "tag1" }]);

		await addDomainForUser(env, "u1", "org1", "mail.example.com");

		expect(mock.inserts[0].values).toMatchObject({ status: "active" });
	});
});

describe("getDomainDns", () => {
	it("includes sending DNS when a subdomain tag is present", async () => {
		defaultDnsMocks();
		const dns = await getDomainDns(env, {
			zoneId: "z1",
			sendingSubdomainTag: "tag1",
		} as never);

		expect(sendingDnsMock).toHaveBeenCalledWith(env, "z1", "tag1");
		expect(dns).toEqual({
			routing: { records: [{ id: "rec" }], missing: [], status: "ready" },
			sending: [{ id: "send" }],
		});
	});

	it("omits sending DNS when there is no subdomain tag", async () => {
		routingDnsMock.mockResolvedValue({ records: [], missing: [{ id: "m" } as never] });
		routingSettingsMock.mockResolvedValue({ status: "pending" });

		const dns = await getDomainDns(env, { zoneId: "z1", sendingSubdomainTag: null } as never);

		expect(sendingDnsMock).not.toHaveBeenCalled();
		expect(dns.sending).toEqual([]);
		expect(dns.routing.missing).toEqual([{ id: "m" }]);
	});
});

describe("removeDomainForUser", () => {
	it("throws when the domain is not found", async () => {
		mock.queueSelect([]);
		await expect(removeDomainForUser(env, "org1", "dom_1")).rejects.toThrow("Domain not found");
	});

	it("runs full cleanup when routing and sending are enabled", async () => {
		mock.queueSelect([
			{ id: "dom_1", zoneId: "z1", hostname: "mail.example.com", routingEnabled: true, sendingSubdomainTag: "tag1" },
		]);

		await removeDomainForUser(env, "org1", "dom_1");

		expect(cleanupMock).toHaveBeenCalledWith(env, "z1", "mail.example.com");
		expect(disableRoutingMock).toHaveBeenCalledWith(env, "z1");
		expect(deleteSubMock).toHaveBeenCalledWith(env, "z1", "tag1");
		expect(mock.deletes).toHaveLength(1);
	});

	it("skips disabling routing and deleting subdomain when neither is set", async () => {
		mock.queueSelect([
			{ id: "dom_1", zoneId: "z1", hostname: "mail.example.com", routingEnabled: false, sendingSubdomainTag: null },
		]);

		await removeDomainForUser(env, "org1", "dom_1");

		expect(cleanupMock).toHaveBeenCalled();
		expect(disableRoutingMock).not.toHaveBeenCalled();
		expect(deleteSubMock).not.toHaveBeenCalled();
		expect(mock.deletes).toHaveLength(1);
	});

	it("swallows errors from each cleanup step and still deletes the row", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		cleanupMock.mockRejectedValue(new Error("cleanup boom"));
		disableRoutingMock.mockRejectedValue(new Error("disable boom"));
		deleteSubMock.mockRejectedValue(new Error("sub boom"));

		mock.queueSelect([
			{ id: "dom_1", zoneId: "z1", hostname: "mail.example.com", routingEnabled: true, sendingSubdomainTag: "tag1" },
		]);

		await removeDomainForUser(env, "org1", "dom_1");

		expect(warn).toHaveBeenCalledWith("deleteEmailRoutingRulesForDomain", expect.any(Error));
		expect(warn).toHaveBeenCalledWith("disableEmailRouting", expect.any(Error));
		expect(warn).toHaveBeenCalledWith("deleteSendingSubdomain", expect.any(Error));
		expect(mock.deletes).toHaveLength(1);
		warn.mockRestore();
	});
});

describe("getDomainForUser", () => {
	it("returns the domain when found", async () => {
		mock.queueSelect([{ id: "dom_1", organizationId: "org1" }]);
		expect(await getDomainForUser(env, "org1", "dom_1")).toEqual({ id: "dom_1", organizationId: "org1" });
	});

	it("returns null when not found", async () => {
		mock.queueSelect([]);
		expect(await getDomainForUser(env, "org1", "dom_1")).toBeNull();
	});
});
