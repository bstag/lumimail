import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	current: { id: "sess_current", organizationId: "org_1", tokenLookup: "lookup" } as null | {
		id: string; organizationId: string | null; tokenLookup: string;
	},
	nextId: 0,
}));
vi.mock("@/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/db")>();
	return { ...actual, getDb: () => h.db };
});
vi.mock("@/lib/auth/recent-auth", () => ({
	readRecentlyAuthenticatedSession: vi.fn(async () => h.current),
}));
vi.mock("@/lib/ids", () => ({ newId: (prefix?: string) => `${prefix}_${++h.nextId}` }));

import {
	buildOperationalEvidenceSummary,
	recordOperationalEvidence,
	readOperationalEvidence,
} from "@/lib/operational-evidence";

const now = new Date("2026-08-12T23:00:00.000Z");
const observedAt = new Date("2026-08-12T22:00:00.000Z");
const env = {} as CloudflareEnv;
let mock: DbMock;

function input(overrides: Record<string, unknown> = {}) {
	return {
		organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
		category: "smoke" as const, outcome: "passed" as const,
		passedChecks: 6, totalChecks: 6, observedAt, now,
		...overrides,
	};
}

function row(overrides: Record<string, unknown> = {}) {
	return {
		id: "ope_1", organizationId: "org_1", actorUserId: "usr_owner",
		category: "smoke" as const, outcome: "passed" as const,
		passedChecks: 6, totalChecks: 6, observedAt, recordedAt: now,
		...overrides,
	};
}

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
	h.current = { id: "sess_current", organizationId: "org_1", tokenLookup: "lookup" };
	h.nextId = 0;
});

describe("recordOperationalEvidence", () => {
	it("requires the exact recently authenticated organization before any evidence read", async () => {
		h.current = null;
		expect(await recordOperationalEvidence(env, input())).toEqual({ status: "recent-auth-required" });
		h.current = { id: "sess_current", organizationId: "org_other", tokenLookup: "lookup" };
		expect(await recordOperationalEvidence(env, input())).toEqual({ status: "recent-auth-required" });
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("rejects future, stale, and logically inconsistent results before D1", async () => {
		for (const invalid of [
			input({ observedAt: new Date("2026-08-12T23:00:00.001Z") }),
			input({ observedAt: new Date("2026-05-14T22:59:59.999Z") }),
			input({ passedChecks: 5, totalChecks: 6, outcome: "passed" }),
			input({ passedChecks: 6, totalChecks: 6, outcome: "failed" }),
		]) expect(await recordOperationalEvidence(env, invalid as never)).toEqual({ status: "invalid" });
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("appends one structurally minimized evidence record", async () => {
		mock.queueSelect([]).queueSelect([{ id: "ope_1" }]);
		expect(await recordOperationalEvidence(env, input())).toEqual({ status: "recorded" });
		expect(mock.inserts[0].values).toEqual(row({ id: "ope_1" }));
		expect(JSON.stringify(mock.inserts[0].values)).not.toMatch(/email|address|token|password|payload|detail|message|url|commit|resource/i);
	});

	it("uses the server clock when one is not injected", async () => {
		mock.queueSelect([]).queueSelect([{ id: "ope_1" }]);
		const observed = new Date();
		expect(await recordOperationalEvidence(env, input({ observedAt: observed, now: undefined }))).toEqual({ status: "recorded" });
		expect(mock.inserts[0].values).toMatchObject({ recordedAt: expect.any(Date) });
	});

	it("makes exact replay idempotent and rejects conflicting history", async () => {
		mock.queueSelect([row()]);
		expect(await recordOperationalEvidence(env, input())).toEqual({ status: "duplicate" });
		expect(mock.inserts).toHaveLength(0);

		mock = createDbMock(); h.db = mock.db; mock.queueSelect([row({ outcome: "failed", passedChecks: 5 })]);
		expect(await recordOperationalEvidence(env, input())).toEqual({ status: "conflict" });
		expect(mock.inserts).toHaveLength(0);
	});

	it("resolves a concurrent unique-key winner without rewriting it", async () => {
		mock.queueSelect([]).queueSelect([]).queueSelect([row({ id: "ope_winner" })]);
		expect(await recordOperationalEvidence(env, input())).toEqual({ status: "duplicate" });
		expect(mock.inserts).toHaveLength(1);

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([]).queueSelect([]).queueSelect([row({ id: "ope_winner", outcome: "failed", passedChecks: 5 })]);
		expect(await recordOperationalEvidence(env, input())).toEqual({ status: "conflict" });
	});
});

describe("operational evidence read model", () => {
	it("returns only the newest scoped row per fixed category without actor or row identifiers", async () => {
		const newer = new Date("2026-08-12T22:30:00.000Z");
		mock.queueSelect([
			row({ id: "ope_new", observedAt: newer, recordedAt: newer }),
			row({ id: "ope_old" }),
			row({ id: "ope_foreign", organizationId: "org_2", category: "release" }),
		]);
		const summary = await readOperationalEvidence(env, "org_1");
		expect(summary).toEqual({ status: "unknown", records: [{
			category: "smoke", outcome: "passed", passedChecks: 6, totalChecks: 6,
			observedAt: newer.toISOString(), recordedAt: newer.toISOString(),
		}] });
		expect(JSON.stringify(summary)).not.toMatch(/ope_|usr_|org_|actor|identifier/i);
		expect(mock.db.select.mock.results[0].value.limit).toHaveBeenCalledWith(200);
	});

	it("aggregates all-passed, failed, and empty evidence states", () => {
		const all = ["recovery", "release", "smoke", "mail_flow"].map((category, index) =>
			row({ id: `ope_${index}`, category, observedAt: new Date(observedAt.getTime() + index) }));
		expect(buildOperationalEvidenceSummary("org_1", all as never).status).toBe("healthy");
		expect(buildOperationalEvidenceSummary("org_1", [...all, row({ category: "smoke", outcome: "failed", passedChecks: 5,
			observedAt: new Date(observedAt.getTime() + 100) })] as never).status).toBe("attention");
		expect(buildOperationalEvidenceSummary("org_1", []).status).toBe("unknown");
	});

	it("uses recording time only to break equal observation timestamps and ignores older rows", () => {
		const recordedLater = new Date(now.getTime() + 1000);
		const summary = buildOperationalEvidenceSummary("org_1", [
			row({ id: "ope_first" }),
			row({ id: "ope_older", observedAt: new Date(observedAt.getTime() - 1000), outcome: "failed", passedChecks: 5 }),
			row({ id: "ope_later", recordedAt: recordedLater, outcome: "failed", passedChecks: 5 }),
		]);
		expect(summary.records[0]).toMatchObject({ outcome: "failed", recordedAt: recordedLater.toISOString() });
	});
});
