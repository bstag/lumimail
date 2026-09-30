import { expect, test } from "@playwright/test";

test.describe("Public legal pages", () => {
	test("privacy policy is public and discloses Google data use", async ({ page }) => {
		const response = await page.goto("/privacy");
		expect(response?.status()).toBe(200);
		await expect(page).toHaveURL(/\/privacy$/);
		await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
		await expect(page.getByText("support@henriksen.dev").first()).toBeVisible();
		await expect(page.getByText("Limited Use requirements")).toBeVisible();
		await expect(page.getByText("gmail.readonly").first()).toBeVisible();
		await expect(page.getByText("gmail.send").first()).toBeVisible();
	});

	test("terms of service is public", async ({ page }) => {
		const response = await page.goto("/terms");
		expect(response?.status()).toBe(200);
		await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
		await expect(page.getByRole("heading", { level: 2, name: "Acceptable use" })).toBeVisible();
	});

	test("landing footer reaches both documents and the documents link onward", async ({ page }) => {
		await page.goto("/");
		const legal = page.getByRole("navigation", { name: "Legal" });
		await expect(legal).toBeVisible();

		await legal.getByRole("link", { name: "Privacy" }).click();
		await expect(page).toHaveURL(/\/privacy$/);

		await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Terms of Service" }).click();
		await expect(page).toHaveURL(/\/terms$/);

		await page.getByRole("link", { name: "Picket home" }).click();
		await expect(page).toHaveURL(/\/$/);
	});

	test("reads without horizontal scrolling on a phone", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/privacy");
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});
