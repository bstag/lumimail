import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	current: { id: "sess_current", organizationId: "org_1", tokenLookup: "lookup" } as null | {
		id: string; organizationId: string | null; tokenLookup: string;
	},
	record: vi.fn(),
}));
vi.mock("@/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/db")>();
	return { ...actual, getDb: () => h.db };
});
vi.mock("@/lib/auth/recent-auth", () => ({
	readRecentlyAuthenticatedSession: vi.fn(async () => h.current),
}));
vi.mock("@/lib/operational-evidence", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/operational-evidence")>();
	return { ...actual, recordOperationalEvidence: h.record };
});

import { deriveMailFlowChecks, recordMailFlowEvidence } from "@/lib/mail-flow-evidence";

const inboundId = "<inbound@example.com>";
const outboundId = "<outbound@example.com>";
const observedAt = new Date("2026-08-13T12:00:00.000Z");
const now = new Date("2026-08-13T13:00:00.000Z");
const env = {} as CloudflareEnv;
let mock: DbMock;

const inbound = { id: "msg_in", rfcMessageId: inboundId, threadId: "thr_1" };
const outbound = {
	id: "msg_out", threadId: "thr_1", replySourceMessageId: "msg_in",
	inReplyTo: inboundId, referencesHeader: `<root@example.com> ${inboundId}`,
	status: "sent", providerMessageId: outboundId, rfcMessageId: outboundId,
	jobStatus: "sent", jobAttempts: 1, jobError: null,
	jobPayload: JSON.stringify({ from: "private@example.com", to: "other@example.com", subject: "private",
		headers: { "In-Reply-To": inboundId, References: `<root@example.com> ${inboundId}` } }),
};
const proof = {
	deliveredMessageId: outboundId,
	deliveredInReplyTo: inboundId,
	deliveredReferences: `<root@example.com> ${inboundId}`,
};

beforeEach(() => {
	mock = createDbMock(); h.db = mock.db;
	h.current = { id: "sess_current", organizationId: "org_1", tokenLookup: "lookup" };
	h.record.mockReset().mockResolvedValue({ status: "recorded" });
});

describe("mail-flow check derivation", () => {
	it("passes all eight checks only for one complete received reply chain", () => {
		expect(deriveMailFlowChecks({ inbound, outbound, proof })).toEqual({ passedChecks: 8, totalChecks: 8 });
	});

	it("derives failures for absent and inconsistent stages", () => {
		expect(deriveMailFlowChecks({ inbound: null, outbound: null, proof })).toEqual({ passedChecks: 0, totalChecks: 8 });
		const variants = [
			{ threadId: "thr_other" },
			{ inReplyTo: "<other@example.com>" },
			{ referencesHeader: "<root@example.com>" },
			{ jobPayload: JSON.stringify({ headers: { "In-Reply-To": "<other@example.com>", References: inboundId } }) },
			{ status: "failed" },
			{ providerMessageId: "<other@example.com>" },
		];
		for (const change of variants) {
			expect(deriveMailFlowChecks({ inbound, outbound: { ...outbound, ...change }, proof }).passedChecks).toBeLessThan(8);
		}
	});
});

describe("mail-flow evidence recording", () => {
	it("denies a stale or cross-organization session before trace reads", async () => {
		for (const current of [null, { id: "sess", organizationId: "org_2", tokenLookup: "lookup" }]) {
			h.current = current;
			expect(await recordMailFlowEvidence(env, {
				organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token", observedAt, now, ...proof,
			})).toEqual({ status: "recent-auth-required" });
		}
		expect(mock.db.select).not.toHaveBeenCalled();
		expect(h.record).not.toHaveBeenCalled();
	});

	it("queries only the authenticated tenant and records a derived pass without identifiers", async () => {
		mock.queueSelect([inbound]).queueSelect([outbound]);
		expect(await recordMailFlowEvidence(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token", observedAt, now, ...proof,
		})).toEqual({ status: "recorded", outcome: "passed", passedChecks: 8, totalChecks: 8 });
		expect(mock.wheres).toHaveLength(2);
		expect(h.record).toHaveBeenCalledWith(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			category: "mail_flow", outcome: "passed", passedChecks: 8, totalChecks: 8, observedAt, now,
		});
		expect(JSON.stringify(h.record.mock.calls[0][1])).not.toContain("example.com");
		expect(JSON.stringify(h.record.mock.calls[0][1])).not.toContain("msg_");
	});

	it("rejects non-canonical proof or time before trace reads", async () => {
		for (const change of [
			{ deliveredMessageId: "not-an-id" },
			{ deliveredReferences: "not-reference-identifiers" },
			{ deliveredReferences: `<root@example.com> ${inboundId} ${inboundId}` },
			{ observedAt: new Date(now.getTime() + 1) },
		]) {
			expect(await recordMailFlowEvidence(env, {
				organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
				observedAt, now, ...proof, ...change,
			})).toEqual({ status: "invalid" });
		}
		expect(mock.db.select).not.toHaveBeenCalled();
		expect(h.record).not.toHaveBeenCalled();
	});

	it("uses the server clock when omitted and still rejects invalid proof before D1", async () => {
		expect(await recordMailFlowEvidence(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			observedAt: new Date(), ...proof, deliveredMessageId: "invalid",
		})).toEqual({ status: "invalid" });
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("records a derived failure and maps ledger status without returning proof identifiers", async () => {
		mock.queueSelect([inbound]).queueSelect([]);
		h.record.mockResolvedValue({ status: "duplicate" });
		const result = await recordMailFlowEvidence(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token", observedAt, now, ...proof,
		});
		expect(result).toEqual({ status: "duplicate", outcome: "failed", passedChecks: 1, totalChecks: 8 });
		expect(JSON.stringify(result)).not.toContain("example.com");
	});

	it("derives zero checks when no unique inbound exists and preserves a later ledger conflict", async () => {
		mock.queueSelect([]);
		h.record.mockResolvedValue({ status: "conflict" });
		expect(await recordMailFlowEvidence(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token", observedAt, now, ...proof,
		})).toEqual({ status: "conflict" });
		expect(h.record).toHaveBeenCalledWith(env, expect.objectContaining({
			outcome: "failed", passedChecks: 0, totalChecks: 8,
		}));
	});
});
