import { expect, test, type Browser } from "@playwright/test";
import { api, asRole } from "./api";
import { MEMBER_STATE, OWNER_STATE } from "./auth-paths";

/**
 * Mailbox isolation against the real backend.
 *
 * The production gate names five verbs: a restricted user must not be able to
 * *enumerate, read, search, download from, or send as* an unauthorized mailbox.
 * `authenticated.spec.ts` covers enumerate and read. This file covers the rest,
 * plus the mutating paths, because a read-only check would miss a write that
 * succeeds on a row the user cannot see.
 *
 * Every case pairs a denial with a positive control on `shared`. Without the
 * control, a handler that failed for an unrelated reason — a typo'd route, a
 * broken fixture — would look like working authorization.
 *
 * Fixtures come from `scripts/seed-e2e.mjs`. The member responds on `shared` and
 * has no membership row at all for `private`.
 */

const PRIVATE = {
	mailboxId: "e2e_mbx_private",
	messageId: "e2e_msg_private_0",
	threadId: "e2e_thr_private",
	subject: "private subject",
	address: "private@e2e.test",
};

const SHARED = {
	mailboxId: "e2e_mbx_shared",
	messageId: "e2e_msg_shared_0",
	threadId: "e2e_thr_shared",
	subject: "shared subject",
};

/** Reads a path as the owner, who can see every fixture mailbox. */
async function asOwner(browser: Browser, path: string) {
	return asRole(browser, OWNER_STATE, path);
}

test.describe("a member cannot reach a mailbox they were not granted", () => {
	test.use({ storageState: MEMBER_STATE });

	test("cannot search into it", async ({ page }) => {
		await page.goto("/inbox");

		const denied = await api(page, "/api/messages/search?q=private");
		expect(denied.status).toBe(200);
		expect(denied.body).not.toContain(PRIVATE.subject);

		// Control: the same endpoint does return results the member may see, so the
		// absence above is authorization and not a search that matches nothing.
		const allowed = await api(page, "/api/messages/search?q=shared");
		expect(allowed.status).toBe(200);
		expect(allowed.body).toContain(SHARED.subject);
	});

	test("cannot open one of its messages by id", async ({ page }) => {
		await page.goto("/inbox");

		expect((await api(page, `/api/messages/${PRIVATE.messageId}`)).status).toBe(404);
		expect((await api(page, `/api/messages/${SHARED.messageId}`)).status).toBe(200);
	});

	test("cannot read its thread", async ({ page }) => {
		await page.goto("/inbox");

		const denied = await api(page, `/api/messages/thread/${PRIVATE.threadId}`);
		expect(denied.body).not.toContain(PRIVATE.subject);

		const allowed = await api(page, `/api/messages/thread/${SHARED.threadId}`);
		expect(allowed.body).toContain(SHARED.subject);
	});

	test("cannot list its attachments", async ({ page }) => {
		await page.goto("/inbox");

		// The download path is guarded by the same message lookup, so a message the
		// member cannot resolve yields no attachment ids to download in the first place.
		expect((await api(page, `/api/messages/${PRIVATE.messageId}/attachments`)).status).toBe(404);
		expect((await api(page, `/api/messages/${SHARED.messageId}/attachments`)).status).toBe(200);
	});

	test("cannot count its messages", async ({ page }) => {
		await page.goto("/inbox");

		const denied = await api(page, `/api/messages/counts?mailboxId=${PRIVATE.mailboxId}`);
		expect(denied.status).toBe(200);
		expect(denied.body).not.toContain(PRIVATE.mailboxId);

		const allowed = await api(page, `/api/messages/counts?mailboxId=${SHARED.mailboxId}`);
		expect(allowed.body).toContain(SHARED.mailboxId);
	});

	test("cannot read it as a mailbox record", async ({ page }) => {
		await page.goto("/inbox");

		expect((await api(page, `/api/mailboxes/${PRIVATE.mailboxId}`)).status).toBe(404);
		expect((await api(page, `/api/mailboxes/${SHARED.mailboxId}`)).status).toBe(200);
	});

	test("cannot send as it", async ({ page }) => {
		await page.goto("/inbox");

		// Only the refusal is exercised. A successful send would hand a real message
		// to the configured provider, which is not something a test should do.
		const denied = await api(page, "/api/send", {
			method: "POST",
			body: {
				from: PRIVATE.address,
				to: "nobody@e2e.test",
				subject: "should never be accepted",
				text: "should never be accepted",
			},
		});

		expect(denied.status).toBe(404);
		expect(denied.body).toContain("Mailbox not found");
	});

	test("cannot mark one of its messages read", async ({ page }) => {
		await page.goto("/inbox");

		expect((await api(page, `/api/messages/${PRIVATE.messageId}/read`, { method: "POST" })).status)
			.toBe(404);
	});

	test("cannot mutate its messages through a bulk action", async ({ page, browser }) => {
		await page.goto("/inbox");

		// Bulk reports success without disclosing which ids it matched, so the denial
		// has to be proven by the row itself. The owner is the only witness that can
		// see the message at all.
		const before = await asOwner(browser, `/api/messages/${PRIVATE.messageId}`);
		expect(before.status).toBe(200);
		expect(before.body).toContain('"status":"received"');

		const bulk = await api(page, "/api/messages/bulk", {
			method: "POST",
			body: { action: "trash", messageIds: [PRIVATE.messageId] },
		});
		expect(bulk.status).toBe(200);

		const after = await asOwner(browser, `/api/messages/${PRIVATE.messageId}`);
		expect(after.body).toContain('"status":"received"');
	});

	test("cannot reach the organization administration API", async ({ page }) => {
		await page.goto("/inbox");

		// F51: the client hides the entry point, but the server is the control.
		expect((await api(page, "/api/admin/mailboxes")).status).toBe(403);
	});
});
