import { expect, test, type Page } from "@playwright/test";

async function mockAdminSession(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "e2e-session");
	});
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { user: { id: "owner_1", role: "owner" }, hasMailboxes: true } }),
	);
	await page.route("**/api/mailboxes", (route) =>
		route.fulfill({ json: { mailboxes: [] } }),
	);
}

test.describe("identity-bound organization invitations", () => {
	test("reveals a new link once and does not expose links for listed invitations", async ({ page }) => {
		await mockAdminSession(page);
		let postCount = 0;
		await page.route("**/api/org/members", async (route) => {
			if (route.request().method() === "POST") {
				postCount += 1;
				await route.fulfill({
					json: {
						success: true,
						data: { invite: { id: "inv_new", token: "tok_visible_once" } },
					},
				});
				return;
			}
			await route.fulfill({
				json: {
					success: true,
					data: {
						members: [
							{
								id: "mem_owner",
								userId: "owner_1",
								email: "owner@example.com",
								name: "Owner",
								role: "owner",
								createdAt: "2026-07-20T12:00:00.000Z",
							},
						],
						invites: [
							{
								id: "inv_pending",
								email: "pending@external.test",
								role: "member",
								expiresAt: "2026-07-30T12:00:00.000Z",
								createdAt: "2026-07-23T12:00:00.000Z",
							},
						],
					},
				},
			});
		});

		await page.goto("/members");
		await expect(page.getByText("pending@external.test")).toBeVisible();
		await expect(page.getByRole("button", { name: "Copy link" })).toHaveCount(0);

		await page.getByRole("button", { name: "Invite member" }).click();
		await page.getByLabel("Email address").fill("teammate@external.test");
		await page.getByRole("button", { name: "Create invite link" }).click();

		await expect.poll(() => postCount).toBe(1);
		const dialog = page.getByRole("dialog", { name: "Invite member" });
		await expect(dialog.getByRole("textbox")).toHaveValue(
			/http:\/\/localhost:\d+\/register\?token=tok_visible_once/,
		);
		await expect(dialog.getByRole("button", { name: "Copy" })).toBeVisible();
	});

	test("shows the invited email as the fixed account identity", async ({ page }) => {
		await page.route("**/api/setup/status", (route) =>
			route.fulfill({
				json: {
					hasPrimaryDomain: true,
					primaryDomain: { hostname: "workspace.test" },
				},
			}),
		);
		await page.route("**/api/org/invites/tok_bound", (route) =>
			route.fulfill({
				json: {
					success: true,
					data: {
						email: "teammate@external.test",
						orgName: "Example Workspace",
						role: "member",
					},
				},
			}),
		);

		await page.goto("/register?token=tok_bound");

		await expect(page.getByText("teammate@external.test")).toBeVisible();
		await expect(page.getByLabel("Username")).toHaveCount(0);
		await expect(page.getByText("@workspace.test")).toHaveCount(0);
	});
});
