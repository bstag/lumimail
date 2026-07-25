import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createDestinationAddress,
	deleteDestinationAddress,
	listDestinationAddresses,
} from "@/lib/cloudflare-api";
import { getCloudflareAccountId } from "@/lib/cloudflare-api-utils";

const env = { CF_TOKEN: "tok", CF_ACCOUNT_ID: "acct_1" } as unknown as CloudflareEnv;
let fetchMock: ReturnType<typeof vi.fn>;

function ok(result: unknown) {
	return {
		status: 200,
		statusText: "OK",
		json: async () => ({ success: true, result }),
	} as unknown as Response;
}

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe("getCloudflareAccountId", () => {
	it("returns the configured account id", () => {
		expect(getCloudflareAccountId(env)).toBe("acct_1");
	});

	it("trims surrounding whitespace", () => {
		expect(getCloudflareAccountId({ CF_ACCOUNT_ID: "  acct_2  " } as unknown as CloudflareEnv)).toBe("acct_2");
	});

	it("fails closed when the account id is missing or blank", () => {
		expect(() => getCloudflareAccountId({} as unknown as CloudflareEnv)).toThrow(/CF_ACCOUNT_ID/);
		expect(() => getCloudflareAccountId({ CF_ACCOUNT_ID: "   " } as unknown as CloudflareEnv)).toThrow(/CF_ACCOUNT_ID/);
	});
});

describe("destination address API", () => {
	it("lists account-level destinations", async () => {
		fetchMock.mockResolvedValue(ok([{ tag: "d1", email: "a@example.net", verified: "2026-07-24T00:00:00Z" }]));

		const result = await listDestinationAddresses(env);

		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.cloudflare.com/client/v4/accounts/acct_1/email/routing/addresses",
		);
		expect(result[0].email).toBe("a@example.net");
	});

	it("creates a destination, which triggers Cloudflare's verification email", async () => {
		fetchMock.mockResolvedValue(ok({ tag: "d2", email: "new@example.net", verified: null }));

		const result = await createDestinationAddress(env, "New@Example.net");

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct_1/email/routing/addresses");
		expect(init.method).toBe("POST");
		// the address must be normalized before it reaches Cloudflare
		expect(JSON.parse(init.body)).toEqual({ email: "new@example.net" });
		expect(result.verified).toBeNull();
	});

	it("deletes a destination by its Cloudflare identifier", async () => {
		fetchMock.mockResolvedValue(ok({ tag: "d3", email: "old@example.net" }));

		await deleteDestinationAddress(env, "d3");

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct_1/email/routing/addresses/d3");
		expect(init.method).toBe("DELETE");
	});
});
