import { expect, test } from "@playwright/test";
import { flatCounts, mockAuthShell } from "./shell";

/**
 * Every API response is mocked; this suite verifies the client scope control.
 * See docs/tests/README.md. Real cross-tenant isolation is the server's, proven
 * by messageAccessCondition and its route tests — a mock cannot prove it.
 *
 * F76: /api/messages already listed across every accessible mailbox when
 * `mailboxId` was omitted. These cover the control that lets a user ask for it.
 */

// Shape must match what `fetchMailboxOptions` reads: localPart/hostname/role,
// not the address/capability shorthand some older specs pass.
const twoMailboxes = [
	{
		id: "mbx_me",
		localPart: "me",
		hostname: "example.com",
		displayName: null,
		role: "manager",
		isPrimary: true,
	},
	{
		id: "mbx_support",
		localPart: "support",
		hostname: "example.com",
		displayName: null,
		role: "manager",
	},
];

const messages = [
	{
		id: "msg_mine",
		mailboxId: "mbx_me",
		direction: "inbound",
		fromAddr: "Ada Lovelace <ada@example.net>",
		toAddr: "me@example.com",
		subject: "Personal thread",
		snippet: "To my own mailbox",
		status: "received",
		read: true,
		starred: false,
		createdAt: "2026-07-23T12:00:00.000Z",
	},
	{
		id: "msg_support",
		mailboxId: "mbx_support",
		direction: "inbound",
		fromAddr: "Grace Hopper <grace@example.net>",
		toAddr: "support@example.com",
		subject: "Shared thread",
		snippet: "To the shared mailbox",
		status: "received",
		read: true,
		starred: false,
		createdAt: "2026-07-23T11:00:00.000Z",
	},
];

/** Serves only the rows matching the requested scope, as the API would. */
async function mockScopedMessages(
	page: import("@playwright/test").Page,
	seen: { mailboxId?: string | null }[],
) {
	await page.route("**/api/messages?*", (route) => {
		const mailboxId = new URL(route.request().url()).searchParams.get("mailboxId");
		seen.push({ mailboxId });
		const rows = mailboxId ? messages.filter((m) => m.mailboxId === mailboxId) : messages;
		return route.fulfill({
			json: { success: true, data: { messages: rows, total: rows.length, limit: 25, offset: 0 } },
		});
	});
}

test("lists every mailbox once All mailboxes is selected", async ({ page }) => {
	await mockAuthShell(page, { mailboxes: twoMailboxes, counts: flatCounts({ inbox: 2 }) });
	const seen: { mailboxId?: string | null }[] = [];
	await mockScopedMessages(page, seen);

	await page.goto("/inbox");
	// Starts scoped to the primary mailbox.
	await expect(page.getByText("Personal thread")).toBeVisible();
	await expect(page.getByText("Shared thread")).toHaveCount(0);

	await page.getByRole("button", { name: /me@example\.com|All mailboxes/ }).first().click();
	await page.getByRole("button", { name: /All mailboxes/ }).click();

	await expect(page.getByText("Personal thread")).toBeVisible();
	await expect(page.getByText("Shared thread")).toBeVisible();
	expect(seen.at(-1)?.mailboxId).toBeNull();
});

test("labels each row with its mailbox only while the scope is active", async ({ page }) => {
	await mockAuthShell(page, { mailboxes: twoMailboxes, counts: flatCounts({ inbox: 2 }) });
	await mockScopedMessages(page, []);

	await page.goto("/inbox");
	// Scoped: the mailbox is the same on every row, so it is not repeated.
	await expect(page.getByText("support@example.com", { exact: true })).toHaveCount(0);

	await page.getByRole("button", { name: /me@example\.com|All mailboxes/ }).first().click();
	await page.getByRole("button", { name: /All mailboxes/ }).click();

	await expect(page.getByText("support@example.com", { exact: true })).toBeVisible();
	await expect(page.getByText("me@example.com", { exact: true }).first()).toBeVisible();
});

test("keeps the scope across a reload", async ({ page }) => {
	await mockAuthShell(page, { mailboxes: twoMailboxes, counts: flatCounts({ inbox: 2 }) });
	const seen: { mailboxId?: string | null }[] = [];
	await mockScopedMessages(page, seen);

	await page.goto("/inbox");
	await page.getByRole("button", { name: /me@example\.com|All mailboxes/ }).first().click();
	await page.getByRole("button", { name: /All mailboxes/ }).click();
	await expect(page.getByText("Shared thread")).toBeVisible();

	await page.reload();

	// The provider replaces a null selection with the primary mailbox on every
	// mailbox-list load, so a scope stored as "no selection" would not survive.
	await expect(page.getByText("Shared thread")).toBeVisible();
	await expect(page.getByText("Personal thread")).toBeVisible();
	expect(seen.at(-1)?.mailboxId).toBeNull();
});

test("does not offer the scope to a single-mailbox user", async ({ page }) => {
	await mockAuthShell(page, {
		mailboxes: [twoMailboxes[0]],
		counts: flatCounts({ inbox: 1 }),
	});
	await mockScopedMessages(page, []);

	await page.goto("/inbox");
	await page.getByRole("button", { name: /me@example\.com|All mailboxes/ }).first().click();

	// One mailbox makes the entry a no-op.
	await expect(page.getByRole("button", { name: /All mailboxes/ })).toHaveCount(0);
	// The mailbox itself is still listed.
	await expect(page.getByText("me@example.com").first()).toBeVisible();
});

test("replies from the mailbox that received the message", async ({ page }) => {
	await mockAuthShell(page, { mailboxes: twoMailboxes, counts: flatCounts({ inbox: 2 }) });
	await mockScopedMessages(page, []);
	await page.route("**/api/messages/msg_support", (route) =>
		route.fulfill({
			json: {
				success: true,
				data: {
					message: messages[1],
					body: { textBody: "Shared body", htmlBody: null },
				},
			},
		}),
	);
	await page.route("**/api/messages/msg_support/attachments", (route) =>
		route.fulfill({ json: { success: true, data: { attachments: [] } } }),
	);

	await page.goto("/inbox/msg_support");
	await page.getByRole("button", { name: "Reply", exact: true }).click();

	// Not the primary mailbox: replying to shared-mailbox mail under the
	// individual's own address would be the wrong sender.
	await expect(page).toHaveURL(/fromMailboxId=mbx_support/);
});
