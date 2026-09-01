import { expect, test } from "@playwright/test";

test.describe("Landing page", () => {
	test("renders hero and primary CTAs for a logged-out visitor", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("header [data-brand-mark=true]")).toBeVisible();

		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await expect(page.getByRole("banner").getByRole("link", { name: /log in/i })).toBeVisible();
		await expect(page.getByRole("banner").getByRole("link", { name: /create account/i })).toBeVisible();
	});

	test("navigates to login", async ({ page }) => {
		await page.goto("/");
		await page.getByRole("banner").getByRole("link", { name: /log in/i }).click();
		await expect(page).toHaveURL(/\/login/);
	});

	test("cycles and persists the presentation theme", async ({ page }) => {
		await page.goto("/");
		await page.evaluate(() => localStorage.removeItem("theme"));
		await page.reload();

		const toggle = page.getByRole("button", { name: /theme: system/i });
		await toggle.click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

		await page.getByRole("button", { name: /theme: light/i }).click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await expect(page.getByRole("button", { name: /theme: dark/i })).toBeVisible();
	});
});
