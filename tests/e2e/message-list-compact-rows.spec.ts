import { expect, test } from "@playwright/test";
import { flatCounts, mockAuthShell } from "./shell";

/**
 * Every API response is mocked; this suite verifies layout only.
 *
 * The all-mailboxes chip (F76) was added into the row's `1fr` subject track. On a
 * phone that squeezed the subject to zero width, so the list showed a sender and
 * a mailbox and nothing else — the single most important field was invisible.
 * The row is now two lines at compact widths. These pin both halves of that: the
 * subject has real width on a phone, and the layout still collapses to one line
 * on a wide viewport.
 */

const mailboxes = [
	{
		id: "mbx_a",
		localPart: "admin",
		hostname: "henriksen.dev",
		displayName: null,
		role: "manager",
		isPrimary: true,
	},
	{
		id: "mbx_b",
		localPart: "admin",
		hostname: "lucidkith.com",
		displayName: null,
		role: "manager",
	},
];

const rows = [
	{
		id: "m1",
		mailboxId: "mbx_b",
		direction: "inbound",
		fromAddr: "admin <admin@lucidkith.com>",
		toAddr: "admin@lucidkith.com",
		subject: "Plant Team Meeting Reminders",
		snippet: "Please confirm your slot before Friday",
		status: "received",
		read: false,
		starred: false,
		createdAt: "2026-07-30T15:24:00.000Z",
	},
];

async function mockInbox(page: import("@playwright/test").Page) {
	await mockAuthShell(page, { mailboxes, counts: flatCounts({ inbox: 1 }) });
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({
			json: { success: true, data: { messages: rows, total: 1, limit: 25, offset: 0 } },
		}),
	);
	await page.addInitScript(() => localStorage.setItem("mailbox-scope-all", "1"));
}

test("keeps the subject readable on a phone alongside the mailbox chip", async ({ page }) => {
	await page.setViewportSize({ width: 412, height: 915 });
	await mockInbox(page);

	await page.goto("/inbox");

	const subject = page.getByText("Plant Team Meeting Reminders");
	await expect(subject).toBeVisible();
	// Visibility alone would not have caught the regression — the element was in
	// the DOM the whole time, collapsed to nothing by its grid track.
	const box = await subject.boundingBox();
	expect(box?.width ?? 0).toBeGreaterThan(120);
	// And it must not be pushed off the right edge.
	expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(412);
});

test("puts the sender and the subject on separate lines when compact", async ({ page }) => {
	await page.setViewportSize({ width: 412, height: 915 });
	await mockInbox(page);

	await page.goto("/inbox");

	const sender = page.getByText("admin", { exact: true }).first();
	const subject = page.getByText("Plant Team Meeting Reminders");
	await expect(subject).toBeVisible();

	const senderBox = await sender.boundingBox();
	const subjectBox = await subject.boundingBox();
	expect(subjectBox?.y ?? 0).toBeGreaterThan(senderBox?.y ?? 0);
	// Same left edge: the subject aligns under the sender, not under the checkbox.
	expect(Math.abs((subjectBox?.x ?? 0) - (senderBox?.x ?? 0))).toBeLessThan(4);
});

test("shows a timestamp on the row", async ({ page }) => {
	await page.setViewportSize({ width: 412, height: 915 });
	await mockInbox(page);

	await page.goto("/inbox");

	// Same-year mail renders as month and day.
	await expect(page.locator("time")).toHaveText("Jul 30");
});

test("keeps one line per row on a wide viewport", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await mockInbox(page);

	await page.goto("/inbox");

	const sender = page.getByText("admin", { exact: true }).first();
	const subject = page.getByText("Plant Team Meeting Reminders");
	await expect(subject).toBeVisible();

	const senderBox = await sender.boundingBox();
	const subjectBox = await subject.boundingBox();
	// Vertically centred against each other rather than stacked.
	expect(Math.abs((subjectBox?.y ?? 0) - (senderBox?.y ?? 0))).toBeLessThan(8);
	expect(subjectBox?.x ?? 0).toBeGreaterThan(senderBox?.x ?? 0);
});
