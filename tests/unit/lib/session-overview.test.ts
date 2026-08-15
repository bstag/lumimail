import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	lookupSessionToken: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/auth/session", () => ({ lookupSessionToken: h.lookupSessionToken }));

import { buildSessionOverview, readSessionOverview } from "@/lib/session-overview";

const now = new Date("2026-08-12T20:00:00.000Z");
const active = new Date("2026-09-01T20:00:00.000Z");
const expired = new Date("2026-08-01T20:00:00.000Z");

describe("buildSessionOverview", () => {
	it("returns active organization-bound sessions without credential material", () => {
		const overview = buildSessionOverview("org_1", "lookup_current", now, [
			{ id: "sess_old", userId: "usr_2", name: "Teammate", email: "team@example.com", sessionOrganizationId: "org_1", memberOrganizationId: "org_1", tokenLookup: "lookup_other", createdAt: new Date("2026-08-10T10:00:00.000Z"), expiresAt: active },
			{ id: "sess_current", userId: "usr_1", name: "Owner", email: "owner@example.com", sessionOrganizationId: "org_1", memberOrganizationId: "org_1", tokenLookup: "lookup_current", createdAt: new Date("2026-08-11T10:00:00.000Z"), expiresAt: active },
		]);

		expect(overview).toEqual({
			observedAt: now.toISOString(),
			activeCount: 2,
			sessions: [
				{ id: "sess_current", userId: "usr_1", name: "Owner", email: "owner@example.com", createdAt: "2026-08-11T10:00:00.000Z", expiresAt: active.toISOString(), isCurrent: true },
				{ id: "sess_old", userId: "usr_2", name: "Teammate", email: "team@example.com", createdAt: "2026-08-10T10:00:00.000Z", expiresAt: active.toISOString(), isCurrent: false },
			],
		});
		expect(JSON.stringify(overview)).not.toMatch(/lookup|hash|token/i);
	});

	it("excludes expired, cross-tenant, and malformed organization rows", () => {
		const overview = buildSessionOverview("org_1", null, now, [
			{ id: "expired", userId: "usr_1", name: "Owner", email: "owner@example.com", sessionOrganizationId: "org_1", memberOrganizationId: "org_1", tokenLookup: "a", createdAt: expired, expiresAt: expired },
			{ id: "foreign_session", userId: "usr_1", name: "Owner", email: "owner@example.com", sessionOrganizationId: "org_2", memberOrganizationId: "org_1", tokenLookup: "b", createdAt: now, expiresAt: active },
			{ id: "foreign_member", userId: "usr_2", name: "Other", email: "other@example.com", sessionOrganizationId: "org_1", memberOrganizationId: "org_2", tokenLookup: "c", createdAt: now, expiresAt: active },
		]);

		expect(overview.activeCount).toBe(0);
		expect(overview.sessions).toEqual([]);
	});

	it("orders equal creation times deterministically by opaque session id", () => {
		const rows = ["sess_b", "sess_a"].map((id) => ({
			id, userId: "usr_1", name: "Owner", email: "owner@example.com",
			sessionOrganizationId: "org_1", memberOrganizationId: "org_1",
			tokenLookup: id, createdAt: now, expiresAt: active,
		}));
		expect(buildSessionOverview("org_1", null, now, rows).sessions.map((row) => row.id)).toEqual(["sess_a", "sess_b"]);
	});
});

describe("readSessionOverview", () => {
	let mock: DbMock;

	beforeEach(() => {
		mock = createDbMock();
		h.db = mock.db;
		h.lookupSessionToken.mockReset().mockResolvedValue("lookup_current");
	});

	it("derives the current lookup and reads the owner organization once", async () => {
		mock.queueSelect([{ id: "sess_current", userId: "usr_1", name: "Owner", email: "owner@example.com", sessionOrganizationId: "org_1", memberOrganizationId: "org_1", tokenLookup: "lookup_current", createdAt: now, expiresAt: active }]);
		const overview = await readSessionOverview({} as CloudflareEnv, "org_1", "plain-token", now);
		expect(h.lookupSessionToken).toHaveBeenCalledWith("plain-token");
		expect(mock.db.select).toHaveBeenCalledTimes(1);
		expect(overview.sessions[0].isCurrent).toBe(true);
	});

	it("does not derive a lookup when no presented credential exists", async () => {
		mock.queueSelect([]);
		const overview = await readSessionOverview({} as CloudflareEnv, "org_1", undefined, now);
		expect(h.lookupSessionToken).not.toHaveBeenCalled();
		expect(overview).toMatchObject({ activeCount: 0, sessions: [] });
	});
});
