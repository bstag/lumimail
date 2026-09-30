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

	test("home page states the purpose and Google API restrictions without signing in", async ({ page }) => {
		await page.goto("/");
		const section = page.getByRole("region", { name: "What Picket is for" });
		await expect(section).toBeVisible();
		await expect(section.getByText(/Picket is a shared email workspace/)).toBeVisible();
		await expect(section.getByText(/non-consensual intimate imagery/i)).toBeVisible();
		await expect(section.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
		await expect(section.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
	});

	test("reads without horizontal scrolling on a phone", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/privacy");
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});

test.describe("Home page without JavaScript", () => {
	test.use({ javaScriptEnabled: false });

	test("serves the purpose and Google API restrictions in the initial HTML", async ({ request }) => {
		const response = await request.get("/");
		expect(response.status()).toBe(200);
		const html = await response.text();
		expect(html).toContain("What Picket is for");
		expect(html).toContain("shared email workspace");
		expect(html).toMatch(/non-consensual intimate imagery/i);
		expect(html).toContain('href="/privacy"');
		expect(html).toContain('href="/terms"');
	});

	test("puts the purpose before the sign-in hero so a reader sees what the app is first", async ({ request }) => {
		const html = await (await request.get("/")).text();
		const purpose = html.indexOf("What Picket is for");
		const hero = html.indexOf("Mailboxes that feel like your inbox");
		expect(purpose).toBeGreaterThan(-1);
		expect(hero).toBeGreaterThan(-1);
		expect(purpose).toBeLessThan(hero);
	});
});
