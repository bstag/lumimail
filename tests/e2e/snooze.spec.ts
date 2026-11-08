import { expect, test } from "@playwright/test";
import { flatCounts, mockAuthShell } from "./shell";

/**
 * Every API response is mocked; this suite verifies the client reachability path
 * only. See docs/tests/README.md.
 *
 * F100: a received message can be snoozed from its toolbar and is listed in Snoozed.
 */

const row = {
	id: "msg_snooze",
	mailboxId: "mbx_1",
	direction: "inbound",
	fromAddr: "Ada <ada@example.net>",
	toAddr: "team@example.com",
	subject: "Contract renewal",
	snippet: "Can you look at this next week?",
	status: "received",
	read: true,
	starred: false,
	threadId: null,
	createdAt: "2026-11-07T12:00:00.000Z",
};

test("snoozes a message until tomorrow and lists it under Snoozed", async ({ page }) => {
	await mockAuthShell(page, {
		mailboxes: [{ id: "mbx_1", address: "team@example.com", capability: "send_receive" }],
		counts: flatCounts({ inbox: 1 }),
	});
	let snoozed: { until: string | null } | null = null;
	await page.route("**/api/messages?*", (route) => {
		const isSnoozedView = new URL(route.request().url()).searchParams.get("snoozed") === "true";
		const messages = isSnoozedView && snoozed ? [{ ...row, snoozedUntil: snoozed.until }] : [];
		return route.fulfill({ json: { success: true, data: { messages, total: messages.length, limit: 25, offset: 0 } } });
	});
	await page.route("**/api/messages/msg_snooze", (route) =>
		route.fulfill({ json: { success: true, data: { message: row, body: { textBody: "Body", htmlBody: null } } } }));
	await page.route("**/api/messages/msg_snooze/attachments", (route) =>
		route.fulfill({ json: { success: true, data: { attachments: [] } } }));
	await page.route("**/api/messages/msg_snooze/snooze", async (route) => {
		snoozed = route.request().postDataJSON() as { until: string | null };
		return route.fulfill({ json: { success: true, data: { snoozedUntil: snoozed.until } } });
	});

	await page.goto("/inbox/msg_snooze");
	await page.getByLabel("Snooze").selectOption("tomorrow");

	await expect(page).toHaveURL(/\/snoozed$/);
	expect(snoozed).not.toBeNull();
	const wake = new Date((snoozed as unknown as { until: string }).until);
	expect(wake.getTime()).toBeGreaterThan(Date.now());
	expect(wake.getHours()).toBe(8);
	await expect(page.getByText("Contract renewal")).toBeVisible();
	await expect(page.getByRole("link", { name: "Snoozed" })).toBeVisible();
});
