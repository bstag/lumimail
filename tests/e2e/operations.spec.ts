import { expect, test, type Page } from "@playwright/test";
import { mockAuthShell } from "./shell";

async function mockOwner(page: Page) {
	await mockAuthShell(page, {
		user: { id: "owner_1", email: "owner@example.com", name: "Owner", role: "owner" },
		mailboxes: [{ id: "mbx_1", localPart: "support", hostname: "example.com",
			displayName: "Support", isPrimary: true, role: "manager" }],
	});
}

test("owner sees the sanitized read-only operations overview", async ({ page }) => {
	await mockOwner(page);
	await page.route("**/api/admin/operations", (route) => route.fulfill({ json: { success: true, data: {
		status: "attention", observedAt: "2026-08-12T18:02:00.000Z",
		application: { version: "0.1.0", schema: "0028" },
		queues: { status: "attention", checkedAt: "2026-08-12T18:01:00.000Z", queueCount: 3,
			attentionCount: 1, unavailableCount: 0, backlogCount: 4, backlogBytes: 2048, staleJobCount: 1 },
		retention: { status: "healthy", scanned: 12, orphanCount: 0, orphanBytes: 0, oldestOrphanAt: null },
	} } }));

	await page.goto("/operations");
	await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
	await expect(page.getByTestId("overall-status")).toHaveText("Needs attention");
	await expect(page.getByRole("heading", { name: "Application" })).toBeVisible();
	await expect(page.getByText("0.1.0", { exact: true })).toBeVisible();
	await expect(page.getByText("0028", { exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Queues" })).toBeVisible();
	await expect(page.getByText("4 messages", { exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Storage retention" })).toBeVisible();
	await expect(page.getByRole("link", { name: "View queue diagnostics" })).toHaveAttribute("href", "/queue-health");
	await expect(page.getByText(/private|inbound\//i)).toHaveCount(0);
});

test("operations overview renders partial unavailability without hiding safe evidence", async ({ page }) => {
	await mockOwner(page);
	await page.route("**/api/admin/operations", (route) => route.fulfill({ json: { success: true, data: {
		status: "unavailable", observedAt: "2026-08-12T18:02:00.000Z",
		application: { version: "0.1.0", schema: "0028" },
		queues: { status: "unavailable", checkedAt: null, queueCount: 0,
			attentionCount: 0, unavailableCount: 0, backlogCount: 0, backlogBytes: 0, staleJobCount: 0 },
		retention: { status: "healthy", scanned: 12, orphanCount: 0, orphanBytes: 0, oldestOrphanAt: null },
	} } }));
	await page.goto("/operations");
	await expect(page.getByTestId("overall-status")).toHaveText("Unavailable");
	await expect(page.getByText("12 objects scanned", { exact: true })).toBeVisible();
});
