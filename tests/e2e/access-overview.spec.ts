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
}

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
