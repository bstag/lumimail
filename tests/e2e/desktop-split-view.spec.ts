import { expect, test, type Page } from "@playwright/test";
import { flatCounts, mockAuthShell } from "./shell";

const row = {
	id: "msg_split",
	mailboxId: "mbx_1",
	direction: "inbound",
	fromAddr: '"Support Team" <support@example.net>',
	toAddr: "owner@example.com",
	subject: "Shared inbox conversation",
	snippet: "A bounded preview for the selected conversation",
	status: "received",
	read: true,
	starred: false,
	threadId: "thr_split",
	threadCount: 3,
	createdAt: "2026-08-13T20:00:00.000Z",
};

async function mockSplitInbox(page: Page) {
	await mockAuthShell(page, {
		mailboxes: [{
			id: "mbx_1",
			localPart: "owner",
			hostname: "example.com",
			displayName: "Owner",
			isPrimary: true,
			role: "manager",
		}],
		counts: flatCounts({ inbox: 1 }),
	});
	await page.route("**/api/labels", (route) =>
		route.fulfill({ json: { success: true, data: [] } }),
	);
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({ json: { success: true, data: { messages: [row], total: 1, limit: 25, offset: 0 } } }),
	);
	await page.route("**/api/messages/msg_split", (route) =>
		route.fulfill({ json: { success: true, data: {
			message: row,
			body: { textBody: "The selected message body.", htmlBody: null },
		} } }),
	);
	await page.route("**/api/messages/thread/thr_split", (route) =>
		route.fulfill({ json: { success: true, data: { messages: [] } } }),
	);
	await page.route("**/api/messages/msg_split/attachments", (route) =>
		route.fulfill({ json: { success: true, data: { attachments: [] } } }),
	);
}

test("desktop selection keeps the list and opens the reusable conversation panel", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await mockSplitInbox(page);
	await page.goto("/inbox");

	const rowLink = page.locator('[data-message-row-id="msg_split"]');
	await expect(rowLink.getByLabel("3 messages in thread")).toHaveText("3");
	await expect(rowLink.getByText("S", { exact: true })).toBeVisible();
	await rowLink.click();

	await expect(page).toHaveURL(/\/inbox\?message=msg_split$/);
	await expect(page.getByTestId("desktop-mail-split")).toBeVisible();
	await expect(rowLink).toHaveAttribute("aria-current", "true");
	await expect(page.getByRole("heading", { name: "Shared inbox conversation" })).toBeVisible();
	await expect(page.getByText("The selected message body.")).toBeVisible();
});

test("close restores the list URL and selected-row focus", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await mockSplitInbox(page);
	await page.goto("/inbox?message=msg_split");

	await page.getByRole("button", { name: "Close conversation" }).click();
	await expect(page).toHaveURL(/\/inbox$/);
	await expect(page.getByTestId("desktop-mail-split")).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-message-row-id"))).toBe("msg_split");
});

test("back, forward, and keyboard resizing retain bounded panel state", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await mockSplitInbox(page);
	await page.goto("/inbox");
	await page.locator('[data-message-row-id="msg_split"]').click();

	const separator = page.getByRole("separator", { name: "Resize conversation panel" });
	const before = Number(await separator.getAttribute("aria-valuenow"));
	await separator.press("ArrowLeft");
	await expect(separator).toHaveAttribute("aria-valuenow", String(before + 24));
	await expect.poll(() => page.evaluate(() => localStorage.getItem("lumimail:conversation-panel-width"))).toBe(String(before + 24));

	await page.goBack();
	await expect(page.getByTestId("desktop-mail-split")).toHaveCount(0);
	await page.goForward();
	await expect(page.getByTestId("desktop-mail-split")).toBeVisible();
});

test("the conversation panel can move below the list and back, persisting the choice", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await mockSplitInbox(page);
	await page.goto("/inbox?message=msg_split");

	const split = page.getByTestId("desktop-mail-split");
	await expect(split).toHaveAttribute("data-orientation", "right");

	await page.getByRole("button", { name: "Move conversation panel below the list" }).click();
	await expect(split).toHaveAttribute("data-orientation", "bottom");
	const separator = page.getByRole("separator", { name: "Resize conversation panel" });
	await expect(separator).toHaveAttribute("aria-orientation", "horizontal");
	const before = Number(await separator.getAttribute("aria-valuenow"));
	await separator.press("ArrowUp");
	await expect(separator).toHaveAttribute("aria-valuenow", String(before + 24));
	await expect.poll(() => page.evaluate(() => localStorage.getItem("lumimail:conversation-split-orientation"))).toBe("bottom");

	await page.reload();
	await expect(page.getByTestId("desktop-mail-split")).toHaveAttribute("data-orientation", "bottom");

	await page.getByRole("button", { name: "Move conversation panel beside the list" }).click();
	await expect(page.getByTestId("desktop-mail-split")).toHaveAttribute("data-orientation", "right");
	await expect(page.getByRole("separator", { name: "Resize conversation panel" })).toHaveAttribute("aria-orientation", "vertical");
});

test("mobile rows retain the full-page detail route", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockSplitInbox(page);
	await page.goto("/inbox");
	await page.locator('[data-message-row-id="msg_split"]').click();

	await expect(page).toHaveURL(/\/inbox\/msg_split$/);
	await expect(page.getByTestId("desktop-mail-split")).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "Shared inbox conversation" })).toBeVisible();
});
