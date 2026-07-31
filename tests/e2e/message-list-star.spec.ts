import { expect, test } from "@playwright/test";
import { flatCounts, mockAuthShell } from "./shell";

/**
 * Every API response is mocked; this suite verifies rendering and interaction
 * only. See docs/tests/README.md.
 *
 * The list row used to render two stars: an inert folder icon in the leading
 * slot (inbox and starred both configured `icon: Star`) and the real toggle at
 * the far right. The inert one read as a broken control, so the toggle moved
 * into the leading slot and the duplicate went away. These tests pin that:
 * exactly one star per row, and it is the interactive one.
 */

const messages = [
	{
		id: "msg_unstarred",
		mailboxId: "mbx_1",
		direction: "inbound",
		fromAddr: "Ada Lovelace <ada@example.net>",
		toAddr: "team@example.com",
		subject: "Unstarred subject",
		snippet: "First preview",
		status: "received",
		read: true,
		starred: false,
		createdAt: "2026-07-23T12:00:00.000Z",
	},
	{
		id: "msg_starred",
		mailboxId: "mbx_1",
		direction: "inbound",
		fromAddr: "Grace Hopper <grace@example.net>",
		toAddr: "team@example.com",
		subject: "Starred subject",
		snippet: "Second preview",
		status: "received",
		read: true,
		starred: true,
		createdAt: "2026-07-23T11:00:00.000Z",
	},
];

test.beforeEach(async ({ page }) => {
	await mockAuthShell(page, {
		mailboxes: [{ id: "mbx_1", address: "team@example.com", capability: "send_receive" }],
		counts: flatCounts({ inbox: 2 }),
	});
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({
			json: { success: true, data: { messages, total: messages.length, limit: 25, offset: 0 } },
		}),
	);
});

test("renders exactly one star control per row, in the leading slot", async ({ page }) => {
	await page.goto("/inbox");

	await expect(page.getByText("Unstarred subject")).toBeVisible();
	await expect(page.getByRole("button", { name: "Star", exact: true })).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Unstar", exact: true })).toHaveCount(1);

	// The toggle precedes the sender rather than trailing the row.
	const row = page.locator("div", { has: page.getByRole("button", { name: "Star", exact: true }) }).last();
	const order = await row.evaluate((element) =>
		Array.from(element.children).map((child) => child.tagName.toLowerCase()),
	);
	expect(order.slice(0, 2)).toEqual(["input", "button"]);
	await expect(row.getByText("Ada Lovelace")).toBeVisible();
});

test("toggles the star from the leading slot without opening the message", async ({ page }) => {
	let patched: { id: string; body: unknown } | null = null;
	await page.route("**/api/messages/*/starred", async (route) => {
		const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
		patched = { id, body: route.request().postDataJSON() as unknown };
		return route.fulfill({ json: { success: true, data: { starred: true } } });
	});

	await page.goto("/inbox");
	await page.getByRole("button", { name: "Star", exact: true }).click();

	await expect.poll(() => patched).toEqual({ id: "msg_unstarred", body: { starred: true } });
	await expect(page).toHaveURL(/\/inbox$/);
	// Optimistic update flips the label in place.
	await expect(page.getByRole("button", { name: "Unstar", exact: true })).toHaveCount(2);
});
