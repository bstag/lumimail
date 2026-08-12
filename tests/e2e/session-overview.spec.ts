import { expect, test, type Page } from "@playwright/test";
import { mockAuthShell } from "./shell";

async function mockMembersSurface(page: Page, role: "owner" | "admin") {
	await mockAuthShell(page, {
		user: { id: `${role}_1`, email: `${role}@example.com`, name: role === "owner" ? "Owner" : "Admin", role },
	});
	await page.route("**/api/org/members", (route) => route.fulfill({ json: { success: true, data: {
		members: [{ id: `mem_${role}`, userId: `${role}_1`, email: `${role}@example.com`, name: role === "owner" ? "Owner" : "Admin", role, createdAt: "2026-08-12T12:00:00.000Z" }],
		invites: [],
	} } }));
	await page.route("**/api/admin/access-overview", (route) => route.fulfill({ json: { success: true, data: {
		members: [{ id: `mem_${role}`, userId: `${role}_1`, name: role === "owner" ? "Owner" : "Admin", email: `${role}@example.com`, organizationRole: role, grants: [] }],
		mailboxes: [],
	} } }));
}

test("owner sees active sessions and the current-session marker", async ({ page }) => {
	await mockMembersSurface(page, "owner");
	await page.route("**/api/admin/sessions", (route) => route.fulfill({ json: { success: true, data: {
		observedAt: "2026-08-12T20:00:00.000Z",
		activeCount: 2,
		sessions: [
			{ id: "sess_current", userId: "owner_1", name: "Owner", email: "owner@example.com", createdAt: "2026-08-11T10:00:00.000Z", expiresAt: "2026-09-10T10:00:00.000Z", isCurrent: true },
			{ id: "sess_other", userId: "usr_2", name: "Teammate", email: "team@example.com", createdAt: "2026-08-10T10:00:00.000Z", expiresAt: "2026-09-09T10:00:00.000Z", isCurrent: false },
		],
	} } }));

	await page.goto("/members");
	const sessions = page.getByTestId("session-overview");
	await expect(sessions.getByRole("heading", { name: "Active sessions" })).toBeVisible();
	await expect(sessions.getByText("2 active", { exact: true })).toBeVisible();
	await expect(sessions.getByText("This session", { exact: true })).toBeVisible();
	await expect(sessions.getByText("team@example.com", { exact: true })).toBeVisible();
	await expect(sessions).not.toContainText(/token|lookup|hash/i);
});

test("organization admin does not request or render owner-only sessions", async ({ page }) => {
	await mockMembersSurface(page, "admin");
	let sessionRequests = 0;
	await page.route("**/api/admin/sessions", (route) => {
		sessionRequests += 1;
		return route.fulfill({ status: 403, json: { success: false, error: { message: "Forbidden" } } });
	});

	await page.goto("/members");
	await expect(page.getByTestId("access-matrix")).toBeVisible();
	await expect(page.getByTestId("session-overview")).toHaveCount(0);
	await expect.poll(() => sessionRequests).toBe(0);
});
