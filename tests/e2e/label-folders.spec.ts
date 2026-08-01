import { expect, test } from "@playwright/test";
import { flatCounts, mockAuthShell } from "./shell";

/**
 * Every API response is mocked; this suite verifies rendering and navigation
 * only. See docs/tests/README.md.
 *
 * F75: labels existed as data (filters could file into them) with no way to open
 * one. These cover the browse path — the sidebar tree, the label list, the empty
 * state, and a label id the caller cannot read.
 */

const labels = [
	{ id: "lbl_clients", name: "Clients", color: "#6366f1", parentId: null },
	{ id: "lbl_acme", name: "Acme", color: "#10b981", parentId: "lbl_clients" },
	{ id: "lbl_northline", name: "Northline", color: "#f59e0b", parentId: "lbl_clients" },
	{ id: "lbl_invoices", name: "Invoices", color: "#ec4899", parentId: null },
];

const acmeMessages = [
	{
		id: "msg_acme",
		mailboxId: "mbx_1",
		direction: "inbound",
		fromAddr: "Ada Lovelace <ada@acme.example>",
		toAddr: "team@example.com",
		subject: "Acme renewal",
		snippet: "Filed by the Acme filter",
		status: "received",
		read: true,
		starred: false,
		createdAt: "2026-07-23T12:00:00.000Z",
	},
];

async function mockShell(
	page: import("@playwright/test").Page,
	labelPayload: unknown[] = labels,
) {
	await mockAuthShell(page, {
		mailboxes: [{ id: "mbx_1", address: "team@example.com", capability: "send_receive" }],
		counts: flatCounts({ inbox: 1 }),
	});
	// Registered after mockAuthShell so it overrides mockShellNoise's empty list.
	await page.route("**/api/labels", (route) =>
		route.fulfill({ json: { success: true, data: labelPayload } }),
	);
}

test("renders labels as a one-level tree in the sidebar", async ({ page }) => {
	await mockShell(page);
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({ json: { success: true, data: { messages: [], total: 0, limit: 25, offset: 0 } } }),
	);

	await page.goto("/inbox");

	const nav = page.locator("nav").first();
	await expect(nav.getByRole("link", { name: "Clients", exact: true })).toBeVisible();
	await expect(nav.getByRole("link", { name: "Acme", exact: true })).toBeVisible();
	await expect(nav.getByRole("link", { name: "Invoices", exact: true })).toBeVisible();

	// Children sort under their parent; top level sorts by name, so Clients
	// (with its two children) precedes Invoices.
	const labelNames = await nav
		.locator('a[href^="/label/"]')
		.evaluateAll((links) => links.map((link) => link.textContent?.trim()));
	expect(labelNames).toEqual(["Clients", "Acme", "Northline", "Invoices"]);
});

test("opens a label and lists only that label's mail", async ({ page }) => {
	await mockShell(page);
	// Mutating a const object rather than reassigning a `let`: TypeScript narrows
	// a closure-assigned `let` to its initializer type at the assertion site.
	const requested: { labelId?: string | null; status?: string | null } = {};
	await page.route("**/api/messages?*", (route) => {
		const params = new URL(route.request().url()).searchParams;
		requested.labelId = params.get("labelId");
		requested.status = params.get("status");
		return route.fulfill({
			json: { success: true, data: { messages: acmeMessages, total: 1, limit: 25, offset: 0 } },
		});
	});

	await page.goto("/inbox");
	await page.locator("nav").first().getByRole("link", { name: "Acme", exact: true }).click();

	await expect(page).toHaveURL(/\/label\/lbl_acme$/);
	await expect(page.getByText("Acme renewal")).toBeVisible();
	await expect(page.getByRole("heading", { name: "Acme" })).toBeVisible();
	expect(requested.labelId).toBe("lbl_acme");
	// Trashed and spam mail stays out of a filing destination.
	expect(requested.status?.split(",")).not.toContain("trash");
	expect(requested.status?.split(",")).not.toContain("spam");
});

test("shows the empty state for a label with no mail", async ({ page }) => {
	await mockShell(page);
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({ json: { success: true, data: { messages: [], total: 0, limit: 25, offset: 0 } } }),
	);

	await page.goto("/label/lbl_invoices");

	await expect(page.getByText("No messages with this label")).toBeVisible();
});

test("renders an unreadable label id as empty rather than erroring", async ({ page }) => {
	// A label belonging to another user is absent from /api/labels, and the
	// messages query is scoped by messageAccessCondition, so it yields no rows.
	await mockShell(page);
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({ json: { success: true, data: { messages: [], total: 0, limit: 25, offset: 0 } } }),
	);

	await page.goto("/label/lbl_someone_else");

	await expect(page.getByText("No messages with this label")).toBeVisible();
	// No label name is claimed for an id the user cannot resolve.
	await expect(page.getByRole("heading")).toHaveCount(0);
});

test("hides the label tree when the user has no labels", async ({ page }) => {
	await mockShell(page, []);
	await page.route("**/api/messages?*", (route) =>
		route.fulfill({ json: { success: true, data: { messages: [], total: 0, limit: 25, offset: 0 } } }),
	);

	await page.goto("/inbox");

	await expect(page.locator("nav").first().locator('a[href^="/label/"]')).toHaveCount(0);
	// The manage entry stays regardless.
	await expect(page.getByRole("link", { name: "Labels" })).toBeVisible();
});
