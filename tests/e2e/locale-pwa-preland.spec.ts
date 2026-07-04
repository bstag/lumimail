import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";

async function expectLocaleCookie(context: BrowserContext, value: string) {
	await expect
		.poll(async () => (await context.cookies()).find((cookie) => cookie.name === "NEXT_LOCALE")?.value)
		.toBe(value);
}

test.describe("PWA pre-land locale checks", () => {
	test("/ and /login return 200", async ({ page }) => {
		await expect((await page.request.get("/")).status()).toBe(200);
		await expect((await page.request.get("/login")).status()).toBe(200);
	});

	test("LanguageSwitcher persists Portuguese and reloads translated login messages", async ({ context, page }) => {
		await page.goto("/login");
		await page.getByLabel("Select language").selectOption("pt");

		await expectLocaleCookie(context, "pt");
		await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
		await expect(page.getByText("Abra sua caixa de entrada")).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
	});

	test("LanguageSwitcher persists Arabic and keeps the document RTL", async ({ context, page }) => {
		await page.goto("/login");
		await page.getByLabel("Select language").selectOption("ar");

		await expectLocaleCookie(context, "ar");
		await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
		await expect(page.getByText("افتح صندوق بريدك")).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
	});

	test("renders one mobile web app capability tag", async ({ page }) => {
		await page.goto("/");

		await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveCount(1);
		await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
		await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveCount(0);
	});
});
