import { expect, test, type Page } from "@playwright/test";
import { mockAuthShell } from "./shell";

async function mockAdminSession(page: Page) {
	// This spec never seeded a session token; the mocked /api/auth/me is enough.
	await mockAuthShell(page, {
		sessionToken: null,
		user: { id: "owner_1", role: "owner" },
	});
	await page.route("**/api/admin/access-overview", (route) =>
		route.fulfill({ json: { success: true, data: { members: [], mailboxes: [] } } }),
	);
	await page.route("**/api/admin/sessions", (route) =>
		route.fulfill({ json: { success: true, data: { observedAt: "2026-08-12T20:00:00.000Z", activeCount: 0, sessions: [] } } }),
	);
}

test.describe("identity-bound organization invitations", () => {
	test("sends a new invitation, reveals its link once, and presents lifecycle state", async ({ page }) => {
		await mockAdminSession(page);
		let postCount = 0;
		await page.route("**/api/org/members", async (route) => {
			if (route.request().method() === "POST") {
				postCount += 1;
				await route.fulfill({
					json: {
						success: true,
						data: { invite: { id: "inv_new", token: "tok_visible_once", deliveryStatus: "sent" } },
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
								status: "expired",
								deliveryStatus: "failed",
								lastDeliveryAttemptAt: "2026-07-23T12:01:00.000Z",
								lastDeliveredAt: null,
								acceptedAt: null,
							},
						],
					},
				},
			});
		});

		await page.goto("/members");
		await expect(page.getByText("pending@external.test")).toBeVisible();
		await expect(page.getByText("Expired", { exact: true })).toBeVisible();
		await expect(page.getByText("Delivery failed", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Copy link" })).toHaveCount(0);

		await page.getByRole("button", { name: "Invite member" }).click();
		await page.getByLabel("Email address").fill("teammate@external.test");
		await page.getByRole("button", { name: "Send invitation" }).click();

		await expect.poll(() => postCount).toBe(1);
		const dialog = page.getByRole("dialog", { name: "Invite member" });
		await expect(dialog.getByRole("textbox")).toHaveValue(
			/http:\/\/localhost:\d+\/register\?token=tok_visible_once/,
		);
		await expect(dialog.getByRole("button", { name: "Copy" })).toBeVisible();
		await expect(dialog.getByText("Invitation sent", { exact: true })).toBeVisible();
	});

	test("resends an eligible invitation and exposes the rotated fallback link once", async ({ page }) => {
		await mockAdminSession(page);
		let resendCount = 0;
		await page.route("**/api/org/members", (route) => route.fulfill({ json: {
			success: true,
			data: { members: [], invites: [{
				id: "inv_expired", email: "expired@example.com", role: "member",
				expiresAt: "2026-08-01T12:00:00.000Z", createdAt: "2026-07-20T12:00:00.000Z",
				status: "expired", deliveryStatus: "sent", lastDeliveryAttemptAt: "2026-07-20T12:00:00.000Z",
				lastDeliveredAt: "2026-07-20T12:00:00.000Z", acceptedAt: null,
			}] },
		} }));
		await page.route("**/api/org/invites/inv_expired/resend", async (route) => {
			resendCount += 1;
			await route.fulfill({ json: { success: true, data: { invite: {
				id: "inv_expired", token: "tok_rotated", deliveryStatus: "sent",
			} } } });
		});

		await page.goto("/members");
		await page.getByRole("button", { name: "Resend invitation" }).click();
		await expect.poll(() => resendCount).toBe(1);
		const dialog = page.getByRole("dialog", { name: "Invitation resent" });
		await expect(dialog.getByRole("textbox")).toHaveValue(/register\?token=tok_rotated/);
		await expect(dialog.getByText("Invitation sent", { exact: true })).toBeVisible();
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

	test("shows an invite-only explanation on a configured instance", async ({ page }) => {
		await page.route("**/api/setup/status", (route) =>
			route.fulfill({
				json: {
					hasPrimaryDomain: true,
					primaryDomain: { hostname: "workspace.test" },
				},
			}),
		);

		await page.goto("/register");

		await expect(page.getByText(/Registration is invitation-only/)).toBeVisible();
		await expect(page.getByLabel("Username")).toHaveCount(0);
		await expect(page.getByLabel("Password")).toHaveCount(0);
	});
});
