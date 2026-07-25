import { expect, test, type Page } from "@playwright/test";

type Destination = { id: string; address: string; verified: boolean };

async function mockRoutingPage(page: Page, destinations: Destination[]) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "e2e-session");
	});
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { user: { id: "user_1", role: "owner" }, hasMailboxes: true } }),
	);
	await page.route("**/api/mailboxes", (route) =>
		route.fulfill({ json: { mailboxes: [] } }),
	);
	await page.route("**/api/messages/counts**", (route) =>
		route.fulfill({ json: { inbox: 0, starred: 0, drafts: 0, sent: 0, spam: 0, trash: 0 } }),
	);
	await page.route("**/api/domains", (route) =>
		route.fulfill({ json: { domains: [{ id: "dom_1", hostname: "example.com" }] } }),
	);
	await page.route("**/api/routing-rules", (route) => {
		if (route.request().method() === "GET") return route.fulfill({ json: { rules: [] } });
		return route.fulfill({ json: { id: "rule_1" } });
	});
	await page.route("**/api/forwarding-destinations", (route) => {
		if (route.request().method() === "GET") {
			return route.fulfill({ json: { success: true, data: destinations } });
		}
		return route.fulfill({ status: 201, json: { success: true, data: destinations[0] } });
	});
}

test.describe("external forwarding destinations", () => {
	test("refuses to offer forwarding until a destination is verified", async ({ page }) => {
		await mockRoutingPage(page, [
			{ id: "fwd_1", address: "pending@example.net", verified: false },
		]);

		await page.goto("/routing");
		await expect(page.getByText("Pending verification")).toBeVisible();

		await page.selectOption("#routing-action", "forward");

		// No selector is offered, and the reason is stated plainly.
		await expect(page.locator("select#routing-forward")).toHaveCount(0);
		await expect(
			page.getByText("Add and verify a destination below before forwarding"),
		).toBeVisible();
		await expect(page.getByText("Awaiting verification: pending@example.net")).toBeVisible();
	});

	test("offers only verified destinations once verification completes", async ({ page }) => {
		await mockRoutingPage(page, [
			{ id: "fwd_1", address: "ops@example.net", verified: true },
			{ id: "fwd_2", address: "pending@example.net", verified: false },
		]);

		await page.goto("/routing");
		await page.selectOption("#routing-action", "forward");

		const select = page.locator("select#routing-forward");
		await expect(select).toBeVisible();
		await expect(select.locator("option")).toHaveText([
			"Select a verified destination",
			"ops@example.net",
		]);
	});
});
