import { expect, test } from "@playwright/test";
import { folderCounts, mockAuthShell } from "./shell";

test("external accounts disclose sharing, expose lifecycle state, and start bounded OAuth", async ({ page }) => {
	await mockAuthShell(page, {
		user: { id: "usr_owner", email: "owner@example.com", name: "Owner", role: "owner" },
		mailboxes: [{
			id: "mbx_support", localPart: "support", hostname: "example.com",
			displayName: "Support", isPrimary: true, role: "manager",
		}],
		counts: folderCounts(),
	});
	await page.route("**/api/external-accounts", (route) => route.fulfill({ json: {
		success: true,
		data: { accounts: [{
			id: "exa_google", mailboxId: "mbx_support", mailboxAddress: "support@example.com",
			ownerUserId: "usr_owner", ownerName: "Owner", provider: "google",
			externalAddress: "owner@gmail.com", status: "active", importMode: "from_now",
			retainOriginal: false, lastSyncAt: "2026-08-15T12:00:00.000Z", lastErrorCode: null,
		}] },
	} }));
	await page.route("**/api/auth/reconfirm", (route) => route.fulfill({ json: {
		success: true, data: { ok: true },
	} }));
	let oauthBody: Record<string, unknown> | null = null;
	await page.route("**/api/external-accounts/oauth/start", async (route) => {
		oauthBody = route.request().postDataJSON();
		await route.fulfill({ json: { success: true, data: { redirectTo: "/settings/external-accounts?oauth=started" } } });
	});

	await page.goto("/settings/external-accounts");
	await expect(page.getByRole("heading", { name: "External accounts" })).toBeVisible();
	await expect(page.getByText("This is not yet a complete backup or restore service.")).toBeVisible();
	await expect(page.getByText("owner@gmail.com")).toBeVisible();
	await expect(page.getByText("google · support@example.com")).toBeVisible();
	await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Connect Google" })).toBeDisabled();

	await page.getByLabel("Target mailbox").selectOption("mbx_support");
	await page.getByLabel("Initial import").selectOption("recent_30_days");
	await page.getByText("I understand every Picket user").click();
	await page.getByLabel("Confirm your Picket password").fill("correct horse");
	await page.getByRole("button", { name: "Connect Google" }).click();
	await expect.poll(() => oauthBody).toEqual({
		provider: "google", mailboxId: "mbx_support", importMode: "recent_30_days",
		retainOriginal: false,
	});
});

async function mockExternalAccountsPage(page: import("@playwright/test").Page) {
	await mockAuthShell(page, {
		user: { id: "usr_owner", email: "owner@example.com", name: "Owner", role: "owner" },
		mailboxes: [{
			id: "mbx_support", localPart: "support", hostname: "example.com",
			displayName: "Support", isPrimary: true, role: "manager",
		}],
		counts: folderCounts(),
	});
	await page.route("**/api/external-accounts", (route) => route.fulfill({ json: {
		success: true, data: { accounts: [] },
	} }));
}

test("external accounts offers a retry for an errored or resync-required account", async ({ page }) => {
	await mockAuthShell(page, {
		user: { id: "usr_owner", email: "owner@example.com", name: "Owner", role: "owner" },
		mailboxes: [{
			id: "mbx_support", localPart: "support", hostname: "example.com",
			displayName: "Support", isPrimary: true, role: "manager",
		}],
		counts: folderCounts(),
	});
	const account = (id: string, status: string, lastErrorCode: string | null) => ({
		id, mailboxId: "mbx_support", mailboxAddress: "support@example.com",
		ownerUserId: "usr_owner", ownerName: "Owner", provider: "google",
		externalAddress: `${id}@gmail.com`, status, importMode: "recent_30_days",
		retainOriginal: false, lastSyncAt: null, lastErrorCode,
	});
	await page.route("**/api/external-accounts", (route) => route.fulfill({ json: {
		success: true,
		data: { accounts: [
			account("errored", "error", "sync_failed"),
			account("stale", "resync_required", "cursor_expired"),
			account("paused", "paused", null),
		] },
	} }));
	const synced: string[] = [];
	await page.route("**/api/external-accounts/*/sync", async (route) => {
		synced.push(route.request().url().split("/").at(-2)!);
		await route.fulfill({ json: { success: true, data: { jobId: "exj_1" } } });
	});

	await page.goto("/settings/external-accounts");
	const errored = page.getByRole("article").filter({ hasText: "errored@gmail.com" });
	const stale = page.getByRole("article").filter({ hasText: "stale@gmail.com" });
	const paused = page.getByRole("article").filter({ hasText: "paused@gmail.com" });
	await expect(errored.getByRole("button", { name: "Retry sync" })).toBeEnabled();
	await expect(stale.getByRole("button", { name: "Retry sync" })).toBeEnabled();
	await expect(paused.getByRole("button", { name: "Sync now" })).toBeDisabled();

	await errored.getByRole("button", { name: "Retry sync" }).click();
	await expect.poll(() => synced).toEqual(["errored"]);
});

