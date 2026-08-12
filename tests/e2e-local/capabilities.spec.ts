import { expect, test } from "@playwright/test";
import { api } from "./api";
import { MEMBER_STATE, VIEWER_STATE } from "./auth-paths";

/**
 * The capability split inside a mailbox two people share.
 *
 * `isolation.spec.ts` covers the membership question — a mailbox the user has no
 * row for. This file covers the harder one: the viewer *is* a member of `shared`
 * and may read every message in it, yet must not send from it or touch its drafts.
 * A check that only ever denied users their own mailbox would never notice a send
 * path that authorized on membership instead of capability.
 *
 * The mocked suite has viewer scenarios already, but they assert that the UI hides
 * controls when handed `role: "viewer"`. Hidden controls are not a security
 * boundary. These tests ask the server.
 */

const SHARED_ADDRESS = "shared@e2e.test";
const SHARED_MAILBOX = "e2e_mbx_shared";
const SHARED_DRAFT_SUBJECT = "shared draft subject";

test.describe("a viewer may read a shared mailbox but not send from it", () => {
	test.use({ storageState: VIEWER_STATE });

	test("reads the mailbox they were granted", async ({ page }) => {
		await page.goto("/inbox");

		// The control for everything below: the denials that follow are about
		// capability, not about the viewer being shut out of the mailbox.
		const mailboxes = await api(page, "/api/mailboxes");
		expect(mailboxes.status).toBe(200);
		expect(mailboxes.body).toContain('"localPart":"shared"');

		const messages = await api(page, `/api/messages?mailboxId=${SHARED_MAILBOX}`);
		expect(messages.status).toBe(200);
		expect(messages.body).toContain("shared subject");
	});

	test("cannot send from it", async ({ page }) => {
		await page.goto("/inbox");

		const denied = await api(page, "/api/send", {
			method: "POST",
			body: {
				from: SHARED_ADDRESS,
				to: "nobody@e2e.test",
				subject: "should never be accepted",
				text: "should never be accepted",
			},
		});

		// The same 404 a non-member gets. Answering differently would tell a viewer
		// that the mailbox exists and only the capability is missing.
		expect(denied.status).toBe(404);
		expect(denied.body).toContain("Mailbox not found");
	});

	test("cannot create a draft in it", async ({ page }) => {
		await page.goto("/inbox");

		const denied = await api(page, "/api/drafts", {
			method: "POST",
			body: {
				mailboxId: SHARED_MAILBOX,
				from: SHARED_ADDRESS,
				to: "nobody@e2e.test",
				subject: "should never be stored",
				text: "should never be stored",
			},
		});

		expect(denied.status).toBe(404);
	});

	test("cannot list its drafts", async ({ page }) => {
		await page.goto("/inbox");

		// Draft metadata is message content: subjects and recipients of mail not yet
		// sent. Listing is gated on send capability, not read.
		const drafts = await api(page, `/api/drafts?mailboxId=${SHARED_MAILBOX}`);
		expect(drafts.status).toBe(200);
		expect(drafts.body).not.toContain(SHARED_DRAFT_SUBJECT);
		expect(JSON.parse(drafts.body).data.drafts).toEqual([]);
	});

	test("is offered no send affordances and cannot navigate to compose", async ({ page }) => {
		await page.goto("/inbox");

		await expect(page.getByRole("button", { name: "Compose" })).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Drafts" })).toHaveCount(0);

		await page.goto("/compose");
		await expect(page).not.toHaveURL(/\/compose$/);
	});
});

test.describe("a responder on the same mailbox is not restricted", () => {
	test.use({ storageState: MEMBER_STATE });

	test("may list drafts the viewer may not", async ({ page }) => {
		await page.goto("/inbox");

		// Same mailbox, same endpoint, different capability. Without this the viewer's
		// empty draft list could equally mean the endpoint is broken.
		const drafts = await api(page, `/api/drafts?mailboxId=${SHARED_MAILBOX}`);
		expect(drafts.status).toBe(200);
		expect(drafts.body).toContain(SHARED_DRAFT_SUBJECT);
	});

	test("reaches compose rather than being redirected away", async ({ page }) => {
		await page.goto("/inbox");

		await page.goto("/compose");
		await expect(page).toHaveURL(/\/compose$/);
	});
});
