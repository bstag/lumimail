import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import { backfillOrganizations, ensureUserOrg } from "@/lib/migration/backfill-orgs";

const env = {} as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
});

describe("backfillOrganizations", () => {
	it("creates nothing when there are no users", async () => {
		mock.queueSelect([]);
		expect(await backfillOrganizations(env)).toEqual({ orgsCreated: 0 });
		expect(mock.inserts).toHaveLength(0);
	});

	it("skips users that already have an organization", async () => {
		mock.queueSelect([{ id: "u1", name: "A" }]).queueSelect([{ id: "org_u1" }]);
		expect(await backfillOrganizations(env)).toEqual({ orgsCreated: 0 });
		expect(mock.inserts).toHaveLength(0);
	});

	it("creates an org, membership, and backfills foreign keys for a new user", async () => {
		mock.queueSelect([{ id: "u1", name: "A" }]).queueSelect([]);
		expect(await backfillOrganizations(env)).toEqual({ orgsCreated: 1 });
		expect(mock.inserts).toHaveLength(2);
		expect(mock.updates).toHaveLength(10);
	});
});

describe("ensureUserOrg", () => {
	it("throws when the user does not exist", async () => {
		mock.queueSelect([]);
		await expect(ensureUserOrg(env, "u1")).rejects.toThrow("User not found");
	});

	it("returns the existing organization id", async () => {
		mock.queueSelect([{ id: "u1", name: "A", organizationId: "org_x" }]);
		expect(await ensureUserOrg(env, "u1")).toBe("org_x");
		expect(mock.inserts).toHaveLength(0);
	});

	it("creates and returns a new organization for an org-less user", async () => {
		mock.queueSelect([{ id: "u1", name: "A", organizationId: null }]);
		expect(await ensureUserOrg(env, "u1")).toBe("org_u1");
		expect(mock.inserts).toHaveLength(2);
		expect(mock.updates).toHaveLength(1);
	});
});
