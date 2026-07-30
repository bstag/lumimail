import { expect, test, type Page } from "@playwright/test";
import { mockAuthShell } from "./shell";

async function mockAuthenticatedShell(page: Page) {
	// Each test installs its own /api/mailboxes payload, so leave that route
	// unregistered here (`mailboxes: null`).
	await mockAuthShell(page, { mailboxes: null });
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
		// `/routing` always loads its forwarding destinations. Left unmocked, that
		// request reaches the real server, and `authFetch` treats the 401 as a lost
		// session — so the page navigates to /login before the conflict can render.
		await page.route("**/api/forwarding-destinations", (route) =>
			route.fulfill({ json: { success: true, data: [] } }),
		);
		await page.route("**/api/routing-rules", async (route) => {
			if (route.request().method() === "POST") {
				posted = route.request().postDataJSON() as Record<string, unknown>;
				rules.push({ id: "r1", ...posted, pattern: "*" });
				await route.fulfill({ json: { success: true, data: rules[0] } });
				return;
			}
			await route.fulfill({ json: { success: true, data: { rules } } });
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

	test("declining the catch-all removal confirmation does not run the delete mutation", async ({ page }) => {
		await mockAuthenticatedShell(page);
		let deleteCount = 0;
		let listCount = 0;
		await page.route("**/api/domains", (route) => route.fulfill({ json: { domains: [{ id: "d1", hostname: "lucidkith.com" }] } }));
		await page.route("**/api/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "m1", localPart: "admin", domainId: "d1", displayName: null }] } }));
		await page.route("**/api/forwarding-destinations", (route) =>
			route.fulfill({ json: { success: true, data: [] } }),
		);
		await page.route("**/api/routing-rules/r1", async (route) => {
			deleteCount += 1;
			await route.fulfill({ json: { success: true, data: { ok: true } } });
		});
		await page.route("**/api/routing-rules", async (route) => {
			listCount += 1;
			await route.fulfill({ json: { success: true, data: { rules: [
				{ id: "r1", domainId: "d1", pattern: "*", action: "store", mailboxId: "m1", priority: 100 },
			] } } });
		});

		page.on("dialog", (dialog) => dialog.dismiss());
		await page.goto("/routing");
		await expect(page.getByRole("listitem").getByText("*", { exact: true })).toBeVisible();
		const listCountAfterLoad = listCount;

		await page.getByRole("button", { name: "Remove * rule for lucidkith.com" }).click();
		// Declining must leave the mutation un-run: no DELETE, and no
		// success-driven cache invalidation refetching the list.
		await page.waitForTimeout(500);
		expect(deleteCount).toBe(0);
		expect(listCount).toBe(listCountAfterLoad);
		await expect(page.getByRole("listitem").getByText("*", { exact: true })).toBeVisible();
	});

	test("accepting the catch-all removal confirmation deletes the rule", async ({ page }) => {
		await mockAuthenticatedShell(page);
		let deleted = false;
		await page.route("**/api/domains", (route) => route.fulfill({ json: { domains: [{ id: "d1", hostname: "lucidkith.com" }] } }));
		await page.route("**/api/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "m1", localPart: "admin", domainId: "d1", displayName: null }] } }));
		await page.route("**/api/forwarding-destinations", (route) =>
			route.fulfill({ json: { success: true, data: [] } }),
		);
		await page.route("**/api/routing-rules/r1", async (route) => {
			deleted = true;
			await route.fulfill({ json: { success: true, data: { ok: true } } });
		});
		await page.route("**/api/routing-rules", async (route) => {
			await route.fulfill({ json: { success: true, data: { rules: deleted ? [] : [
				{ id: "r1", domainId: "d1", pattern: "*", action: "store", mailboxId: "m1", priority: 100 },
			] } } });
		});

		page.on("dialog", (dialog) => dialog.accept());
		await page.goto("/routing");
		await expect(page.getByRole("listitem").getByText("*", { exact: true })).toBeVisible();

		await page.getByRole("button", { name: "Remove * rule for lucidkith.com" }).click();
		await expect.poll(() => deleted).toBe(true);
		await expect(page.getByText("No routing rules yet.")).toBeVisible();
	});

	test("shows a provider conflict without adding a catch-all", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/domains", (route) => route.fulfill({ json: { domains: [{ id: "d1", hostname: "lucidkith.com" }] } }));
		await page.route("**/api/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "m1", localPart: "admin", domainId: "d1", displayName: null }] } }));
		// `/routing` always loads its forwarding destinations. Left unmocked, that
		// request reaches the real server, and `authFetch` treats the 401 as a lost
		// session — so the page navigates to /login before the conflict can render.
		await page.route("**/api/forwarding-destinations", (route) =>
			route.fulfill({ json: { success: true, data: [] } }),
		);
		await page.route("**/api/routing-rules", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({ status: 409, json: { success: false, error: { message: "Cloudflare catch-all is already used by another destination" } } });
				return;
			}
			await route.fulfill({ json: { success: true, data: { rules: [] } } });
		});

		await page.goto("/routing");
		await page.getByLabel("Domain").selectOption("d1");
		await page.getByLabel("Target mailbox").selectOption("m1");
		await page.getByRole("button", { name: "Enable catch-all and add rule" }).click();
		await expect(page.getByText("Cloudflare catch-all is already used by another destination")).toBeVisible();
		await expect(page.getByText("No routing rules yet.")).toBeVisible();
	});
});
