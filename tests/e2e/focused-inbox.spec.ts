import { expect, test } from "@playwright/test";
import { flatCounts, mockAuthShell } from "./shell";

/**
 * Every API response is mocked; this suite verifies the client reachability path
 * only. See docs/tests/README.md.
 *
 * F97: the Inbox is split into Focused and Other; the choice is sent to the list API
 * and remembered on this device.
 */

function message(id: string, subject: string) {
	return {
		id, mailboxId: "mbx_1", direction: "inbound", fromAddr: "Ada <ada@example.net>", toAddr: "team@example.com",
		subject, snippet: "", status: "received", read: false, starred: false, createdAt: "2026-11-07T12:00:00.000Z",
	};
}

test("switches between Focused and Other and remembers the choice", async ({ page }) => {
	await mockAuthShell(page, {
		mailboxes: [{ id: "mbx_1", address: "team@example.com", capability: "send_receive" }],
		counts: flatCounts({ inbox: 2 }),
	});
	const requested: Array<string | null> = [];
	await page.route("**/api/messages?*", (route) => {
		const focus = new URL(route.request().url()).searchParams.get("focus");
		requested.push(focus);
		const rows = focus === "other" ? [message("m_bulk", "Weekly deals")] : [message("m_person", "Lunch tomorrow?")];
		return route.fulfill({ json: { success: true, data: { messages: rows, total: 1, limit: 25, offset: 0 } } });
	});

	await page.goto("/inbox");
	await expect(page.getByRole("tab", { name: "Focused" })).toHaveAttribute("aria-selected", "true");
	await expect(page.getByText("Lunch tomorrow?")).toBeVisible();

	await page.getByRole("tab", { name: "Other" }).click();
	await expect(page.getByText("Weekly deals")).toBeVisible();
	expect(requested).toContain("other");

	await page.reload();
	await expect(page.getByRole("tab", { name: "Other" })).toHaveAttribute("aria-selected", "true");
	await expect(page.getByText("Weekly deals")).toBeVisible();
});

test("summarizes the last day of Other mail and marks it all read (F99)", async ({ page }) => {
	await mockAuthShell(page, {
		mailboxes: [{ id: "mbx_1", address: "team@example.com", capability: "send_receive" }],
		counts: flatCounts({ inbox: 3 }),
	});
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({ json: { success: true, data: { messages: [message("m_bulk", "Weekly deals")], total: 1, limit: 25, offset: 0 } } }));
	await page.route("**/api/messages/digest*", (route) => route.fulfill({ json: { success: true, data: {
		total: 3, senderCount: 2,
		senders: [
			{ sender: "deals@shop.test", fromAddr: "Shop <deals@shop.test>", count: 2, unread: 2, latestId: "m_bulk", latestSubject: "Weekly deals" },
			{ sender: "news@paper.test", fromAddr: "Paper <news@paper.test>", count: 1, unread: 1, latestId: "m_news", latestSubject: "Morning brief" },
		],
		unreadIds: ["m_bulk", "m_bulk_2", "m_news"],
	} } }));
	let bulk: Record<string, unknown> | null = null;
	await page.route("**/api/messages/bulk", async (route) => {
		bulk = route.request().postDataJSON() as Record<string, unknown>;
		return route.fulfill({ json: { success: true, data: { updated: 3 } } });
	});

	await page.goto("/inbox");
	await page.getByRole("tab", { name: "Other" }).click();
	const digest = page.getByRole("region", { name: "Last 24 hours in Other" });
	await expect(digest).toContainText("3 messages from 2 senders");
	await expect(digest.getByRole("link", { name: "Morning brief" })).toBeVisible();
	await digest.getByRole("button", { name: "Mark all read" }).click();
	await expect.poll(() => bulk).toEqual({ messageIds: ["m_bulk", "m_bulk_2", "m_news"], action: "read" });
});

