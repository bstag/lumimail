import { describe, expect, it } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { AppDatabase } from "@/db";
import { createDbMock } from "../../helpers/db";
import {
	getMailboxAccess,
	hasMailboxCapability,
	listAccessibleMailboxIds,
	messageAccessCondition,
} from "@/lib/auth/mailbox-access";

describe("mailbox access roles", () => {
	it.each([
		["viewer", "read", true],
		["viewer", "send", false],
		["viewer", "manage", false],
		["responder", "read", true],
		["responder", "send", true],
		["responder", "manage", false],
		["manager", "read", true],
		["manager", "send", true],
		["manager", "manage", true],
	] as const)("gives %s the expected %s capability", (role, capability, expected) => {
		expect(hasMailboxCapability(role, capability)).toBe(expected);
	});

	it("returns explicit same-organization membership", async () => {
		const mock = createDbMock();
		mock.queueSelect([{ mailboxId: "mbx_1", organizationId: "org_1", role: "responder" }]);

		await expect(getMailboxAccess(mock.db, "usr_1", "org_1", "mbx_1")).resolves.toEqual({
			mailboxId: "mbx_1",
			organizationId: "org_1",
			role: "responder",
		});
	});

	it("returns null when no explicit membership exists", async () => {
		const mock = createDbMock();
		mock.queueSelect([]);

		await expect(getMailboxAccess(mock.db, "owner_1", "org_1", "mbx_1")).resolves.toBeNull();
	});

	it("lists only mailbox IDs with the requested capability", async () => {
		const mock = createDbMock();
		mock.queueSelect([
			{ mailboxId: "mbx_reply" },
			{ mailboxId: "mbx_manage" },
		]);

		await expect(listAccessibleMailboxIds(mock.db, "usr_1", "org_1", "send")).resolves.toEqual([
			"mbx_reply",
			"mbx_manage",
		]);
	});

	it("builds private-only access without an organization", () => {
		const mock = createDbMock();
		expect(messageAccessCondition(mock.db, "usr_1", null, "read")).toBeDefined();
	});

	it("builds membership-backed access for an organization mailbox", () => {
		const mock = createDbMock();
		expect(messageAccessCondition(mock.db, "usr_1", "org_1", "send")).toBeDefined();
	});

	it("requires send-capable membership when a read targets draft messages", () => {
		const db = drizzle(async () => ({ rows: [] })) as unknown as AppDatabase;
		const condition = messageAccessCondition(db, "usr_1", "org_1", "read");
		const query = new SQLiteSyncDialect().sqlToQuery(condition!);

		expect(query.sql).toContain('"messages"."status"');
		expect(query.params).toContain("draft");
		expect(query.params).toContain("viewer");
		expect(query.params.filter((value) => value === "responder")).toHaveLength(2);
		expect(query.params.filter((value) => value === "manager")).toHaveLength(2);
	});
});
