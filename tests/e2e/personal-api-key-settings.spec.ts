import { expect, test, type Page } from "@playwright/test";
import { folderCounts, mockAuthShell } from "./shell";

async function mockRestrictedMember(page: Page) {
	await mockAuthShell(page, {
		sessionToken: "member-session",
		user: {
			id: "member_1",
			email: "person@example.net",
			name: "Mailbox member",
			resetEmail: null,
			role: "member",
		},
		mailboxes: [{
			id: "mbx_support",
			localPart: "support",
			hostname: "example.com",
			displayName: "Support",
			isPrimary: false,
			role: "responder",
		}],
		counts: folderCounts(),
	});
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
					success: true,
					data: {
						id: "key_member",
						name: "Thunderbird",
						prefix: "lumi_member1",
						key: "one_time_member_key",
					},
				},
			});
			return;
		}
		await route.fulfill({ json: { success: true, data: { apiKeys: [] } } });
	});

	await page.goto("/settings");
	await page.getByRole("link", { name: "Manage API keys" }).click();

	await expect(page).toHaveURL(/\/settings\/api-keys$/);
	await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
	await page.getByRole("button", { name: "New API key" }).click();
	await page.getByLabel("Name").fill("Thunderbird");
	await page.getByRole("button", { name: "Create key" }).click();
	await expect(page.getByText("one_time_member_key")).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Settings" })
		.getByRole("link", { name: "Members" })).toHaveCount(0);
});