test("external accounts shows the OAuth callback error and clears it from the address bar", async ({ page }) => {
	await mockExternalAccountsPage(page);
	await page.goto("/settings/external-accounts?error=reauthenticate");
	await expect(page.getByRole("alert").filter({
		hasText: "Your password confirmation expired before the provider returned. Confirm your password and connect again.",
	})).toBeVisible();
	await expect(page).toHaveURL(/\/settings\/external-accounts$/);
});

test("external accounts confirms a completed OAuth connection", async ({ page }) => {
	await mockExternalAccountsPage(page);
	await page.goto("/settings/external-accounts?connected=exa_google");
	await expect(page.getByText("External account connected. The initial import will start shortly.")).toBeVisible();
	await expect(page).toHaveURL(/\/settings\/external-accounts$/);
});

test.describe("sync attention banner", () => {
	const owned = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
		id, mailboxId: "mbx_support", mailboxAddress: "support@example.com",
		ownerUserId: "usr_owner", ownerName: "Owner", provider: "google",
		externalAddress: `${id}@gmail.com`, status, importMode: "recent_30_days",
		retainOriginal: false, lastSyncAt: null, lastErrorCode: null,
		nextRetryAt: null, autoRetryExhausted: false, skippedMessageCount: 0, ...extra,
	});

	async function mockAccounts(page: import("@playwright/test").Page, accounts: unknown[]) {
		await mockAuthShell(page, {
			user: { id: "usr_owner", email: "owner@example.com", name: "Owner", role: "owner" },
			mailboxes: [{
				id: "mbx_support", localPart: "support", hostname: "example.com",
				displayName: "Support", isPrimary: true, role: "manager",
			}],
			counts: folderCounts(),
		});
		await page.route("**/api/external-accounts", (route) => route.fulfill({ json: {
			success: true, data: { accounts },
		} }));
	}

	test("tells the owner what needs attention, in the settings shell", async ({ page }) => {
		await mockAccounts(page, [
			owned("lost", "reconnect_required"),
			owned("waiting", "error", { nextRetryAt: new Date(Date.now() + 3_600_000).toISOString() }),
			owned("stopped", "error", { autoRetryExhausted: true }),
			owned("skips", "active", { skippedMessageCount: 2 }),
			{ ...owned("theirs", "reconnect_required"), ownerUserId: "usr_someone_else" },
		]);

		await page.goto("/settings");
		const banners = page.getByTestId("external-sync-banners");
		await expect(banners.getByRole("alert").filter({ hasText: "Reconnect lost@gmail.com" })).toBeVisible();
		await expect(banners.getByRole("alert").filter({ hasText: "Sync for stopped@gmail.com stopped" })).toBeVisible();
		await expect(banners.getByRole("status").filter({ hasText: "Retrying automatically at" })).toBeVisible();
		await expect(banners.getByRole("status").filter({ hasText: "2 messages from skips@gmail.com could not be imported" })).toBeVisible();
		await expect(banners.getByText("theirs@gmail.com")).toHaveCount(0);
		await expect(banners.getByRole("link", { name: "View" }).first()).toHaveAttribute("href", "/settings/external-accounts");
	});

	test("shows nothing for healthy accounts and is hidden on the External accounts page itself", async ({ page }) => {
		await mockAccounts(page, [owned("fine", "active")]);
		await page.goto("/settings");
		await expect(page.getByTestId("external-sync-banners")).toHaveCount(0);

		await page.unroute("**/api/external-accounts");
		await page.route("**/api/external-accounts", (route) => route.fulfill({ json: {
			success: true, data: { accounts: [owned("lost", "reconnect_required")] },
		} }));
		await page.goto("/settings/external-accounts");
		await expect(page.getByRole("heading", { name: "External accounts" })).toBeVisible();
		await expect(page.getByTestId("external-sync-banners")).toHaveCount(0);
		// The card itself carries the same explanation.
		await expect(page.getByRole("status").filter({ hasText: "Reconnect lost@gmail.com" })).toBeVisible();
	});

	test("also appears in the mail shell", async ({ page }) => {
		await mockAccounts(page, [owned("lost", "reconnect_required")]);
		await page.route("**/api/messages**", (route) => route.fulfill({ json: { messages: [], nextCursor: null } }));
		await page.goto("/inbox");
		await expect(page.getByTestId("external-sync-banners").getByRole("alert")).toContainText("Reconnect lost@gmail.com");
	});
});
