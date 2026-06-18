import { describe, expect, it } from "vitest";
import {
	formatCloudflareError,
	getCloudflareAuth,
	getCloudflareAuthHeaders,
	getCloudflareAuthHint,
	getEmailWorkerName,
} from "@/lib/cloudflare-api-utils";

const env = (overrides: Partial<CloudflareEnv>) => overrides as CloudflareEnv;

describe("getCloudflareAuth", () => {
	it("prefers the global key when key and email are present", () => {
		expect(
			getCloudflareAuth(env({ CF_API_KEY: " key ", CF_EMAIL: " me@example.com ", CF_TOKEN: "tok" })),
		).toEqual({ kind: "global-key", email: "me@example.com", key: "key" });
	});

	it("uses the token when only a token is configured", () => {
		expect(getCloudflareAuth(env({ CF_TOKEN: "  tok  " }))).toEqual({ kind: "token", token: "tok" });
	});

	it("throws when a key is set without an email", () => {
		expect(() => getCloudflareAuth(env({ CF_API_KEY: "key" }))).toThrow(
			"CF_EMAIL is required when using CF_API_KEY",
		);
	});

	it("throws when nothing is configured", () => {
		expect(() => getCloudflareAuth(env({}))).toThrow("CF_TOKEN or CF_API_KEY is not configured");
	});
});

describe("getCloudflareAuthHeaders", () => {
	it("builds global-key headers", () => {
		expect(getCloudflareAuthHeaders({ kind: "global-key", email: "a@b.com", key: "k" })).toEqual({
			"X-Auth-Email": "a@b.com",
			"X-Auth-Key": "k",
		});
	});

	it("builds bearer-token headers", () => {
		expect(getCloudflareAuthHeaders({ kind: "token", token: "t" })).toEqual({
			Authorization: "Bearer t",
		});
	});
});

describe("formatCloudflareError", () => {
	it("formats errors with codes", () => {
		expect(
			formatCloudflareError("/zones", 403, "Forbidden", [{ code: 10000, message: "denied" }]),
		).toBe("Cloudflare API 403 on /zones: code 10000: denied");
	});

	it("formats errors without codes and joins multiple", () => {
		expect(
			formatCloudflareError("/zones", 400, "Bad", [{ message: "a" }, { message: "b" }]),
		).toBe("Cloudflare API 400 on /zones: a; b");
	});

	it("falls back to status text when no error details exist", () => {
		expect(formatCloudflareError("/zones", 500, "Server Error", [])).toBe(
			"Cloudflare API 500 on /zones: Server Error",
		);
	});

	it("falls back to a generic message when status text is empty", () => {
		expect(formatCloudflareError("/zones", 500, "", [])).toBe(
			"Cloudflare API 500 on /zones: Cloudflare API request failed",
		);
	});
});

describe("getCloudflareAuthHint", () => {
	it("returns a hint for known auth error codes", () => {
		expect(getCloudflareAuthHint([{ code: 10000, message: "x" }])).toContain("Verify CF_TOKEN");
		expect(getCloudflareAuthHint([{ code: 9109, message: "x" }])).toContain("Verify CF_TOKEN");
	});

	it("returns a hint when the message mentions auth or token", () => {
		expect(getCloudflareAuthHint([{ message: "Authentication error" }])).toContain("Verify CF_TOKEN");
		expect(getCloudflareAuthHint([{ message: "invalid token" }])).toContain("Verify CF_TOKEN");
	});

	it("returns an empty string when there is no auth error", () => {
		expect(getCloudflareAuthHint([{ code: 123, message: "rate limited" }])).toBe("");
	});
});

describe("getEmailWorkerName", () => {
	it("returns the trimmed configured name", () => {
		expect(getEmailWorkerName(env({ CF_EMAIL_WORKER_NAME: "  my-worker  " }))).toBe("my-worker");
	});

	it("defaults to lumimail when unset or blank", () => {
		expect(getEmailWorkerName(env({}))).toBe("lumimail");
		expect(getEmailWorkerName(env({ CF_EMAIL_WORKER_NAME: "   " }))).toBe("lumimail");
	});
});
