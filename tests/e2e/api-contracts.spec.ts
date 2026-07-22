import { expect, test, type Page } from "@playwright/test";

const mailbox = {
	id: "mbx_1",
	localPart: "owner",
	hostname: "example.com",
	displayName: "Owner",
	isPrimary: true,
};

async function mockAuthenticatedShell(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "e2e-session");
	});
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { id: "user_1", hasMailboxes: true } }),
	);
	await page.route("**/api/mailboxes", (route) =>
		route.fulfill({ json: { mailboxes: [mailbox] } }),
	);
	await page.route("**/api/messages/counts**", (route) =>
		route.fulfill({ json: { inbox: 0, starred: 0, drafts: 0, sent: 0, spam: 0, trash: 0 } }),
	);
}

test.describe("canonical API client contracts", () => {
	test("sanitizes hostile stored HTML in the single-message render path", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/messages/msg_hostile", (route) =>
			route.fulfill({
				json: {
					message: {
						id: "msg_hostile",
						direction: "inbound",
						fromAddr: "sender@example.net",
						toAddr: "owner@example.com",
						subject: "Sanitizer check",
						snippet: "Safe body",
						status: "received",
						read: true,
						starred: false,
						threadId: null,
						createdAt: "2026-07-22T12:00:00.000Z",
					},
					body: {
						textBody: null,
						htmlBody:
							'<p style="color:red" onclick="window.__mailXss=true">Safe body<script>window.__mailXss=true</script><img src="https://track.example/pixel"><a href="javascript:window.__mailXss=true">unsafe</a><a href="https://example.com">safe link</a></p>',
					},
				},
			}),
		);
		await page.route("**/api/messages/msg_hostile/attachments", (route) =>
			route.fulfill({ json: { success: true, data: { attachments: [] } } }),
		);

		await page.goto("/inbox/msg_hostile");

		const article = page.locator("article");
		await expect(article.getByText("Safe body", { exact: false })).toBeVisible();
		await expect(article.locator("script, img, iframe, form, [onclick], [style]")).toHaveCount(0);
		await expect(article.locator("a", { hasText: "unsafe" })).not.toHaveAttribute("href");
		await expect(article.locator("a", { hasText: "safe link" })).toHaveAttribute("href", "https://example.com");
		await expect.poll(() => page.evaluate(() => (window as Window & { __mailXss?: boolean }).__mailXss)).toBeUndefined();
	});

	test("shows labels returned as the canonical label array on the filters page", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/filters", (route) =>
			route.fulfill({ json: { success: true, data: { filters: [] } } }),
		);
		await page.route("**/api/labels", (route) =>
			route.fulfill({
				json: {
					success: true,
					data: [{ id: "label_1", name: "Finance", color: "#000000" }],
				},
			}),
		);

		await page.goto("/filters");

		await expect(page.getByRole("option", { name: "Finance" })).toHaveCount(1);
		await expect(page.getByRole("main").getByRole("combobox")).toContainText("Finance");
	});

	test("renders canonical domain DNS details", async ({ page }) => {
		await mockAuthenticatedShell(page);
		const domain = {
			id: "dom_1",
			hostname: "example.com",
			status: "active",
			routingEnabled: true,
			sendingEnabled: false,
			zoneId: "zone_1",
		};
		await page.route("**/api/domains?includeDns=true", (route) =>
			route.fulfill({ json: { domains: [domain], dns: {} } }),
		);
		await page.route("**/api/domains/dom_1/dns", (route) =>
			route.fulfill({
				json: {
					success: true,
					data: { domain, dns: { routing: { records: [], missing: [] }, sending: [] } },
				},
			}),
		);

		await page.goto("/domains");
		await page.getByRole("button", { name: "DNS", exact: true }).click();

		await expect(page.getByRole("heading", { name: "DNS — example.com" })).toBeVisible();
		await expect(page.getByText('"records": []')).toBeVisible();
	});

	test("uploads selected attachments with the canonical send message id", async ({ page }) => {
		await mockAuthenticatedShell(page);
		let uploadedMessageId: string | null = null;
		await page.route("**/api/drafts", (route) =>
			route.fulfill({ json: { draft: { id: "draft_1" } } }),
		);
		await page.route("**/api/send", (route) =>
			route.fulfill({ json: { success: true, data: { messageId: "msg_1" } } }),
		);
		await page.route("**/api/attachments", async (route) => {
			const body = await route.request().postDataBuffer();
			uploadedMessageId = body?.toString().includes("msg_1") ? "msg_1" : null;
			await route.fulfill({ json: { success: true, data: { id: "att_1" } } });
		});

		await page.goto("/compose");
		await page.getByLabel("To", { exact: true }).fill("recipient@example.net");
		await page.getByLabel("Subject").fill("Contract test");
		await page.getByLabel("Body").fill("Test body");
		await page.getByLabel("Attach files").setInputFiles({
			name: "contract.txt",
			mimeType: "text/plain",
			buffer: Buffer.from("attachment"),
		});
		await page.locator('button[type="submit"]').click();

		await expect.poll(() => uploadedMessageId).toBe("msg_1");
	});
});
