import { expect, test } from "@playwright/test";
import { flatCounts, mockAuthShell } from "./shell";

/**
 * Every API response is mocked; this suite verifies the client reachability path
 * only. See docs/tests/README.md.
 *
 * F04 (2026-07-31): archiving wrote `status = "archived"` from three controls and
 * nothing read it back, so archived mail left the product. These cover the read
 * path end to end — the nav entry, the list, the empty state, and the way back.
 */

const archivedMessages = [
	{
		id: "msg_archived_in",
		mailboxId: "mbx_1",
		direction: "inbound",
		fromAddr: "Ada Lovelace <ada@example.net>",
		toAddr: "team@example.com",
		subject: "Filed inbound thread",
		snippet: "Archived by a filter",
		status: "archived",
		read: true,
		starred: false,
		createdAt: "2026-07-23T12:00:00.000Z",
	},
	{
		id: "msg_archived_out",
		mailboxId: "mbx_1",
		direction: "outbound",
		fromAddr: "team@example.com",
		toAddr: "Grace Hopper <grace@example.net>",
		subject: "Filed outbound reply",
		snippet: "Archived by hand",
		status: "archived",
		read: true,
		starred: false,
		createdAt: "2026-07-23T11:00:00.000Z",
	},
];

async function mockShell(page: import("@playwright/test").Page) {
	await mockAuthShell(page, {
		mailboxes: [{ id: "mbx_1", address: "team@example.com", capability: "send_receive" }],
		counts: flatCounts({ inbox: 0 }),
	});
}

test("reaches the archive from the sidebar and lists both directions", async ({ page }) => {
	await mockShell(page);
	let requestedStatus: string | null = null;
	await page.route("**/api/messages?*", (route) => {
		requestedStatus = new URL(route.request().url()).searchParams.get("status");
		return route.fulfill({
			json: {
				success: true,
				data: { messages: archivedMessages, total: 2, limit: 25, offset: 0 },
			},
		});
	});

	await page.goto("/inbox");
	await page.getByRole("link", { name: "Archive" }).click();

	await expect(page).toHaveURL(/\/archive$/);
	await expect(page.getByText("Filed inbound thread")).toBeVisible();
	await expect(page.getByText("Filed outbound reply")).toBeVisible();
	expect(requestedStatus).toBe("archived");
});

test("shows the archive empty state when nothing is filed", async ({ page }) => {
	await mockShell(page);
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({ json: { success: true, data: { messages: [], total: 0, limit: 25, offset: 0 } } }),
	);

	await page.goto("/archive");

	await expect(page.getByText("No archived emails")).toBeVisible();
});

test("moves an archived message back to the inbox", async ({ page }) => {
	await mockShell(page);
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({
			json: { success: true, data: { messages: archivedMessages, total: 2, limit: 25, offset: 0 } },
		}),
	);
	let bulkPayload: Record<string, unknown> | null = null;
	await page.route("**/api/messages/bulk", async (route) => {
		bulkPayload = route.request().postDataJSON() as Record<string, unknown>;
		return route.fulfill({ json: { success: true, data: { updated: 1 } } });
	});

	await page.goto("/archive");
	await page.getByRole("checkbox", { name: "Select message" }).first().check();
	await page.getByLabel("Move message").selectOption("inbox");

	await expect.poll(() => bulkPayload).toMatchObject({
		messageIds: ["msg_archived_in"],
		action: "inbox",
	});
});
