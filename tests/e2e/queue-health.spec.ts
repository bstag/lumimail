import { expect, test, type Page } from "@playwright/test";
import { mockAuthShell } from "./shell";

async function mockOwnerShell(page: Page) {
	await mockAuthShell(page, {
		user: {
			id: "owner_1",
			email: "owner@example.com",
			name: "Owner",
			role: "owner",
		},
		mailboxes: [{
			id: "mbx_1",
			localPart: "support",
			hostname: "example.com",
			displayName: "Support",
			isPrimary: true,
			role: "manager",
		}],
	});
}

test("owner sees platform queue health and can run a fresh check", async ({ page }) => {
	await mockOwnerShell(page);
	let checked = false;
	await page.route("**/api/admin/queue-health", async (route) => {
		const responseQueues = [
			{
				queue: "inbound",
				label: "Inbound mail",
				status: checked ? "healthy" : "delayed",
				backlogCount: checked ? 0 : 1,
				backlogBytes: checked ? 0 : 120,
				oldestMessageAt: checked ? null : "2026-07-24T11:59:30.000Z",
				staleJobCount: 0,
				detail: null,
				checkedAt: checked ? "2026-07-24T12:01:00.000Z" : "2026-07-24T12:00:00.000Z",
			},
			{
				queue: "outbound",
				label: "Outbound mail",
				status: "healthy",
				backlogCount: 0,
				backlogBytes: 0,
				oldestMessageAt: null,
				staleJobCount: 0,
				detail: null,
				checkedAt: "2026-07-24T12:01:00.000Z",
			},
			{
				queue: "outbound_dlq",
				label: "Outbound dead letters",
				status: "healthy",
				backlogCount: 0,
				backlogBytes: 0,
				oldestMessageAt: null,
				staleJobCount: 0,
				detail: null,
				checkedAt: "2026-07-24T12:01:00.000Z",
			},
		];
		if (route.request().method() === "POST") checked = true;
		await route.fulfill({ json: { success: true, data: { queues: responseQueues.map((queue) => (
			queue.queue === "inbound" && checked
				? { ...queue, status: "healthy", backlogCount: 0, backlogBytes: 0, oldestMessageAt: null }
				: queue
		)) } } });
	});

	await page.goto("/queue-health");
	await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
	await expect(page.getByText("Platform-wide", { exact: false })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Inbound mail" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Outbound mail", exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Outbound dead letters" })).toBeVisible();
	await expect(page.getByText("Delayed", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Check now" }).click();
	await expect(page.getByText("Delayed", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Healthy", { exact: true })).toHaveCount(3);
});
