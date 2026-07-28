import { expect, test, type Page } from "@playwright/test";
import { mockShellNoise } from "./shell";

const mailbox = {
	id: "mbx_1",
	localPart: "owner",
	hostname: "example.com",
	displayName: "Owner",
	isPrimary: true,
	role: "manager",
};

async function mockAuthenticatedShell(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "e2e-session");
	});
	await mockShellNoise(page);
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { user: { id: "user_1", role: "owner" }, hasMailboxes: true } }),
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
					data: {
						domain,
						dns: { routing: { records: [], missing: [] }, sending: { enabled: false, records: [] } },
					},
				},
			}),
		);

		await page.goto("/domains");
		await page.getByRole("button", { name: "DNS", exact: true }).click();

		await expect(page.getByRole("heading", { name: "DNS — example.com" })).toBeVisible();
		await expect(page.getByText('"enabled": false')).toBeVisible();
	});

	test("creates a provisioned internal group without claiming external forwarding", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/domains", (route) =>
			route.fulfill({ json: { domains: [{ id: "dom_1", hostname: "example.com" }] } }),
		);
		await page.route("**/api/admin/mailboxes", (route) =>
			route.fulfill({
				json: {
					mailboxes: [
						{ id: "mbx_1", localPart: "owner", hostname: "example.com", domainId: "dom_1" },
						{ id: "mbx_2", localPart: "support", hostname: "other.test", domainId: "dom_2" },
					],
				},
			}),
		);
		let createPayload: Record<string, unknown> | null = null;
		await page.route("**/api/aliases", async (route) => {
			if (route.request().method() === "POST") {
				createPayload = route.request().postDataJSON() as Record<string, unknown>;
				return route.fulfill({
					json: { success: true, data: { id: "alias_1", address: "team@example.com" } },
				});
			}
			return route.fulfill({ json: { success: true, data: { aliases: [] } } });
		});

		await page.goto("/aliases");
		await expect(page.getByText("Forward to external address")).toHaveCount(0);
		await page.getByLabel("Alias type").selectOption("group");
		await page.getByLabel("Local part").fill("team");
		await page.getByLabel("Domain").selectOption("dom_1");
		await page.getByLabel("owner@example.com").check();
		await page.getByLabel("support@other.test").check();
		await page.getByRole("button", { name: "Create group" }).click();

		await expect.poll(() => createPayload).not.toBeNull();
		expect(createPayload).toEqual({
			kind: "group",
			domainId: "dom_1",
			localPart: "team",
			mailboxIds: ["mbx_1", "mbx_2"],
		});
	});

	test("submits selected attachments atomically with the send request", async ({ page }) => {
		await mockAuthenticatedShell(page);
		let sendIncludedAttachment = false;
		let legacyAttachmentRequests = 0;
		await page.route("**/api/drafts", (route) =>
			route.fulfill({ json: { draft: { id: "draft_1" } } }),
		);
		await page.route("**/api/send", async (route) => {
			const body = await route.request().postDataBuffer();
			sendIncludedAttachment =
				body?.toString().includes("contract.txt") === true &&
				body.toString().includes("attachment") === true;
			return route.fulfill({
				status: 202,
				json: { success: true, data: { messageId: "msg_1", status: "queued" } },
			});
		});
		await page.route("**/api/attachments", async (route) => {
			legacyAttachmentRequests += 1;
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

		await expect.poll(() => sendIncludedAttachment).toBe(true);
		expect(legacyAttachmentRequests).toBe(0);
		await expect(page.getByText("Message queued for sending")).toBeVisible();
	});

	test("submits an internal reply source without exposing raw RFC headers", async ({ page }) => {
		await mockAuthenticatedShell(page);
		const parent = {
			id: "msg_parent",
			userId: "user_1",
			mailboxId: "mbx_1",
			direction: "inbound",
			providerMessageId: "<parent@example.net>",
			fromAddr: "Sender <sender@example.net>",
			toAddr: "owner@example.com",
			subject: "Thread contract",
			snippet: "Parent body",
			status: "received",
			read: true,
			starred: false,
			threadId: "thr_parent",
			createdAt: "2026-07-24T12:00:00.000Z",
		};
		await page.route("**/api/messages/msg_parent", (route) =>
			route.fulfill({
				json: {
					message: parent,
					body: { textBody: "Parent body", htmlBody: null },
				},
			}),
		);
		await page.route("**/api/messages/msg_parent/attachments", (route) =>
			route.fulfill({ json: { success: true, data: { attachments: [] } } }),
		);
		// The parent carries a threadId, so opening it fetches the F58 thread. Leaving
		// that unmocked let the request reach the real server, and `authFetch` treats a
		// 401 as a lost session: it cleared the token and navigated to /login, so the
		// test failed wherever the redirect happened to land. It looked intermittent
		// only because the redirect raced the assertion.
		await page.route("**/api/messages/thread/thr_parent", (route) =>
			route.fulfill({ json: { messages: [parent], total: 1 } }),
		);
		await page.route("**/api/drafts", (route) =>
			route.fulfill({ json: { draft: { id: "draft_reply" } } }),
		);
		let sentPayload: Record<string, unknown> | null = null;
		await page.route("**/api/send", async (route) => {
			sentPayload = route.request().postDataJSON() as Record<string, unknown>;
			return route.fulfill({
				status: 202,
				json: { success: true, data: { messageId: "msg_reply", status: "queued" } },
			});
		});

		await page.goto("/inbox/msg_parent");
		await page.getByRole("button", { name: "Reply", exact: true }).click();
		await expect(page).toHaveURL(/\/compose\?.*inReplyTo=msg_parent/);
		await expect(page.getByLabel("Body")).toHaveText("");
		await page.getByLabel("Body").fill("Reply body");
		await page.getByLabel("Body").press("Control+A");
		await page.getByRole("button", { name: "Bold" }).click();
		await page.locator('button[type="submit"]').click();

		await expect.poll(() => sentPayload).not.toBeNull();
		expect(sentPayload).toMatchObject({
			mailboxId: "mbx_1",
			replyToMessageId: "msg_parent",
			text: "Reply body",
			html: "<p><strong>Reply body</strong></p>",
		});
		expect(sentPayload).not.toHaveProperty("inReplyTo");
		expect(sentPayload).not.toHaveProperty("references");
		expect(sentPayload).not.toHaveProperty("threadId");
	});

	test("restores and autosaves a formatted draft without flattening it", async ({ page }) => {
		await mockAuthenticatedShell(page);
		let savedPayload: Record<string, unknown> | null = null;
		await page.route("**/api/drafts/draft_rich", async (route) => {
			if (route.request().method() === "PATCH") {
				savedPayload = route.request().postDataJSON() as Record<string, unknown>;
				return route.fulfill({ json: { draft: { id: "draft_rich" } } });
			}
			return route.fulfill({
				json: {
					draft: {
						id: "draft_rich",
						mailboxId: "mbx_1",
						fromAddr: "owner@example.com",
						toAddr: "recipient@example.net",
						subject: "Formatted draft",
						textBody: "Saved body",
						htmlBody: "<p><strong>Saved body</strong></p>",
						replySourceMessageId: null,
					},
				},
			});
		});
		await page.route("**/api/labels", (route) =>
			route.fulfill({ json: { success: true, data: [] } }),
		);
		await page.route("**/api/messages?**", (route) =>
			route.fulfill({
				json: {
					messages: [{
						id: "draft_rich",
						userId: "user_1",
						mailboxId: "mbx_1",
						direction: "outbound",
						fromAddr: "owner@example.com",
						toAddr: "recipient@example.net",
						subject: "Formatted draft",
						snippet: "Saved body",
						status: "draft",
						read: true,
						starred: false,
						threadId: null,
						createdAt: "2026-07-28T12:00:00.000Z",
					}],
					total: 1,
					limit: 25,
					offset: 0,
				},
			}),
		);

		await page.goto("/drafts");
		await page.getByText("Formatted draft").click();

		const body = page.getByLabel("Body");
		await expect(body).toHaveText("Saved body");
		await expect(body.locator("strong")).toHaveText("Saved body");
		await expect.poll(() => savedPayload).not.toBeNull();
		expect(savedPayload).toMatchObject({
			text: "Saved body",
			html: "<p><strong>Saved body</strong></p>",
		});
	});

	test("keeps the popup composer Send action above floating preference controls", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/labels", (route) =>
			route.fulfill({ json: { success: true, data: [] } }),
		);
		await page.route("**/api/messages?**", (route) =>
			route.fulfill({ json: { messages: [], total: 0, limit: 25, offset: 0 } }),
		);
		await page.route("**/api/drafts", (route) =>
			route.fulfill({ json: { draft: { id: "draft_popup" } } }),
		);
		let sendRequests = 0;
		await page.route("**/api/send", (route) => {
			sendRequests += 1;
			return route.fulfill({
				status: 202,
				json: { success: true, data: { messageId: "msg_popup", status: "queued" } },
			});
		});

		await page.goto("/inbox");
		await page.getByRole("button", { name: "Compose" }).click();
		await page.getByLabel("To", { exact: true }).fill("recipient@example.net");
		await page.getByLabel("Subject").fill("Popup layering");
		await page.getByLabel("Body").fill("The Send button remains interactive.");
		await page.locator('button[type="submit"]').click();

		await expect.poll(() => sendRequests).toBe(1);
		await expect(page.getByText("Message queued for sending")).toBeVisible();
	});

	test("shows and refreshes queued and failed outbound delivery states", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/labels", (route) =>
			route.fulfill({ json: { success: true, data: [] } }),
		);
		let messageRequestCount = 0;
		await page.route("**/api/messages?**", (route) => {
			const requestUrl = new URL(route.request().url());
			expect(requestUrl.searchParams.get("status")).toBe("queued,sent,failed");
			messageRequestCount += 1;
			const deliveryStatus = messageRequestCount === 1 ? "queued" : "sent";
			return route.fulfill({
				json: {
					messages: [
						{
							id: "msg_delivery",
							userId: "user_1",
							mailboxId: "mbx_1",
							direction: "outbound",
							providerMessageId: deliveryStatus === "sent" ? "provider_1" : null,
							fromAddr: "owner@example.com",
							toAddr: "recipient@example.net",
							subject: "Delivery state",
							snippet: "Queued body",
							status: deliveryStatus,
							read: true,
							starred: false,
							threadId: null,
							createdAt: "2026-07-24T12:00:00.000Z",
						},
						{
							id: "msg_failed",
							userId: "user_1",
							mailboxId: "mbx_1",
							direction: "outbound",
							providerMessageId: null,
							fromAddr: "owner@example.com",
							toAddr: "bad@example.net",
							subject: "Failed state",
							snippet: "Failed body",
							status: "failed",
							read: true,
							starred: false,
							threadId: null,
							createdAt: "2026-07-24T11:00:00.000Z",
						},
					],
					total: 2,
					limit: 25,
					offset: 0,
				},
			});
		});

		await page.goto("/sent");
		await expect(page.getByText("queued", { exact: true })).toBeVisible();
		await expect(page.getByText("failed", { exact: true })).toBeVisible();
		await expect.poll(() => messageRequestCount, { timeout: 8_000 }).toBeGreaterThan(1);
		await expect(page.getByText("sent", { exact: true })).toBeVisible();
	});
});
