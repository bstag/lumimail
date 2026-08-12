import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
	renderVerifierCleanupSql,
	renderVerifierProvisionSql,
	verifyRecoveryApplication,
} from "../../../scripts/recovery-app-verify.mjs";

const plan = {
	allowedAttachmentId: "att_allowed",
	allowedMailboxId: "mbx_allowed",
	allowedMessageId: "msg_allowed",
	deniedAttachmentId: "att_denied",
	deniedMailboxId: "mbx_denied",
	deniedMessageId: "msg_denied",
	email: "recovery-verifier@invalid.example",
	membershipId: "mbm_recoveryverify",
	organizationId: "org_restored",
	organizationMembershipId: "om_recoveryverify",
	userId: "usr_recoveryverify",
};

describe("recovery application verifier", () => {
	it("renders fixed-ID provision SQL without embedding the plaintext password", () => {
		const sql = renderVerifierProvisionSql({
			...plan,
			now: 1_786_543_200,
			passwordHash: "$2b$10$hash",
		});

		expect(sql).toContain("usr_recoveryverify");
		expect(sql).toContain("mbx_allowed");
		expect(sql).toContain("'viewer'");
		expect(sql).toContain("INSERT INTO attachments");
		expect(sql).toContain("att_denied");
		expect(sql).toContain("$2b$10$hash");
		expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT|SAVEPOINT)\b/);
		expect(sql).not.toContain("password-plaintext");
		expect(() =>
			renderVerifierProvisionSql({ ...plan, now: 1, passwordHash: "hash", deniedMailboxId: "mbx_allowed" }),
		).toThrow("distinct");
	});

	it("renders repeatable cleanup limited to the fixed verifier IDs", () => {
		const sql = renderVerifierCleanupSql(plan);
		expect(sql).toContain("DELETE FROM sessions WHERE user_id = 'usr_recoveryverify'");
		expect(sql).toContain("DELETE FROM attachments WHERE id = 'att_denied'");
		expect(sql).toContain("DELETE FROM mailbox_memberships WHERE id = 'mbm_recoveryverify'");
		expect(sql).toContain("DELETE FROM organization_members WHERE id = 'om_recoveryverify'");
		expect(sql).toContain("DELETE FROM users WHERE id = 'usr_recoveryverify'");
		expect(sql).not.toMatch(/DELETE FROM (?:messages|mailboxes|organizations)/);
		expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT|SAVEPOINT)\b/);
	});

	it("proves allowed reads and unrelated mailbox denial without reporting secrets", async () => {
		const attachment = Buffer.from("verified attachment bytes");
		const expectedSha256 = createHash("sha256").update(attachment).digest("hex");
		const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
			if (url.pathname === "/api/auth/login") {
				return new Response(JSON.stringify({ ok: true, redirect: "/inbox" }), {
					status: 200,
					headers: { "content-type": "application/json", "set-cookie": "ep_session=secret; Path=/; HttpOnly" },
				});
			}
			if (url.pathname === "/api/auth/me") return Response.json({ user: { id: plan.userId } });
			if (url.pathname === "/api/mailboxes") {
				return Response.json({ success: true, data: { mailboxes: [{ id: plan.allowedMailboxId }] } });
			}
			if (url.pathname === `/api/messages/${plan.allowedMessageId}`) {
				return Response.json({ success: true, data: { message: { id: plan.allowedMessageId }, body: {} } });
			}
			if (url.pathname === `/api/messages/${plan.allowedMessageId}/attachments`) {
				return Response.json({ success: true, data: { attachments: [{ id: plan.allowedAttachmentId }] } });
			}
			if (url.pathname === `/api/attachments/${plan.allowedAttachmentId}`) {
				return new Response(attachment, { status: 200, headers: { "content-length": String(attachment.length) } });
			}
			if (url.pathname === "/api/messages" && url.searchParams.get("mailboxId") === plan.deniedMailboxId) {
				return Response.json({ success: true, data: { messages: [], total: 0 } });
			}
			if (
				url.pathname === `/api/messages/${plan.deniedMessageId}` ||
				url.pathname === `/api/attachments/${plan.deniedAttachmentId}`
			) return Response.json({ error: "Not found" }, { status: 404 });
			throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
		});

		const result = await verifyRecoveryApplication({
			baseUrl: "https://recovery.example",
			email: plan.email,
			password: "password-plaintext",
			plan,
			expectedAttachment: { sha256: expectedSha256, size: attachment.length },
			fetchImpl,
		});

		expect(result).toEqual({
			allowedAttachmentBytes: attachment.length,
			allowedAttachmentSha256: expectedSha256,
			allowedMailboxCount: 1,
			allowedMessageRead: true,
			deniedAttachmentStatus: 404,
			deniedMailboxMessageCount: 0,
			deniedMessageStatus: 404,
			sessionAuthenticated: true,
		});
		expect(JSON.stringify(result)).not.toContain("password-plaintext");
		expect(JSON.stringify(result)).not.toContain("ep_session=secret");
	});

	it("fails when the mailbox surface exposes an unrelated mailbox", async () => {
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			const path = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url).pathname;
			if (path === "/api/auth/login") {
				return new Response("{}", { status: 200, headers: { "set-cookie": "ep_session=secret" } });
			}
			if (path === "/api/auth/me") return Response.json({ user: { id: plan.userId } });
			if (path === "/api/mailboxes") {
				return Response.json({ success: true, data: { mailboxes: [{ id: plan.allowedMailboxId }, { id: plan.deniedMailboxId }] } });
			}
			throw new Error("should stop at mailbox isolation");
		});

		await expect(
			verifyRecoveryApplication({
				baseUrl: "https://recovery.example",
				email: plan.email,
				password: "password-plaintext",
				plan,
				expectedAttachment: { sha256: "0".repeat(64), size: 1 },
				fetchImpl,
			}),
		).rejects.toThrow("exact allowed mailbox");
	});
});
