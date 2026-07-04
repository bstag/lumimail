import { expect, test } from "@playwright/test";

test.describe("PWA shell", () => {
	test("exposes install metadata", async ({ page }) => {
		await page.goto("/");

		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
		await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
		await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute("content", "yes");

		const manifestResponse = await page.request.get("/manifest.webmanifest");
		expect(manifestResponse.ok()).toBe(true);
		expect(manifestResponse.headers()["content-type"]).toMatch(/application\/manifest\+json|application\/json/);
		expect(await manifestResponse.json()).toMatchObject({
			name: "Lumimail",
			start_url: "/",
			scope: "/",
			display: "standalone",
		});
	});

	test("registers the service worker and serves the offline navigation shell", async ({ context, page }) => {
		await page.goto("/");

		const scriptUrl = await page.evaluate(async () => {
			if (!("serviceWorker" in navigator)) return null;

			await navigator.serviceWorker.register("/sw.js", { scope: "/" });
			const registration = await navigator.serviceWorker.ready;
			return registration.active?.scriptURL ?? null;
		});

		expect(scriptUrl).toContain("/sw.js");
		await page.reload({ waitUntil: "domcontentloaded" });

		try {
			await context.setOffline(true);
			const response = await page.goto(`/offline-check-${Date.now()}`, { waitUntil: "domcontentloaded" });

			expect(response?.ok()).toBe(true);
			await expect(page.getByRole("heading", { name: /you are offline/i })).toBeVisible();
		} finally {
			await context.setOffline(false);
		}
	});
});
