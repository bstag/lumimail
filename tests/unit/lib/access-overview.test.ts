import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import { buildAccessOverview, mailboxCapabilities, readAccessOverview } from "@/lib/access-overview";

const members = [
	{ id: "mem_1", userId: "usr_1", organizationId: "org_1", name: "Owner", email: "owner@example.com", organizationRole: "owner" as const },
	{ id: "mem_2", userId: "usr_2", organizationId: "org_1", name: "No Access", email: "none@example.com", organizationRole: "member" as const },
];
const mailboxes = [
	{ id: "mbx_1", organizationId: "org_1", localPart: "support", hostname: "example.com", displayName: "Support" },
	{ id: "mbx_2", organizationId: "org_1", localPart: "empty", hostname: "example.com", displayName: null },
];

describe("mailboxCapabilities", () => {
	it("maps the existing mailbox roles to their effective capabilities", () => {
		expect(mailboxCapabilities("viewer")).toEqual(["read"]);
		expect(mailboxCapabilities("responder")).toEqual(["read", "send"]);
		expect(mailboxCapabilities("manager")).toEqual(["read", "send", "manage"]);
		expect(mailboxCapabilities("unknown")).toEqual([]);
	});
});

describe("buildAccessOverview", () => {
	it("keeps empty members and mailboxes while separating organization role from grants", () => {
		const overview = buildAccessOverview("org_1", members, mailboxes, [
			{ id: "grant_1", userId: "usr_1", mailboxId: "mbx_1", role: "responder", memberOrganizationId: "org_1", mailboxOrganizationId: "org_1" },
		]);

		expect(overview.members).toEqual([
			{ id: "mem_2", userId: "usr_2", name: "No Access", email: "none@example.com", organizationRole: "member", grants: [] },
			{ id: "mem_1", userId: "usr_1", name: "Owner", email: "owner@example.com", organizationRole: "owner", grants: [
				{ id: "grant_1", mailboxId: "mbx_1", address: "support@example.com", displayName: "Support", role: "responder", capabilities: ["read", "send"] },
			] },
		]);
		expect(overview.mailboxes).toEqual([
			{ id: "mbx_2", address: "empty@example.com", displayName: null, assignedMemberCount: 0 },
			{ id: "mbx_1", address: "support@example.com", displayName: "Support", assignedMemberCount: 1 },
		]);
	});

	it("drops malformed and cross-tenant rows instead of promoting them to access", () => {
		const overview = buildAccessOverview("org_1", members, mailboxes, [
			{ id: "foreign_mailbox", userId: "usr_1", mailboxId: "mbx_foreign", role: "manager", memberOrganizationId: "org_1", mailboxOrganizationId: "org_2" },
			{ id: "foreign_member", userId: "usr_foreign", mailboxId: "mbx_1", role: "manager", memberOrganizationId: "org_2", mailboxOrganizationId: "org_1" },
			{ id: "missing_member", userId: "usr_missing", mailboxId: "mbx_1", role: "manager", memberOrganizationId: "org_1", mailboxOrganizationId: "org_1" },
			{ id: "missing_mailbox", userId: "usr_1", mailboxId: "mbx_missing", role: "manager", memberOrganizationId: "org_1", mailboxOrganizationId: "org_1" },
			{ id: "unknown_role", userId: "usr_1", mailboxId: "mbx_1", role: "superuser", memberOrganizationId: "org_1", mailboxOrganizationId: "org_1" },
		]);

		expect(overview.members.flatMap((member) => member.grants)).toEqual([]);
		expect(overview.mailboxes.every((mailbox) => mailbox.assignedMemberCount === 0)).toBe(true);
	});

	it("sorts multiple grants and counts each assigned member once", () => {
		const sameNameMembers = members.map((member) => ({ ...member, name: "Same" }));
		const overview = buildAccessOverview("org_1", sameNameMembers, mailboxes, [
			{ id: "grant_2", userId: "usr_1", mailboxId: "mbx_1", role: "manager", memberOrganizationId: "org_1", mailboxOrganizationId: "org_1" },
			{ id: "grant_1", userId: "usr_1", mailboxId: "mbx_2", role: "viewer", memberOrganizationId: "org_1", mailboxOrganizationId: "org_1" },
			{ id: "grant_3", userId: "usr_2", mailboxId: "mbx_1", role: "viewer", memberOrganizationId: "org_1", mailboxOrganizationId: "org_1" },
		]);

		expect(overview.members.map((member) => member.email)).toEqual(["none@example.com", "owner@example.com"]);
		expect(overview.members[1].grants.map((grant) => grant.address)).toEqual(["empty@example.com", "support@example.com"]);
		expect(overview.mailboxes.find((mailbox) => mailbox.id === "mbx_1")?.assignedMemberCount).toBe(2);
	});
});

describe("readAccessOverview", () => {
	let mock: DbMock;

	beforeEach(() => {
		mock = createDbMock();
		h.db = mock.db;
	});

	it("reads all three organization-scoped datasets and builds the overview", async () => {
		mock.queueSelect([members[0]]);
		mock.queueSelect([mailboxes[0]]);
		mock.queueSelect([
			{ id: "grant_1", userId: "usr_1", mailboxId: "mbx_1", role: "viewer", memberOrganizationId: "org_1", mailboxOrganizationId: "org_1" },
		]);

		const overview = await readAccessOverview({} as CloudflareEnv, "org_1");

		expect(mock.db.select).toHaveBeenCalledTimes(3);
		expect(mock.wheres).toHaveLength(3);
		expect(overview.members[0].grants[0]).toMatchObject({
			mailboxId: "mbx_1",
			role: "viewer",
			capabilities: ["read"],
		});
	});
});
