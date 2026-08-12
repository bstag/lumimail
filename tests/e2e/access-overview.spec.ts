import { expect, test, type Page } from "@playwright/test";
import { mockAuthShell } from "./shell";

async function mockAccessPage(page: Page) {
	await mockAuthShell(page, {
		user: { id: "owner_1", email: "owner@example.com", name: "Owner", role: "owner" },
	});
	await page.route("**/api/org/members", (route) => route.fulfill({ json: { success: true, data: {
		members: [
			{ id: "mem_1", userId: "owner_1", email: "owner@example.com", name: "Owner", role: "owner", createdAt: "2026-08-12T12:00:00.000Z" },
			{ id: "mem_2", userId: "usr_2", email: "none@example.com", name: "No Access", role: "member", createdAt: "2026-08-12T12:00:00.000Z" },
		],
		invites: [],
	} } }));
	await page.route("**/api/admin/access-overview", (route) => route.fulfill({ json: { success: true, data: {
		members: [
			{ id: "mem_2", userId: "usr_2", name: "No Access", email: "none@example.com", organizationRole: "member", grants: [] },
			{ id: "mem_1", userId: "owner_1", name: "Owner", email: "owner@example.com", organizationRole: "owner", grants: [
				{ id: "grant_1", mailboxId: "mbx_1", address: "support@example.com", displayName: "Support", role: "responder", capabilities: ["read", "send"] },
			] },
		],
		mailboxes: [
			{ id: "mbx_2", address: "empty@example.com", displayName: null, assignedMemberCount: 0 },
			{ id: "mbx_1", address: "support@example.com", displayName: "Support", assignedMemberCount: 1 },
		],
	} } }));
	await page.route("**/api/admin/sessions", (route) => route.fulfill({ json: { success: true, data: {
		observedAt: "2026-08-12T20:00:00.000Z", activeCount: 0, sessions: [],
	} } }));
	await page.route("**/api/admin/security-events", (route) => route.fulfill({ json: { success: true, data: {
		events: [], nextCursor: null,
	} } }));
}

test("owner previews and password-confirms additive grants across mailboxes", async ({ page }) => {
	await mockAccessPage(page);
	let reconfirmed = false;
	let grantBody: unknown;
	await page.route("**/api/auth/reconfirm", async (route) => {
		expect(route.request().postDataJSON()).toEqual({ password: "correct horse" });
		reconfirmed = true;
		await route.fulfill({ json: { success: true, data: { recentUntil: "2026-08-12T22:15:00.000Z" } } });
	});
	await page.route("**/api/admin/mailbox-grants", async (route) => {
		expect(reconfirmed).toBe(true);
		grantBody = route.request().postDataJSON();
		await route.fulfill({ json: { success: true, data: { createdCount: 2, requestId: "req_grant" } } });
	});

	await page.goto("/members");
	const member = page.getByTestId("access-member-usr_2");
	await member.getByRole("button", { name: "Manage access" }).click();
	await expect(page.getByRole("heading", { name: "Grant mailbox access" })).toBeVisible();
	const dialog = page.getByRole("dialog", { name: "Grant mailbox access" });
	await page.getByLabel("empty@example.com").check();
	await page.getByLabel("support@example.com").check();
	await page.getByLabel("Mailbox role").selectOption("responder");
	await expect(dialog.getByText("Read · Send", { exact: true })).toBeVisible();
	await expect(dialog.getByText("2 new grants for No Access", { exact: true })).toBeVisible();
	await expect.poll(() => grantBody).toBeUndefined();
	await page.getByLabel("Password", { exact: true }).fill("correct horse");
	await page.getByRole("button", { name: "Grant access", exact: true }).click();
	await expect.poll(() => grantBody).toEqual({
		targetUserId: "usr_2", mailboxIds: ["mbx_2", "mbx_1"], role: "responder",
	});
	await expect(page.getByRole("heading", { name: "Grant mailbox access" })).toHaveCount(0);
});

test("failed password proof keeps bulk grant confirmation open without mutation", async ({ page }) => {
	await mockAccessPage(page);
	await page.route("**/api/auth/reconfirm", (route) => route.fulfill({
		status: 403, json: { success: false, error: { message: "Password confirmation failed" } },
	}));
	let grantRequests = 0;
	await page.route("**/api/admin/mailbox-grants", (route) => {
		grantRequests += 1;
		return route.abort();
	});

	await page.goto("/members");
	await page.getByTestId("access-member-usr_2").getByRole("button", { name: "Manage access" }).click();
	await page.getByLabel("empty@example.com").check();
	await page.getByLabel("Password", { exact: true }).fill("wrong");
	await page.getByRole("button", { name: "Grant access", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Grant mailbox access" })).toBeVisible();
	await expect(page.getByText("Password confirmation failed", { exact: true })).toBeVisible();
	await expect.poll(() => grantRequests).toBe(0);
});

test("access matrix separates workspace role from explicit mailbox capabilities", async ({ page }) => {
	await mockAccessPage(page);
	await page.goto("/members");

	const matrix = page.getByTestId("access-matrix");
	await expect(matrix.getByRole("heading", { name: "Access matrix" })).toBeVisible();
	await expect(matrix.getByText("Workspace role does not grant mailbox access.")).toBeVisible();
	await expect(matrix.getByRole("paragraph").filter({ hasText: /^support@example\.com$/ })).toBeVisible();
	await expect(matrix.getByText("Responder", { exact: true })).toBeVisible();
	await expect(matrix.getByText("Read · Send", { exact: true })).toBeVisible();
	await expect(matrix.getByText("No mailbox access", { exact: true })).toBeVisible();
	await expect(matrix.getByText("empty@example.com", { exact: true })).toBeVisible();
	await expect(matrix.getByText("0 assigned", { exact: true })).toBeVisible();
});

test("access matrix remains usable at a narrow viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockAccessPage(page);
	await page.goto("/members");
	await expect(page.getByTestId("access-matrix")).toBeVisible();
	await expect(page.getByTestId("access-matrix").getByRole("paragraph").filter({ hasText: /^support@example\.com$/ })).toBeVisible();
	await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
