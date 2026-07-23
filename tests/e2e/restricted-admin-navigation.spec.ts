import { expect, test, type Page } from "@playwright/test";

type OrganizationRole = "owner" | "admin" | "member";

async function mockShell(page: Page, organizationRole: OrganizationRole) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "e2e-session");
	});
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({
			json: {
				user: {
					id: "user_role",
					email: "support@example.com",
					name: "Support",
					resetEmail: null,
					role: organizationRole,
				},
				hasMailboxes: true,
			},
		}),
	);
	await page.route("**/api/mailboxes", (route) =>
		route.fulfill({
			json: {
				mailboxes: [{
					id: "mbx_support",
					localPart: "support",
					hostname: "example.com",
					displayName: "Support",
					isPrimary: true,
					role: "responder",
				}],
			},
		}),
	);
	await page.route("**/api/messages/counts**", (route) =>
		route.fulfill({
			json: {
				counts: {
					folders: {
						inbox: { total: 0, unread: 0 },
						sent: { total: 0, unread: 0 },
						drafts: { total: 0, unread: 0 },
						trash: { total: 0, unread: 0 },
						spam: { total: 0, unread: 0 },
						starred: { total: 0, unread: 0 },
					},
					mailboxes: [],
				},
			},
		}),
	);
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({ json: { messages: [], total: 0, limit: 25, offset: 0 } }),
	);
}

test("hides organization administration and redirects direct member visits", async ({ page }) => {
	await mockShell(page, "member");
	await page.route("**/api/admin/mailboxes", (route) =>
		route.fulfill({ status: 403, json: { error: "Forbidden" } }),
	);

	await page.goto("/inbox");
	await page.getByRole("button", { name: "Support support@example.com" }).click();
	await expect(page.getByRole("link", { name: /Admin settings/i })).toHaveCount(0);

	for (const path of [
		"/admin",
		"/members",
		"/mailboxes",
		"/domains",
		"/api-keys",
		"/aliases",
		"/routing",
		"/webhooks",
	]) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/inbox$/);
		await expect(page.getByRole("button", { name: "New mailbox" })).toHaveCount(0);
	}
});

test("retains organization administration for an owner", async ({ page }) => {
	await mockShell(page, "owner");
	await page.route("**/api/domains", (route) =>
		route.fulfill({ json: { domains: [] } }),
	);
	await page.route("**/api/admin/mailboxes", (route) =>
		route.fulfill({
			json: {
				mailboxes: [],
				canSelfAssign: true,
				currentUserId: "user_role",
			},
		}),
	);

	await page.goto("/inbox");
	await page.getByRole("button", { name: "Support support@example.com" }).click();
	await expect(page.getByRole("link", { name: /Admin settings/i })).toBeVisible();

	await page.goto("/mailboxes");
	await expect(page.getByRole("button", { name: "New mailbox" })).toBeVisible();
});
