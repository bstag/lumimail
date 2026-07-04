import { expect, test } from "@playwright/test";

test.describe("Landing page", () => {
	test("renders hero and primary CTAs for a logged-out visitor", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await expect(page.getByRole("banner").getByRole("link", { name: /log in/i })).toBeVisible();
		await expect(page.getByRole("banner").getByRole("link", { name: /create account/i })).toBeVisible();
	});

	test("navigates to login", async ({ page }) => {
		await page.goto("/");
		await page.getByRole("banner").getByRole("link", { name: /log in/i }).click();
		await expect(page).toHaveURL(/\/login/);
	});
});
