import { expect, test, type Page } from "@playwright/test";

async function mockAuthenticatedShell(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem("lumimail-session-token", "e2e-session");
	});
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { id: "user_1", hasMailboxes: true } }),
	);
	await page.route("**/api/mailboxes", (route) =>
		route.fulfill({
			json: {
				mailboxes: [
					{
						id: "mbx_1",
						localPart: "owner",
						hostname: "example.com",
						displayName: "Owner",
						isPrimary: true,
						role: "manager",
					},
				],
			},
		}),
	);
	await page.route("**/api/messages/counts**", (route) =>
		route.fulfill({
			json: { inbox: 0, starred: 0, drafts: 0, sent: 0, spam: 0, trash: 0 },
		}),
	);
}

test.describe("API key lifecycle", () => {
	test("creates a one-time secret and permanently revokes an active key", async ({ page }) => {
		await mockAuthenticatedShell(page);
		const secret = "lumi_test_secret_visible_once";
		const keys = [
			{
				id: "key_1",
				name: "Production app",
				prefix: "lumi_active1",
				scopes: '["send","read"]',
				createdAt: "2026-07-20T12:00:00.000Z",
				lastUsedAt: "2026-07-22T12:30:00.000Z" as string | null,
				revokedAt: null as string | null,
			},
		];
		let revokeCalls = 0;

		await page.route("**/api/api-keys", async (route) => {
			if (route.request().method() === "POST") {
				keys.push({
					id: "key_2",
					name: "CLI",
					prefix: "lumi_testsec",
					scopes: '["send","read"]',
					createdAt: "2026-07-22T18:00:00.000Z",
					lastUsedAt: null,
					revokedAt: null,
				});
				await route.fulfill({
					json: { id: "key_2", name: "CLI", prefix: "lumi_testsec", key: secret },
				});
				return;
			}
			await route.fulfill({ json: { apiKeys: keys } });
		});
		await page.route("**/api/api-keys/key_1", async (route) => {
			revokeCalls += 1;
			keys[0].revokedAt = "2026-07-22T18:05:00.000Z";
			await route.fulfill({ json: { ok: true } });
		});

		await page.goto("/api-keys");
		await expect(page.getByText("Last used", { exact: false }).first()).toBeVisible();

		await page.getByRole("button", { name: "New API key" }).click();
		await page.getByLabel("Name").fill("CLI");
		await page.getByRole("button", { name: "Create key" }).click();

		await expect(page.getByRole("heading", { name: "Save this API key now" })).toBeVisible();
		await expect(page.getByText("shown only once", { exact: false })).toBeVisible();
		await expect(page.getByText(secret)).toBeVisible();
		await page.getByRole("button", { name: "Done" }).click();
		await expect(page.getByText(secret)).toHaveCount(0);

		await page.getByRole("button", { name: "Revoke" }).first().click();
		await expect(page.getByRole("heading", { name: "Revoke API key?" })).toBeVisible();
		await expect(page.getByText("cannot be undone", { exact: false })).toBeVisible();
		await page.getByRole("button", { name: "Revoke key" }).click();

		await expect.poll(() => revokeCalls).toBe(1);
		await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
		await expect(page.getByText("Revoked Jul", { exact: false })).toBeVisible();
	});

	test("keeps the revoke confirmation open when revocation fails", async ({ page }) => {
		await mockAuthenticatedShell(page);
		await page.route("**/api/api-keys", (route) =>
			route.fulfill({
				json: {
					apiKeys: [
						{
							id: "key_missing",
							name: "Stale key",
							prefix: "lumi_stale12",
							scopes: '["read"]',
							createdAt: "2026-07-20T12:00:00.000Z",
							lastUsedAt: null,
							revokedAt: null,
						},
					],
				},
			}),
		);
		await page.route("**/api/api-keys/key_missing", (route) =>
			route.fulfill({ status: 404, json: { error: "API key not found" } }),
		);

		await page.goto("/api-keys");
		await page.getByRole("button", { name: "Revoke" }).click();
		await page.getByRole("button", { name: "Revoke key" }).click();

		await expect(page.getByText("API key not found")).toBeVisible();
		await expect(page.getByRole("heading", { name: "Revoke API key?" })).toBeVisible();
	});
});
