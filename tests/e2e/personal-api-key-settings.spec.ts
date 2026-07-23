import { expect, test, type Page } from "@playwright/test";

async function mockRestrictedMember(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "member-session");
	});
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({
			json: {
				user: {
					id: "member_1",
					email: "person@example.net",
					name: "Mailbox member",
					resetEmail: null,
					role: "member",
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
					isPrimary: false,
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
	await page.route("**/api/vacation", (route) =>
		route.fulfill({ json: { success: true, data: { responder: null } } }),
	);
}

test("restricted member can manage personal keys without organization administration", async ({ page }) => {
	await mockRestrictedMember(page);
	await page.route("**/api/api-keys", async (route) => {
		if (route.request().method() === "POST") {
			await route.fulfill({
				json: {
					id: "key_member",
					name: "Thunderbird",
					prefix: "lumi_member1",
					key: "one_time_member_key",
				},
			});
			return;
		}
		await route.fulfill({ json: { apiKeys: [] } });
	});

	await page.goto("/settings");
	await page.getByRole("link", { name: "Manage API keys" }).click();

	await expect(page).toHaveURL(/\/settings\/api-keys$/);
	await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
	await page.getByRole("button", { name: "New API key" }).click();
	await page.getByLabel("Name").fill("Thunderbird");
	await page.getByRole("button", { name: "Create key" }).click();
	await expect(page.getByText("one_time_member_key")).toBeVisible();
	await expect(page.getByRole("link", { name: /Admin settings/i })).toHaveCount(0);
});
