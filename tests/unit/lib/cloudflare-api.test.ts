import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createEmailRoutingRuleToWorker,
	createSendingSubdomain,
	deleteEmailRoutingRule,
	deleteSendingSubdomain,
	disableEmailRouting,
	enableEmailRouting,
	ensureEmailRoutingRuleToWorker,
	findZoneByHostname,
	getEmailRoutingDns,
	getEmailRoutingSettings,
	getSendingSubdomainDns,
	listEmailRoutingRules,
	listSendingSubdomains,
} from "@/lib/cloudflare-api";

const env = { CF_TOKEN: "tok" } as CloudflareEnv;
let fetchMock: ReturnType<typeof vi.fn>;

function ok(result: unknown) {
	return { status: 200, statusText: "OK", json: async () => ({ success: true, result }) } as unknown as Response;
}
function fail(errors: { code?: number; message: string }[], status = 403, statusText = "Forbidden") {
	return { status, statusText, json: async () => ({ success: false, errors }) } as unknown as Response;
}

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe("cfRequest (via public functions)", () => {
	it("throws a formatted error with an auth hint on failure", async () => {
		fetchMock.mockResolvedValue(fail([{ code: 10000, message: "bad token" }]));
		await expect(disableEmailRouting(env, "z1")).rejects.toThrow(/Cloudflare API 403.*Verify CF_TOKEN/s);
	});

	it("throws using the status text when the failure has no errors array", async () => {
		fetchMock.mockResolvedValue({
			status: 500,
			statusText: "Server Error",
			json: async () => ({ success: false }),
		} as unknown as Response);
		await expect(disableEmailRouting(env, "z1")).rejects.toThrow(
			"Cloudflare API 500 on /zones/z1/email/routing/dns: Server Error",
		);
	});

	it("returns the result on success and targets the v4 API", async () => {
		fetchMock.mockResolvedValue(ok({ done: true }));
		await disableEmailRouting(env, "z1");
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.cloudflare.com/client/v4/zones/z1/email/routing/dns",
		);
	});
});

describe("findZoneByHostname", () => {
	it("returns the first matching zone across candidates", async () => {
		fetchMock.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([{ id: "z1", name: "example.com" }]));
		expect(await findZoneByHostname(env, "mail.example.com")).toEqual({ id: "z1", name: "example.com" });
	});

	it("returns null when no candidate matches", async () => {
		fetchMock.mockResolvedValue(ok([]));
		expect(await findZoneByHostname(env, "mail.example.com")).toBeNull();
	});
});

describe("getEmailRoutingDns", () => {
	it("returns records and the missing list", async () => {
		fetchMock.mockResolvedValue(
			ok({ record: [{ type: "MX" }], errors: [{ missing: { type: "TXT" } }, {}] }),
		);
		expect(await getEmailRoutingDns(env, "z1")).toEqual({
			records: [{ type: "MX" }],
			missing: [{ type: "TXT" }],
		});
	});

	it("defaults records and missing to empty arrays", async () => {
		fetchMock.mockResolvedValue(ok({}));
		expect(await getEmailRoutingDns(env, "z1")).toEqual({ records: [], missing: [] });
	});
});

describe("enableEmailRouting", () => {
	it("includes a body when a hostname is given", async () => {
		fetchMock.mockResolvedValue(ok({ enabled: true }));
		await enableEmailRouting(env, "z1", "mail.example.com");
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "mail.example.com" });
	});

	it("omits the body when no hostname is given", async () => {
		fetchMock.mockResolvedValue(ok({ enabled: true }));
		await enableEmailRouting(env, "z1");
		expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
	});
});

describe("simple passthrough endpoints", () => {
	it("each call cfRequest and return the result", async () => {
		fetchMock.mockResolvedValue(ok([{ tag: "t" }]));
		await expect(listSendingSubdomains(env, "z1")).resolves.toEqual([{ tag: "t" }]);

		fetchMock.mockResolvedValue(ok({ tag: "t", name: "n", enabled: true }));
		await expect(createSendingSubdomain(env, "z1", "mail.example.com")).resolves.toMatchObject({ tag: "t" });

		fetchMock.mockResolvedValue(ok({}));
		await expect(deleteSendingSubdomain(env, "z1", "tag1")).resolves.toEqual({});

		fetchMock.mockResolvedValue(ok([{ type: "TXT" }]));
		await expect(getSendingSubdomainDns(env, "z1", "tag1")).resolves.toEqual([{ type: "TXT" }]);

		fetchMock.mockResolvedValue(ok({ enabled: true }));
		await expect(getEmailRoutingSettings(env, "z1")).resolves.toMatchObject({ enabled: true });

		fetchMock.mockResolvedValue(ok([]));
		await expect(listEmailRoutingRules(env, "z1")).resolves.toEqual([]);

		fetchMock.mockResolvedValue(ok({}));
		await expect(deleteEmailRoutingRule(env, "z1", "r1")).resolves.toEqual({});
	});
});

describe("createEmailRoutingRuleToWorker", () => {
	it("posts a worker rule using the configured worker name", async () => {
		fetchMock.mockResolvedValue(ok({ id: "r1" }));
		await createEmailRoutingRuleToWorker({ ...env, CF_EMAIL_WORKER_NAME: "lumi" } as CloudflareEnv, "z1", "a@x.com");
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.actions[0]).toEqual({ type: "worker", value: ["lumi"] });
		expect(body.matchers[0]).toEqual({ type: "literal", field: "to", value: "a@x.com" });
	});
});

describe("ensureEmailRoutingRuleToWorker", () => {
	it("returns an existing matching rule without creating one", async () => {
		fetchMock.mockResolvedValue(
			ok([
				{
					enabled: true,
					matchers: [{ type: "literal", field: "to", value: "A@X.com" }],
					actions: [{ type: "worker", value: ["lumimail"] }],
				},
			]),
		);
		const result = await ensureEmailRoutingRuleToWorker(env, "z1", "a@x.com");
		expect(result).toMatchObject({ enabled: true });
		expect(fetchMock).toHaveBeenCalledTimes(1); // list only, no create
	});

	it("treats a worker action with empty value as matching", async () => {
		fetchMock.mockResolvedValue(
			ok([
				{
					enabled: true,
					matchers: [{ type: "literal", field: "to", value: "a@x.com" }],
					actions: [{ type: "worker" }],
				},
			]),
		);
		await ensureEmailRoutingRuleToWorker(env, "z1", "a@x.com");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("creates a rule when no existing rule matches", async () => {
		fetchMock
			.mockResolvedValueOnce(
				ok([
					{ enabled: false, matchers: [], actions: [] },
					{ enabled: true, matchers: [{ type: "literal", field: "to", value: "other@x.com" }], actions: [{ type: "worker", value: ["lumimail"] }] },
				]),
			)
			.mockResolvedValueOnce(ok({ id: "r-new" }));
		const result = await ensureEmailRoutingRuleToWorker(env, "z1", "a@x.com");
		expect(result).toMatchObject({ id: "r-new" });
		expect(fetchMock).toHaveBeenCalledTimes(2); // list + create
	});
});
