import { expect, test, type Page } from "@playwright/test";
import { mockShellNoise } from "./shell";

const sendCapableMailbox = {
	id: "mbx_1",
	localPart: "owner",
	hostname: "example.com",
	displayName: "Owner",
	isPrimary: true,
	role: "manager",
};

const viewerMailbox = { ...sendCapableMailbox, role: "viewer" };

const failedMessage = {
	id: "msg_failed",
	direction: "outbound",
	fromAddr: "owner@example.com",
	toAddr: "recipient@example.net",
	subject: "Delivery failed",
	snippet: "Body",
	status: "failed",
	read: true,
	starred: false,
	threadId: null,
	createdAt: "2026-07-24T12:00:00.000Z",
};

async function mockSentFolder(page: Page, mailbox: Record<string, unknown>) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "e2e-session");
	});
	await mockShellNoise(page);
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { user: { id: "user_1", role: "owner" }, hasMailboxes: true } }),
	);
	await page.route("**/api/mailboxes", (route) => route.fulfill({ json: { mailboxes: [mailbox] } }));
	await page.route("**/api/messages/counts**", (route) =>
		route.fulfill({ json: { inbox: 0, starred: 0, drafts: 0, sent: 1, spam: 0, trash: 0 } }),
	);
	await page.route("**/api/labels", (route) => route.fulfill({ json: { success: true, data: [] } }));
	await page.route("**/api/messages?**", (route) =>
		route.fulfill({ json: { messages: [failedMessage], total: 1, limit: 25, offset: 0 } }),
	);
}

test.describe("operator-confirmed outbound recovery", () => {
	test("requires confirmation before returning a failed message to the queue", async ({ page }) => {
		await mockSentFolder(page, sendCapableMailbox);
		let retryRequests = 0;
		await page.route("**/api/messages/msg_failed/retry", (route) => {
			retryRequests += 1;
			return route.fulfill({
				status: 202,
				json: { success: true, data: { messageId: "msg_failed", status: "queued" } },
			});
		});

		await page.goto("/sent");
		const retry = page.getByRole("button", { name: "Retry delivery" });
		await expect(retry).toBeVisible();

		// Dismissing the confirmation must not send the request.
		page.once("dialog", (dialog) => dialog.dismiss());
		await retry.click();
		await expect.poll(() => retryRequests).toBe(0);

		// Accepting it does, and the disclosure names the recipient.
		let dialogMessage = "";
		page.once("dialog", (dialog) => {
			dialogMessage = dialog.message();
			return dialog.accept();
		});
		await retry.click();
		await expect.poll(() => retryRequests).toBe(1);
		expect(dialogMessage).toContain("recipient@example.net");
		expect(dialogMessage).toContain("twice");
	});

	test("hides recovery from a viewer-capability user", async ({ page }) => {
		await mockSentFolder(page, viewerMailbox);

		await page.goto("/sent");
		await expect(page.getByText("Delivery failed")).toBeVisible();
		await expect(page.getByRole("button", { name: "Retry delivery" })).toHaveCount(0);
	});
});
