import { expect, test, type Page } from "@playwright/test";
import { mockShellNoise } from "./shell";

async function mockAuthenticatedShell(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "e2e-session");
	});
	await mockShellNoise(page);
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({
			json: { user: { id: "user_1", role: "owner" }, hasMailboxes: true },
		}),
	);
	await page.route("**/api/mailboxes", (route) =>
		route.fulfill({
			json: {
				mailboxes: [{
					id: "mbx_1",
					localPart: "support",
					hostname: "example.com",
					displayName: "Support",
					isPrimary: true,
					role: "manager",
				}],
			},
		}),
	);
	await page.route("**/api/messages/counts**", (route) =>
		route.fulfill({
			json: {
				inbox: 1,
				starred: 0,
				drafts: 0,
				sent: 0,
				spam: 0,
				trash: 0,
			},
		}),
	);
	await page.route("**/api/messages/msg_attachment", (route) =>
		route.fulfill({
			json: {
				message: {
					id: "msg_attachment",
					direction: "inbound",
					fromAddr: "sender@example.net",
					toAddr: "support@example.com",
					subject: "Received files",
					snippet: "Please review.",
					status: "received",
					read: true,
					starred: false,
					threadId: null,
					createdAt: "2026-07-24T12:00:00.000Z",
				},
				body: { textBody: "Please review.", htmlBody: null },
			},
		}),
	);
}

test.describe("inbound attachment presentation", () => {
	test("lists received files and previews only safe image types", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/messages/msg_attachment/attachments", (route) =>
			route.fulfill({
				json: {
					success: true,
					data: {
						attachmentStatus: "stored",
						attachmentError: null,
						attachments: [
							{ id: "a1", filename: "photo.png", contentType: "image/png", size: 4 },
							{ id: "a2", filename: "vector.svg", contentType: "image/svg+xml", size: 5 },
						],
					},
				},
			}),
		);
		await page.route("**/api/attachments/a1?disposition=inline", (route) =>
			route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from([1, 2, 3, 4]) }),
		);

		await page.goto("/inbox/msg_attachment");

		await expect(page.getByRole("link", { name: /photo\.png/ })).toBeVisible();
		await expect(page.getByRole("link", { name: /vector\.svg/ })).toBeVisible();
		await expect(page.locator('img[alt="photo.png"]')).toHaveCount(1);
		await expect(page.locator('img[alt="vector.svg"]')).toHaveCount(0);
	});

	test("shows a safe omission warning without attachment rows", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/messages/msg_attachment/attachments", (route) =>
			route.fulfill({
				json: {
					success: true,
					data: {
						attachmentStatus: "omitted",
						attachmentError:
							"Attachments were omitted because this message exceeded Lumimail's safe ingestion limits.",
						attachments: [],
					},
				},
			}),
		);

		await page.goto("/inbox/msg_attachment");

		await expect(page.getByRole("status")).toContainText(
			"Attachments were omitted because this message exceeded Lumimail's safe ingestion limits.",
		);
	});
});
