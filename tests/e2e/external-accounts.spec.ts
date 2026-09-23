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
