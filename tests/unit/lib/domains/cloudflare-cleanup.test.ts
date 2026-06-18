import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cloudflare-api", () => ({
	deleteEmailRoutingRule: vi.fn(),
	listEmailRoutingRules: vi.fn(),
}));

import { deleteEmailRoutingRulesForDomain } from "@/lib/domains/cloudflare-cleanup";
import { deleteEmailRoutingRule, listEmailRoutingRules } from "@/lib/cloudflare-api";

const env = {} as CloudflareEnv;
const listMock = vi.mocked(listEmailRoutingRules);
const deleteMock = vi.mocked(deleteEmailRoutingRule);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("deleteEmailRoutingRulesForDomain", () => {
	it("deletes rules whose matcher value equals the hostname (catch-all)", async () => {
		listMock.mockResolvedValue([
			{ id: "r1", matchers: [{ type: "literal", field: "to", value: "Example.COM" }] },
		] as never);

		await deleteEmailRoutingRulesForDomain(env, "z1", "example.com");

		expect(deleteMock).toHaveBeenCalledTimes(1);
		expect(deleteMock).toHaveBeenCalledWith(env, "z1", "r1");
	});

	it("deletes rules whose matcher value ends with @hostname", async () => {
		listMock.mockResolvedValue([
			{ id: "r2", matchers: [{ type: "literal", field: "to", value: "user@example.com" }] },
		] as never);

		await deleteEmailRoutingRulesForDomain(env, "z1", "example.com");

		expect(deleteMock).toHaveBeenCalledWith(env, "z1", "r2");
	});

	it("falls back to rule.tag when id is missing", async () => {
		listMock.mockResolvedValue([
			{ tag: "t1", matchers: [{ type: "literal", field: "to", value: "user@example.com" }] },
		] as never);

		await deleteEmailRoutingRulesForDomain(env, "z1", "example.com");

		expect(deleteMock).toHaveBeenCalledWith(env, "z1", "t1");
	});

	it("skips a linked rule that has neither id nor tag", async () => {
		listMock.mockResolvedValue([
			{ matchers: [{ type: "literal", field: "to", value: "user@example.com" }] },
		] as never);

		await deleteEmailRoutingRulesForDomain(env, "z1", "example.com");

		expect(deleteMock).not.toHaveBeenCalled();
	});

	it("ignores rules with a non-matching value, wrong type, wrong field, or no matchers", async () => {
		listMock.mockResolvedValue([
			// value does not match domain (routesToDomain false via value present but unrelated)
			{ id: "a", matchers: [{ type: "literal", field: "to", value: "user@other.com" }] },
			// wrong matcher type
			{ id: "b", matchers: [{ type: "all", field: "to", value: "user@example.com" }] },
			// wrong field
			{ id: "c", matchers: [{ type: "literal", field: "from", value: "user@example.com" }] },
			// matcher with undefined value => routesToDomain returns false
			{ id: "d", matchers: [{ type: "literal", field: "to" }] },
			// no matchers array => optional chaining short-circuits
			{ id: "e" },
		] as never);

		await deleteEmailRoutingRulesForDomain(env, "z1", "example.com");

		expect(deleteMock).not.toHaveBeenCalled();
	});

	it("deletes multiple linked rules concurrently", async () => {
		listMock.mockResolvedValue([
			{ id: "r1", matchers: [{ type: "literal", field: "to", value: "a@example.com" }] },
			{ id: "r2", matchers: [{ type: "literal", field: "to", value: "example.com" }] },
		] as never);

		await deleteEmailRoutingRulesForDomain(env, "z1", "example.com");

		expect(deleteMock).toHaveBeenCalledTimes(2);
	});

	it("lowercases the hostname before matching", async () => {
		listMock.mockResolvedValue([
			{ id: "r1", matchers: [{ type: "literal", field: "to", value: "user@example.com" }] },
		] as never);

		await deleteEmailRoutingRulesForDomain(env, "z1", "EXAMPLE.COM");

		expect(deleteMock).toHaveBeenCalledWith(env, "z1", "r1");
	});
});
