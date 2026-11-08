import { expect, test, type Page } from "@playwright/test";
import { flatCounts, mockAuthShell } from "./shell";

/**
 * Every API response is mocked; this suite verifies the client reachability path
 * only. See docs/tests/README.md.
 *
 * F101 filters at scale, F102 bulk cleanup, F103 group by sender.
 */

function message(id: string, subject: string, fromAddr = "Shop <deals@shop.test>") {
	return {
		id, mailboxId: "mbx_1", direction: "inbound", fromAddr, toAddr: "team@example.com", subject, snippet: "",
		status: "received", read: false, starred: false, threadId: null, createdAt: "2026-11-07T12:00:00.000Z",
	};
}

async function shell(page: Page) {
	await mockAuthShell(page, {
		mailboxes: [{ id: "mbx_1", address: "team@example.com", capability: "send_receive" }],
		counts: flatCounts({ inbox: 60 }),
	});
	await page.addInitScript(() => globalThis.localStorage.setItem("picket:inbox-focus", "focused"));
}

test("creates a filter from a message and applies it to existing mail (F101)", async ({ page }) => {
	await shell(page);
	const row = message("msg_deal", "Weekly deals");
	await page.route("**/api/messages/msg_deal", (route) =>
		route.fulfill({ json: { success: true, data: { message: row, body: { textBody: "Body", htmlBody: null } } } }));
	await page.route("**/api/messages/msg_deal/attachments", (route) =>
		route.fulfill({ json: { success: true, data: { attachments: [] } } }));
	let created: Record<string, unknown> | null = null;
	const filters: Array<Record<string, unknown>> = [];
	await page.route("**/api/filters", async (route) => {
		if (route.request().method() === "POST") {
			created = route.request().postDataJSON() as Record<string, unknown>;
			filters.push({ id: "filter_1", enabled: true, matchMode: "all", actionStar: false, actionMarkRead: false,
				actionMoveToTrash: false, actionLabelId: null, actionFocus: null, actionExpireDays: null, toContains: null,
				subjectContains: null, hasWords: null, actionArchive: false, ...created });
			return route.fulfill({ json: { success: true, data: { id: "filter_1" } } });
		}
		return route.fulfill({ json: { success: true, data: { filters } } });
	});
	let applied = false;
	await page.route("**/api/filters/filter_1/apply", (route) => {
		if (route.request().method() === "POST") applied = true;
		return route.fulfill({ json: { success: true, data: { matched: 37 } } });
	});

	await page.goto("/inbox/msg_deal");
	await page.getByRole("button", { name: "Filter messages like this" }).click();
	await expect(page).toHaveURL(/\/filters\?from=deals%40shop\.test$/);
	await expect(page.getByLabel("From contains")).toHaveValue("deals@shop.test");

	await page.getByLabel("Show in").selectOption("other");
	await page.getByLabel("Archive (skip inbox)").check();
	await page.getByRole("button", { name: "Create filter" }).click();
	await expect.poll(() => created).toMatchObject({ fromContains: "deals@shop.test", actionFocus: "other", actionArchive: true });

	await expect(page.getByText("37 existing messages match.")).toBeVisible();
	await page.getByRole("button", { name: "Apply to 37 messages" }).click();
	await expect(page.getByText("Applied to 37 messages.")).toBeVisible();
	expect(applied).toBe(true);
});

test("selects every message in the view and archives old mail by age (F102)", async ({ page }) => {
	await shell(page);
	const rows = Array.from({ length: 25 }, (_, index) => message(`m${index}`, `Deal ${index}`));
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({ json: { success: true, data: { messages: rows, total: 60, limit: 25, offset: 0 } } }));
	const bulk: Array<Record<string, unknown>> = [];
	await page.route("**/api/messages/bulk", async (route) => {
		const body = route.request().postDataJSON() as Record<string, unknown>;
		bulk.push(body);
		return route.fulfill({ json: { success: true, data: body.preview ? { matched: 41 } : { ok: true, updated: 41 } } });
	});

	await page.goto("/inbox");
	await page.getByRole("checkbox", { name: "Select all" }).check();
	await page.getByRole("button", { name: "Select all 60 in this view" }).click();
	await expect(page.getByText("All 60 messages in this view are selected.")).toBeVisible();
	await page.getByRole("button", { name: "Archive" }).first().click();
	await expect.poll(() => bulk.at(-1)).toEqual({
		action: "archive", query: { direction: "inbound", status: "received", mailboxId: "mbx_1", focus: "focused" },
	});

	await page.getByLabel("Clean up").selectOption("30");
	await expect(page.getByText("Archive 41 messages older than 30 days?")).toBeVisible();
	await page.getByRole("button", { name: "Archive", exact: true }).last().click();
	await expect(page.getByText("Archived 41 messages.")).toBeVisible();
	expect(bulk.at(-1)).toEqual({
		action: "archive", query: { direction: "inbound", status: "received", mailboxId: "mbx_1", focus: "focused", olderThanDays: "30" },
	});
});

test("groups the Inbox by sender and archives one sender (F103)", async ({ page }) => {
	await shell(page);
	await page.route("**/api/messages?*", (route) => {
		const sender = new URL(route.request().url()).searchParams.get("sender");
		const rows = sender ? [message("m1", "Big sale"), message("m2", "Last chance")] : [message("m1", "Big sale")];
		return route.fulfill({ json: { success: true, data: { messages: rows, total: rows.length, limit: 25, offset: 0 } } });
	});
	await page.route("**/api/messages/senders?*", (route) => route.fulfill({ json: { success: true, data: {
		total: 2,
		senders: [
			{ sender: "deals@shop.test", fromAddr: "Shop <deals@shop.test>", count: 2, unread: 2, latestId: "m1", latestSubject: "Big sale", latestAt: "2026-11-07T12:00:00.000Z" },
			{ sender: "news@paper.test", fromAddr: "Paper <news@paper.test>", count: 1, unread: 0, latestId: "m3", latestSubject: "Morning brief", latestAt: "2026-11-06T12:00:00.000Z" },
		],
	} } }));
	let bulk: Record<string, unknown> | null = null;
	await page.route("**/api/messages/bulk", async (route) => {
		bulk = route.request().postDataJSON() as Record<string, unknown>;
		return route.fulfill({ json: { success: true, data: { ok: true, updated: 2 } } });
	});

	await page.goto("/inbox");
	await page.getByLabel("Group by sender").check();
	const groups = page.getByRole("list", { name: "Group by sender" });
	await expect(groups.getByText("Morning brief")).toBeVisible();

	await groups.getByRole("button", { name: "Show messages from Shop" }).click();
	await expect(groups.getByRole("link", { name: /Last chance/ })).toBeVisible();

	await groups.getByRole("button", { name: "Archive all from Shop" }).click();
	await expect.poll(() => bulk).toEqual({
		action: "archive", query: { direction: "inbound", status: "received", mailboxId: "mbx_1", focus: "focused", sender: "deals@shop.test" },
	});
	await expect(groups.getByRole("link", { name: "Filter messages from Paper" })).toHaveAttribute("href", "/filters?from=news%40paper.test");

	await page.reload();
	await expect(page.getByLabel("Group by sender")).toBeChecked();
});
