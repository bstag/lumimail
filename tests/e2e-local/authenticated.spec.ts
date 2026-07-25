import { expect, test, type Page } from "@playwright/test";
import { MEMBER_STATE, OWNER_STATE } from "./auth-paths";

/**
 * Authenticated tests against the **real** local backend.
 *
 * The `tests/e2e` suite mocks every API response, so it verifies that the UI renders
 * what it is handed — not that the server would hand it that. These tests use real
 * sessions and assert on real authorization, which is the only way the mailbox ACL
 * and role-aware affordances can be checked without a person doing it by hand.
 *
 * Sessions come from `auth.setup.ts`, which signs in once per role. Fixtures come
 * from `scripts/seed-e2e.mjs`; see there for why the shape is what it is.
 */

/** Reads an API response through the browser so the session cookie is applied. */
async function api(page: Page, path: string) {
	return page.evaluate(async (p) => {
		const response = await fetch(p);
		return { status: response.status, body: await response.text() };
	}, path);
}

test.describe("owner access", () => {
	test.use({ storageState: OWNER_STATE });

	test("resolves a real session", async ({ page }) => {
		await page.goto("/inbox");

		// Exercises the F66 digest lookup end to end: issue, store, resolve.
		const me = await api(page, "/api/auth/me");
		expect(me.status).toBe(200);
		expect(me.body).toContain("owner");
	});

	test("sees every mailbox they manage", async ({ page }) => {
		await page.goto("/inbox");

		const mailboxes = await api(page, "/api/mailboxes");
		expect(mailboxes.status).toBe(200);
		for (const name of ["alpha", "shared", "private"]) {
			expect(mailboxes.body).toContain(`"localPart":"${name}"`);
		}
	});

	test("reaches organization administration", async ({ page }) => {
		await page.goto("/mailboxes");
		await expect(page).toHaveURL(/\/mailboxes/);
	});

	test("configures a responder per mailbox", async ({ page }) => {
		await page.goto("/settings");

		const selector = page.locator("#vacation-mailbox");
		await expect(selector).toBeVisible();

		// F65: one responder per mailbox, not one per user.
		const options = (await selector.locator("option").allTextContents()).join(" ");
		expect(options).toContain("alpha@e2e.test");
		expect(options).toContain("shared@e2e.test");
		expect(options).toContain("private@e2e.test");
	});
});

test.describe("member access is limited to granted mailboxes", () => {
	test.use({ storageState: MEMBER_STATE });

	test("does not see a mailbox they were never granted", async ({ page }) => {
		await page.goto("/inbox");

		const mailboxes = await api(page, "/api/mailboxes");

		// The member responds on `shared` only. `private` has no membership row for
		// them, so it must not appear — this is F47's core promise.
		expect(mailboxes.body).toContain('"localPart":"shared"');
		expect(mailboxes.body).not.toContain('"localPart":"private"');
		expect(mailboxes.body).not.toContain('"localPart":"alpha"');
	});

	test("cannot read messages from an unauthorized mailbox", async ({ page }) => {
		await page.goto("/inbox");

		// Ask the server directly for the mailbox the member cannot see. Client
		// filtering is not the control under test; the server must withhold it.
		const messages = await api(page, "/api/messages?mailboxId=e2e_mbx_private");

		expect(messages.status).toBe(200);
		expect(messages.body).not.toContain("private subject");
	});

	test("reads messages from a mailbox they share", async ({ page }) => {
		await page.goto("/inbox");

		const messages = await api(page, "/api/messages?mailboxId=e2e_mbx_shared");

		expect(messages.status).toBe(200);
		expect(messages.body).toContain("shared subject");
	});

	test("is offered composing, because responder carries send capability", async ({ page }) => {
		await page.goto("/inbox");

		// Renders as a button rather than a link.
		await expect(page.getByRole("button", { name: "Compose" }).first()).toBeVisible();
	});

	test("is redirected away from organization administration", async ({ page }) => {
		// F51: a member must not reach administration, and the redirect happens
		// before any administrative control renders.
		await page.goto("/mailboxes");
		await expect(page).not.toHaveURL(/\/mailboxes$/);
	});

	test("is offered no responder, managing no mailbox", async ({ page }) => {
		await page.goto("/settings");

		await expect(page.getByText("You do not manage any mailbox")).toBeVisible();
	});
});

test.describe("unauthenticated access", () => {
	// Explicitly no stored session: this describe must start signed out.
	test.use({ storageState: { cookies: [], origins: [] } });

	test("refuses the API without a session", async ({ page }) => {
		await page.goto("/login");

		expect((await api(page, "/api/auth/me")).status).toBe(401);
		expect((await api(page, "/api/mailboxes")).status).toBe(401);
	});

	test("rejects a wrong password", async ({ page }) => {
		await page.goto("/login");
		await page.getByLabel("Email").fill("e2e-owner@e2e.test");
		await page.getByLabel("Password").fill("not-the-password");
		await page.getByRole("button", { name: "Sign in" }).click();

		await expect(page).toHaveURL(/\/login/);
		expect((await api(page, "/api/auth/me")).status).toBe(401);
	});
});
