import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getContactDisplayNameMap: vi.fn() }));
vi.mock("@/lib/contacts/service", () => ({
	getContactDisplayNameMap: m.getContactDisplayNameMap,
}));
vi.mock("@/lib/email/address", () => ({
	normalizeEmailAddress: (addr: string) => (addr ?? "").toLowerCase(),
}));
vi.mock("@/lib/email/reply-content-utils", () => ({
	getLatestEmailContent: (s: string | null) => `latest:${s}`,
}));

import { enrichMessagesWithContacts } from "@/lib/messages/enrich";

const env = {} as CloudflareEnv;

beforeEach(() => {
	m.getContactDisplayNameMap.mockReset().mockResolvedValue(new Map());
});

describe("enrichMessagesWithContacts", () => {
	it("resolves contact names in one batched lookup and reduces snippets", async () => {
		m.getContactDisplayNameMap.mockResolvedValue(
			new Map([
				["from@x.test", "From Name"],
				["to@x.test", "To Name"],
			]),
		);
		const rows = [
			{ id: "m1", fromAddr: "From@x.test", toAddr: "To@x.test", snippet: "body" },
		];

		const enriched = await enrichMessagesWithContacts(env, "u1", rows);

		expect(enriched).toEqual([
			{
				id: "m1",
				fromAddr: "From@x.test",
				toAddr: "To@x.test",
				snippet: "latest:body",
				fromContactName: "From Name",
				toContactName: "To Name",
			},
		]);
		expect(m.getContactDisplayNameMap).toHaveBeenCalledTimes(1);
		expect(m.getContactDisplayNameMap).toHaveBeenCalledWith(env, "u1", [
			"From@x.test",
			"To@x.test",
		]);
	});

	it("falls back to null names when no contact matches", async () => {
		const enriched = await enrichMessagesWithContacts(env, "u1", [
			{ fromAddr: "a@x.test", toAddr: "b@x.test", snippet: null },
		]);
		expect(enriched[0].fromContactName).toBeNull();
		expect(enriched[0].toContactName).toBeNull();
	});

	it("returns an empty list unchanged", async () => {
		expect(await enrichMessagesWithContacts(env, "u1", [])).toEqual([]);
	});
});
