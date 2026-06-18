import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import {
	getContactDisplayNameMap,
	getMessageContactNames,
	upsertContactFromAddress,
} from "@/lib/contacts/service";

const env = {} as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
});

describe("upsertContactFromAddress", () => {
	it("returns null for an address that normalizes to empty", async () => {
		expect(await upsertContactFromAddress(env, { userId: "u1", address: "", source: "inbound" })).toBeNull();
	});

	it("keeps the existing name and source for a manual contact", async () => {
		mock.queueSelect([{ id: "c1", displayName: "Old", source: "manual", email: "a@b.com" }]);
		const result = await upsertContactFromAddress(env, {
			userId: "u1",
			address: '"New" <a@b.com>',
			source: "inbound",
		});
		expect(result).toMatchObject({ displayName: "Old", source: "manual" });
		expect(mock.updates[0].set).toMatchObject({ displayName: "Old", source: "manual" });
	});

	it("updates the name and source for a non-manual contact with a new name", async () => {
		mock.queueSelect([{ id: "c1", displayName: "Old", source: "inbound", email: "a@b.com" }]);
		const result = await upsertContactFromAddress(env, {
			userId: "u1",
			address: '"New Name" <a@b.com>',
			source: "outbound",
		});
		expect(result).toMatchObject({ displayName: "New Name", source: "outbound" });
	});

	it("keeps the existing name when no new name is provided", async () => {
		mock.queueSelect([{ id: "c1", displayName: "Old", source: "inbound", email: "a@b.com" }]);
		const result = await upsertContactFromAddress(env, {
			userId: "u1",
			address: "a@b.com",
			source: "inbound",
		});
		expect(result).toMatchObject({ displayName: "Old" });
	});

	it("inserts a new contact and returns the created row", async () => {
		mock.queueSelect([]).queueSelect([{ id: "u1:a@b.com", email: "a@b.com", displayName: "New" }]);
		const result = await upsertContactFromAddress(env, {
			userId: "u1",
			address: '"New" <a@b.com>',
			source: "inbound",
		});
		expect(result).toMatchObject({ id: "u1:a@b.com" });
		expect(mock.inserts[0].values).toMatchObject({ userId: "u1", email: "a@b.com", source: "inbound" });
	});

	it("returns null when the created row cannot be read back", async () => {
		mock.queueSelect([]).queueSelect([]);
		const result = await upsertContactFromAddress(env, {
			userId: "u1",
			address: "a@b.com",
			source: "inbound",
		});
		expect(result).toBeNull();
	});
});

describe("getContactDisplayNameMap", () => {
	it("returns an empty map when there are no resolvable addresses", async () => {
		const map = await getContactDisplayNameMap(env, "u1", ["", "   "]);
		expect(map.size).toBe(0);
	});

	it("maps emails to non-empty display names only", async () => {
		mock.queueSelect([
			{ email: "a@b.com", displayName: "Alice" },
			{ email: "c@d.com", displayName: null },
		]);
		const map = await getContactDisplayNameMap(env, "u1", ["A@b.com", "c@d.com"]);
		expect(map.get("a@b.com")).toBe("Alice");
		expect(map.has("c@d.com")).toBe(false);
	});
});

describe("getMessageContactNames", () => {
	it("resolves from/to contact names from the map", async () => {
		mock.queueSelect([{ email: "from@x.com", displayName: "Fname" }]);
		const result = await getMessageContactNames(env, "u1", '"F" <from@x.com>', "to@y.com");
		expect(result).toEqual({ fromContactName: "Fname", toContactName: null });
	});

	it("resolves the to-name and leaves an unknown from-name null", async () => {
		mock.queueSelect([{ email: "to@y.com", displayName: "Tname" }]);
		const result = await getMessageContactNames(env, "u1", "from@x.com", '"T" <to@y.com>');
		expect(result).toEqual({ fromContactName: null, toContactName: "Tname" });
	});
});
