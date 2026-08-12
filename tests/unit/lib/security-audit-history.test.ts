import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/db")>();
	return { ...actual, getDb: () => h.db };
});
import {
	buildSecurityAuditHistory,
	decodeSecurityEventCursor,
	encodeSecurityEventCursor,
	readSecurityAuditHistory,
	readSecurityAuditHistoryFromDb,
} from "@/lib/security-audit-history";

const newest = new Date("2026-08-12T21:00:00.000Z");
const older = new Date("2026-08-12T20:00:00.000Z");

function event(id: string, organizationId = "org_1", createdAt = newest) {
	return {
		id,
		organizationId,
		actorUserId: "usr_owner",
		action: "session.revoke" as const,
		resourceType: "session" as const,
		resourceId: "sess_target",
		affectedCount: 1,
		requestId: `req_${id}`,
		outcome: "succeeded" as const,
		createdAt,
	};
}

describe("security-event cursor", () => {
	it("round-trips a timestamp and opaque event ID", () => {
		const cursor = encodeSecurityEventCursor({ createdAt: newest, id: "aud_A-b_2" });
		expect(decodeSecurityEventCursor(cursor)).toEqual({ createdAt: newest, id: "aud_A-b_2" });
	});

	it.each([
		"",
		"no-separator",
		"!.aud_1",
		"m0.invalid id",
		"m0.",
		`m${Number.MAX_SAFE_INTEGER.toString(36)}0.aud_1`,
		`m${(9_000_000_000_000_000).toString(36)}.aud_1`,
	])("rejects malformed cursor %j", (cursor) => {
		expect(decodeSecurityEventCursor(cursor)).toBeNull();
	});
});

describe("buildSecurityAuditHistory", () => {
	it("returns a bounded content-free page and a cursor when an older row exists", () => {
		const history = buildSecurityAuditHistory("org_1", 2, [event("aud_c"), event("aud_b"), event("aud_a", "org_1", older)]);
		expect(history.events).toEqual([
			{ id: "aud_c", actorUserId: "usr_owner", action: "session.revoke", resourceType: "session", resourceId: "sess_target", affectedCount: 1, requestId: "req_aud_c", outcome: "succeeded", createdAt: newest.toISOString() },
			{ id: "aud_b", actorUserId: "usr_owner", action: "session.revoke", resourceType: "session", resourceId: "sess_target", affectedCount: 1, requestId: "req_aud_b", outcome: "succeeded", createdAt: newest.toISOString() },
		]);
		expect(decodeSecurityEventCursor(history.nextCursor ?? "")).toEqual({ createdAt: newest, id: "aud_b" });
		expect(JSON.stringify(history)).not.toMatch(/organization|email|token|password|ip|agent|body|message/i);
	});

	it("fails closed on cross-organization rows and returns no cursor for an empty page", () => {
		expect(buildSecurityAuditHistory("org_1", 20, [event("aud_foreign", "org_2")])).toEqual({ events: [], nextCursor: null });
	});
});

describe("readSecurityAuditHistoryFromDb", () => {
	let mock: DbMock;

	beforeEach(() => {
		mock = createDbMock();
		h.db = mock.db;
	});

	it("resolves the D1-backed database from the Worker environment", async () => {
		mock.queueSelect([]);
		await expect(readSecurityAuditHistory({} as CloudflareEnv, "org_1", {
			limit: 20,
			cursor: null,
		})).resolves.toEqual({ events: [], nextCursor: null });
		expect(mock.db.select).toHaveBeenCalledTimes(1);
	});

	it("uses one scoped, ordered limit-plus-one query for the first page", async () => {
		mock.queueSelect([event("aud_b"), event("aud_a", "org_1", older)]);
		const history = await readSecurityAuditHistoryFromDb(mock.db, "org_1", { limit: 1, cursor: null });
		expect(mock.db.select).toHaveBeenCalledTimes(1);
		const builder = mock.db.select.mock.results[0].value;
		expect(builder.where).toHaveBeenCalledTimes(1);
		expect(builder.orderBy).toHaveBeenCalledTimes(1);
		expect(builder.limit).toHaveBeenCalledWith(2);
		expect(history.events).toHaveLength(1);
		expect(history.nextCursor).not.toBeNull();
	});

	it("adds the keyset boundary for an older page", async () => {
		mock.queueSelect([]);
		await readSecurityAuditHistoryFromDb(mock.db, "org_1", {
			limit: 20,
			cursor: { createdAt: newest, id: "aud_b" },
		});
		expect(mock.wheres).toHaveLength(1);
		expect(mock.db.select.mock.results[0].value.limit).toHaveBeenCalledWith(21);
	});
});
