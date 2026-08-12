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

test("owner confirms a password before revoking one non-current session", async ({ page }) => {
	await mockMembersSurface(page, "owner");
	let sessions = [
		{ id: "sess_current", userId: "owner_1", name: "Owner", email: "owner@example.com", createdAt: "2026-08-11T10:00:00.000Z", expiresAt: "2026-09-10T10:00:00.000Z", isCurrent: true },
		{ id: "sess_other", userId: "usr_2", name: "Teammate", email: "team@example.com", createdAt: "2026-08-10T10:00:00.000Z", expiresAt: "2026-09-09T10:00:00.000Z", isCurrent: false },
	];
	await page.route("**/api/admin/sessions", (route) => route.fulfill({ json: { success: true, data: {
		observedAt: "2026-08-12T20:00:00.000Z", activeCount: sessions.length, sessions,
	} } }));
	let reconfirmed = false;
	await page.route("**/api/auth/reconfirm", async (route) => {
		expect(route.request().postDataJSON()).toEqual({ password: "correct horse" });
		reconfirmed = true;
		await route.fulfill({ json: { success: true, data: { recentUntil: "2026-08-12T20:15:00.000Z" } } });
	});
	await page.route("**/api/admin/sessions/sess_other", async (route) => {
		expect(reconfirmed).toBe(true);
		sessions = sessions.filter((session) => session.id !== "sess_other");
		await route.fulfill({ json: { success: true, data: { revokedCount: 1, requestId: "req_1" } } });
	});

	await page.goto("/members");
	await expect(page.getByRole("button", { name: "Revoke this session" })).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Revoke this session" }).first()).toBeVisible();
	await page.getByRole("button", { name: "Revoke this session" }).click();
	await expect(page.getByRole("heading", { name: "Revoke session?" })).toBeVisible();
	await page.getByLabel("Password").fill("correct horse");
	await page.getByRole("button", { name: "Revoke session", exact: true }).click();
	await expect(page.getByText("team@example.com", { exact: true })).toHaveCount(0);
	await expect(page.getByText("1 active", { exact: true })).toBeVisible();
	await expect(page.getByTestId("session-overview").getByText("owner@example.com", { exact: true })).toBeVisible();
});

test("failed password confirmation keeps the destructive session dialog open", async ({ page }) => {
	await mockMembersSurface(page, "owner");
	await page.route("**/api/admin/sessions", (route) => route.fulfill({ json: { success: true, data: {
		observedAt: "2026-08-12T20:00:00.000Z", activeCount: 2, sessions: [
			{ id: "sess_current", userId: "owner_1", name: "Owner", email: "owner@example.com", createdAt: "2026-08-11T10:00:00.000Z", expiresAt: "2026-09-10T10:00:00.000Z", isCurrent: true },
			{ id: "sess_other", userId: "usr_2", name: "Teammate", email: "team@example.com", createdAt: "2026-08-10T10:00:00.000Z", expiresAt: "2026-09-09T10:00:00.000Z", isCurrent: false },
		],
	} } }));
	await page.route("**/api/auth/reconfirm", (route) => route.fulfill({
		status: 403, json: { success: false, error: { message: "Password confirmation failed" } },
	}));
	let revokeRequests = 0;
	await page.route("**/api/admin/sessions/sess_other", (route) => {
		revokeRequests += 1;
		return route.abort();
	});

	await page.goto("/members");
	await page.getByRole("button", { name: "Revoke this session" }).click();
	await page.getByLabel("Password").fill("wrong");
	await page.getByRole("button", { name: "Revoke session", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Revoke session?" })).toBeVisible();
	await expect(page.getByText("Password confirmation failed", { exact: true })).toBeVisible();
	await expect.poll(() => revokeRequests).toBe(0);
});

test("revoke others preserves the current session", async ({ page }) => {
	await mockMembersSurface(page, "owner");
	let sessions = [
		{ id: "sess_current", userId: "owner_1", name: "Owner", email: "owner@example.com", createdAt: "2026-08-11T10:00:00.000Z", expiresAt: "2026-09-10T10:00:00.000Z", isCurrent: true },
		{ id: "sess_other", userId: "usr_2", name: "Teammate", email: "team@example.com", createdAt: "2026-08-10T10:00:00.000Z", expiresAt: "2026-09-09T10:00:00.000Z", isCurrent: false },
	];
	await page.route("**/api/admin/sessions", (route) => route.fulfill({ json: { success: true, data: {
		observedAt: "2026-08-12T20:00:00.000Z", activeCount: sessions.length, sessions,
	} } }));
	await page.route("**/api/auth/reconfirm", (route) => route.fulfill({ json: { success: true, data: { recentUntil: "2026-08-12T20:15:00.000Z" } } }));
	await page.route("**/api/admin/sessions/revoke-others", async (route) => {
		sessions = sessions.filter((session) => session.isCurrent);
		await route.fulfill({ json: { success: true, data: { revokedCount: 1, requestId: "req_2" } } });
	});

	await page.goto("/members");
	await page.getByRole("button", { name: "Revoke all other sessions" }).click();
	await expect(page.getByRole("heading", { name: "Revoke all other sessions?" })).toBeVisible();
	await page.getByLabel("Password").fill("correct horse");
	await page.getByRole("button", { name: "Revoke other sessions" }).click();
	await expect(page.getByText("1 active", { exact: true })).toBeVisible();
	await expect(page.getByTestId("session-overview").getByText("owner@example.com", { exact: true })).toBeVisible();
	await expect(page.getByText("team@example.com", { exact: true })).toHaveCount(0);
});
