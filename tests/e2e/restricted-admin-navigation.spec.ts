import { expect, test, type Page } from "@playwright/test";
import { folderCounts, mockAuthShell } from "./shell";

type OrganizationRole = "owner" | "admin" | "member";

async function mockShell(page: Page, organizationRole: OrganizationRole) {
	await mockAuthShell(page, {
		user: {
			id: "user_role",
			email: "support@example.com",
			name: "Support",
			resetEmail: null,
			role: organizationRole,
		},
		mailboxes: [{
			id: "mbx_support",
			localPart: "support",
			hostname: "example.com",
			displayName: "Support",
			isPrimary: true,
			role: "responder",
		}],
		counts: folderCounts(),
	});
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
		"/queue-health",
	]) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/inbox$/);
		await expect(page.getByRole("button", { name: "New mailbox" })).toHaveCount(0);
	}
});

test("keeps deployment queue health owner-only for an organization admin", async ({ page }) => {
	await mockShell(page, "admin");
	await page.goto("/queue-health");
	await expect(page).toHaveURL(/\/inbox$/);
	await expect(page.getByRole("heading", { name: "Queue health" })).toHaveCount(0);
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
