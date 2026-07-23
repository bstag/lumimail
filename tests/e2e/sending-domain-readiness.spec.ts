import { expect, test, type Page } from "@playwright/test";

async function mockAuthenticatedShell(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "e2e-session");
	});
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { id: "user_1", hasMailboxes: true } }),
	);
	await page.route("**/api/mailboxes", (route) => route.fulfill({ json: { mailboxes: [] } }));
}

test.describe("sending-domain readiness", () => {
	test("enables stale apex state and verifies provider-ready state", async ({ page }) => {
		await mockAuthenticatedShell(page);
		const domains = [
			{
				id: "dom_stale",
				hostname: "lucidkith.com",
				status: "active",
				routingEnabled: true,
				sendingEnabled: false,
				zoneId: "zone_1",
			},
			{
				id: "dom_ready",
				hostname: "henriksen.dev",
				status: "active",
				routingEnabled: true,
				sendingEnabled: true,
				zoneId: "zone_2",
			},
		];
		const actions: Array<{ id: string; action: string }> = [];

		await page.route("**/api/domains?includeDns=true", (route) =>
			route.fulfill({
				json: {
					domains,
					dns: {
						dom_stale: {
							routing: { configured: true, missing: [] },
							sending: { configured: false, records: [] },
						},
						dom_ready: {
							routing: { configured: true, missing: [] },
							sending: { configured: true, records: ["MX", "TXT"] },
						},
					},
				},
			}),
		);

		await page.route("**/api/domains/dom_stale/sending", async (route) => {
			const body = route.request().postDataJSON() as { action: string };
			actions.push({ id: "dom_stale", action: body.action });
			domains[0].sendingEnabled = true;
			await route.fulfill({
				json: {
					success: true,
					data: {
						domain: domains[0],
						dns: {
							routing: { records: [], missing: [], status: "ready" },
							sending: { enabled: true, records: [{ type: "MX" }, { type: "TXT" }] },
						},
					},
				},
			});
		});
		await page.route("**/api/domains/dom_ready/sending", async (route) => {
			const body = route.request().postDataJSON() as { action: string };
			actions.push({ id: "dom_ready", action: body.action });
			await route.fulfill({
				json: {
					success: true,
					data: {
						domain: domains[1],
						dns: {
							routing: { records: [], missing: [], status: "ready" },
							sending: { enabled: true, records: [{ type: "TXT" }] },
						},
					},
				},
			});
		});

		await page.goto("/domains");
		await expect(page.getByText("sending setup needed", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Enable sending for lucidkith.com" }).click();
		await expect.poll(() => actions).toContainEqual({ id: "dom_stale", action: "enable" });
		await expect(page.getByText("sending ready", { exact: true })).toHaveCount(2);

		await page.getByRole("button", { name: "Verify sending for henriksen.dev" }).click();
		await expect.poll(() => actions).toContainEqual({ id: "dom_ready", action: "verify" });
	});

	test("leaves setup-needed state visible when enablement fails", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/domains?includeDns=true", (route) =>
			route.fulfill({
				json: {
					domains: [
						{
							id: "dom_failed",
							hostname: "example.com",
							status: "active",
							routingEnabled: true,
							sendingEnabled: false,
							zoneId: "zone_1",
						},
					],
					dns: {},
				},
			}),
		);
		await page.route("**/api/domains/dom_failed/sending", (route) =>
			route.fulfill({
				status: 400,
				json: { success: false, error: { message: "Cloudflare could not verify Email Sending" } },
			}),
		);

		await page.goto("/domains");
		await page.getByRole("button", { name: "Enable sending for example.com" }).click();

		await expect(page.getByText("Cloudflare could not verify Email Sending")).toBeVisible();
		await expect(page.getByText("sending setup needed", { exact: true })).toBeVisible();
	});
});
