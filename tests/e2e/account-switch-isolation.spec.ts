import { expect, test } from "@playwright/test";

async function expectReactHydrated(locator: import("@playwright/test").Locator) {
	await expect.poll(() =>
		locator.evaluate((element) =>
			Object.keys(element).some((key) => key.startsWith("__reactProps$")),
		),
	).toBe(true);
}

test("clears account-scoped mailbox and message caches across logout and login", async ({ page }) => {
	await page.addInitScript(() => {
		if (!sessionStorage.getItem("account-switch-seeded")) {
			localStorage.setItem("lumimail-session-token", "token-a");
			sessionStorage.setItem("account-switch-seeded", "true");
		}
	});

	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { id: "current-user", hasMailboxes: true } }),
	);
	await page.route("**/api/auth/logout", (route) =>
		route.fulfill({ json: { ok: true } }),
	);
	await page.route("**/api/auth/login", (route) =>
		route.fulfill({ json: { token: "token-b", redirect: "/inbox" } }),
	);
	await page.route("**/api/mailboxes", (route) => {
		const accountB = route.request().headers().authorization === "Bearer token-b";
		return route.fulfill({
			json: {
				mailboxes: [{
					id: accountB ? "mbx_b" : "mbx_a",
					localPart: accountB ? "bravo" : "alpha",
					hostname: accountB ? "b.example" : "a.example",
					displayName: accountB ? "Bravo Mailbox" : "Alpha Mailbox",
					isPrimary: true,
					role: "manager",
				}],
			},
		});
	});
	await page.route("**/api/messages/counts**", (route) =>
		route.fulfill({
			json: {
				counts: {
					folders: {
						inbox: { total: 1, unread: 0 },
						sent: { total: 0, unread: 0 },
						drafts: { total: 0, unread: 0 },
						trash: { total: 0, unread: 0 },
						spam: { total: 0, unread: 0 },
						starred: { total: 0, unread: 0 },
					},
					mailboxes: [],
				},
			},
		}),
	);
	await page.route("**/api/messages?*", (route) => {
		const accountB = route.request().headers().authorization === "Bearer token-b";
		const name = accountB ? "Bravo sender" : "Alpha sender";
		return route.fulfill({
			json: {
				messages: [{
					id: accountB ? "msg_b" : "msg_a",
					mailboxId: accountB ? "mbx_b" : "mbx_a",
					direction: "inbound",
					fromAddr: `${name} <sender@example.net>`,
					toAddr: accountB ? "bravo@b.example" : "alpha@a.example",
					subject: accountB ? "Bravo private subject" : "Alpha private subject",
					snippet: "",
					status: "received",
					read: true,
					starred: false,
					createdAt: "2026-07-23T12:00:00.000Z",
				}],
				total: 1,
				limit: 25,
				offset: 0,
			},
		});
	});

	await page.goto("/inbox");
	await expect(page.getByText("Alpha private subject")).toBeVisible();
	await expect(page.getByText("alpha@a.example")).toBeVisible();

	const accountAButton = page.getByRole("button", { name: /Alpha Mailbox/i });
	await expectReactHydrated(accountAButton);
	await accountAButton.click();
	await page.getByRole("button", { name: /Log out/i }).click();
	await expect(page).toHaveURL(/\/login$/);

	await expectReactHydrated(page.locator("form"));
	await page.getByLabel("Email").fill("bravo@example.net");
	await page.getByLabel("Password").fill("not-a-real-password");
	await page.getByRole("button", { name: "Sign in" }).click();

	await expect(page).toHaveURL(/\/inbox$/);
	await expect(page.getByText("Bravo private subject")).toBeVisible();
	await expect(page.getByText("bravo@b.example")).toBeVisible();
	await expect(page.getByText("Alpha private subject")).toHaveCount(0);
	await expect(page.getByText("alpha@a.example")).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => localStorage.getItem("selected-mailbox-id"))).toBe("mbx_b");
});
