import { expect, test, type Page } from "@playwright/test";

async function mockAuthenticatedShell(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "e2e-session");
	});
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { id: "user_owner", hasMailboxes: true } }),
	);
	await page.route("**/api/mailboxes", (route) =>
		route.fulfill({
			json: {
				mailboxes: [
					{
						id: "mbx_support",
						localPart: "support",
						hostname: "example.com",
						displayName: "Support",
						isPrimary: true,
						role: "manager",
					},
				],
			},
		}),
	);
	await page.route("**/api/messages/counts**", (route) =>
		route.fulfill({
			json: { inbox: 0, starred: 0, drafts: 0, sent: 0, spam: 0, trash: 0 },
		}),
	);
	await page.route("**/api/domains", (route) =>
		route.fulfill({
			json: {
				domains: [
					{
						id: "dom_1",
						hostname: "example.com",
						status: "active",
						routingEnabled: true,
						sendingEnabled: true,
					},
				],
			},
		}),
	);
}

test.describe("mailbox access administration", () => {
	test("separates organization inventory from content access and lets an owner self-assign", async ({
		page,
	}) => {
		await mockAuthenticatedShell(page);

		let claimed = false;
		let claimBody: unknown;
		await page.route("**/api/admin/mailboxes", (route) =>
			route.fulfill({
				json: {
					mailboxes: [
						{
							id: "mbx_support",
							domainId: "dom_1",
							localPart: "support",
							hostname: "example.com",
							displayName: "Support",
							isPrimary: true,
							role: "manager",
						},
						{
							id: "mbx_private",
							domainId: "dom_1",
							localPart: "private",
							hostname: "example.com",
							displayName: "Private",
							isPrimary: false,
							role: claimed ? "manager" : null,
						},
					],
					canSelfAssign: true,
					currentUserId: "user_owner",
				},
			}),
		);
		await page.route("**/api/mailboxes/mbx_private/members", async (route) => {
			claimBody = route.request().postDataJSON();
			claimed = true;
			await route.fulfill({
				json: { success: true, data: { id: "mbm_owner_private" } },
			});
		});

		await page.goto("/mailboxes");

		await expect(
			page.getByRole("link", { name: /Support support@example\.com manager/i }),
		).toHaveAttribute("href", "/mailboxes/mbx_support");
		const privateMailbox = page.getByText("private@example.com").locator("..").locator("..");
		await expect(privateMailbox.getByText("No content access")).toBeVisible();
		await expect(privateMailbox.getByRole("link")).toHaveCount(0);

		await privateMailbox.getByRole("button", { name: "Claim access" }).click();

		await expect.poll(() => claimBody).toEqual({
			userId: "user_owner",
			role: "manager",
		});
		await expect(
			page.getByRole("link", { name: /Private private@example\.com manager/i }),
		).toHaveAttribute("href", "/mailboxes/mbx_private");
	});

	test("requires the exact mailbox address before deletion", async ({ page }) => {
		await mockAuthenticatedShell(page);

		let deleteBody: unknown;
		await page.route("**/api/admin/mailboxes", (route) =>
			route.fulfill({
				json: {
					mailboxes: [],
					canSelfAssign: true,
					currentUserId: "user_owner",
				},
			}),
		);
		await page.route("**/api/mailboxes/mbx_support", async (route) => {
			if (route.request().method() === "DELETE") {
				deleteBody = route.request().postDataJSON();
				await route.fulfill({ json: { ok: true } });
				return;
			}
			await route.fulfill({
				json: {
					mailbox: {
						id: "mbx_support",
						userId: "user_owner",
						domainId: "dom_1",
						localPart: "support",
						hostname: "example.com",
						displayName: "Support",
						createdAt: "2026-07-23T12:00:00.000Z",
						isPrimary: true,
						role: "manager",
					},
				},
			});
		});
		await page.route("**/api/mailboxes/mbx_support/members", (route) =>
			route.fulfill({
				json: {
					success: true,
					data: {
						members: [],
						workspaceMembers: [],
					},
				},
			}),
		);

		await page.goto("/mailboxes/mbx_support");

		const deleteButton = page.getByRole("button", { name: "Delete mailbox" });
		await expect(deleteButton).toBeDisabled();
		await page.getByLabel("Confirm mailbox address").fill("support@example.com");
		await expect(deleteButton).toBeEnabled();
		await deleteButton.click();

		await expect.poll(() => deleteBody).toEqual({
			confirmAddress: "support@example.com",
		});
		await expect(page).toHaveURL(/\/mailboxes$/);
	});
});
