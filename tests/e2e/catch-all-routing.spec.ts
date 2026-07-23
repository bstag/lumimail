import { expect, test, type Page } from "@playwright/test";

async function mockAuthenticatedShell(page: Page) {
	await page.addInitScript(() => localStorage.setItem("lumimail-session-token", "e2e-session"));
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { user: { id: "user_1", role: "owner" }, hasMailboxes: true } }),
	);
}

test.describe("domain catch-all routing", () => {
	test("creates a canonical catch-all with only same-domain mailbox targets", async ({ page }) => {
		await mockAuthenticatedShell(page);
		const rules: Array<Record<string, unknown>> = [];
		let posted: Record<string, unknown> | null = null;
		await page.route("**/api/domains", (route) => route.fulfill({ json: { domains: [
			{ id: "d1", hostname: "lucidkith.com" },
			{ id: "d2", hostname: "henriksen.dev" },
		] } }));
		await page.route("**/api/mailboxes", (route) => route.fulfill({ json: { mailboxes: [
			{ id: "m1", localPart: "admin", domainId: "d1", displayName: null },
			{ id: "m2", localPart: "owner", domainId: "d2", displayName: null },
		] } }));
		await page.route("**/api/routing-rules", async (route) => {
			if (route.request().method() === "POST") {
				posted = route.request().postDataJSON() as Record<string, unknown>;
				rules.push({ id: "r1", ...posted, pattern: "*" });
				await route.fulfill({ json: rules[0] });
				return;
			}
			await route.fulfill({ json: { rules } });
		});

		await page.goto("/routing");
		await page.getByLabel("Domain").selectOption("d1");
		await expect(page.getByLabel("Target mailbox").getByRole("option")).toHaveCount(2);
		await expect(page.getByLabel("Target mailbox").getByText("owner@henriksen.dev")).toHaveCount(0);
		await page.getByLabel("Pattern").fill("*@lucidkith.com");
		await page.getByLabel("Target mailbox").selectOption("m1");
		await page.getByRole("button", { name: "Enable catch-all and add rule" }).click();

		await expect.poll(() => posted).toMatchObject({ domainId: "d1", pattern: "*@lucidkith.com", mailboxId: "m1" });
		await expect(page.getByRole("listitem").getByText("*", { exact: true })).toBeVisible();
	});

	test("shows a provider conflict without adding a catch-all", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/domains", (route) => route.fulfill({ json: { domains: [{ id: "d1", hostname: "lucidkith.com" }] } }));
		await page.route("**/api/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "m1", localPart: "admin", domainId: "d1", displayName: null }] } }));
		await page.route("**/api/routing-rules", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({ status: 409, json: { error: "Cloudflare catch-all is already used by another destination" } });
				return;
			}
			await route.fulfill({ json: { rules: [] } });
		});

		await page.goto("/routing");
		await page.getByLabel("Domain").selectOption("d1");
		await page.getByLabel("Target mailbox").selectOption("m1");
		await page.getByRole("button", { name: "Enable catch-all and add rule" }).click();
		await expect(page.getByText("Cloudflare catch-all is already used by another destination")).toBeVisible();
		await expect(page.getByText("No routing rules yet.")).toBeVisible();
	});
});
