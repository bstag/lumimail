import { expect, test } from "@playwright/test";

test.describe("password recovery", () => {
	test("opens recovery from login and shows the non-enumerating acknowledgement", async ({ page }) => {
		let submittedEmail: string | null = null;
		await page.route("**/api/auth/forgot-password", async (route) => {
			submittedEmail = (await route.request().postDataJSON()).email;
			await route.fulfill({
				json: {
					success: true,
					data: { message: "If the account exists, a reset link has been sent." },
				},
			});
		});

		await page.goto("/login");
		await page.getByRole("link", { name: "Forgot password?" }).click();
		await expect(page).toHaveURL(/\/forgot-password$/);
		await page.getByLabel("Account email").fill("owner@example.com");
		await page.getByRole("button", { name: "Send reset link" }).click();

		await expect.poll(() => submittedEmail).toBe("owner@example.com");
		await expect(page.getByText("Check your recovery email")).toBeVisible();
		await expect(page.getByText("If the account exists, a reset link has been sent.")).toBeVisible();
	});

	test("shows an incomplete-link error without submitting", async ({ page }) => {
		let requests = 0;
		await page.route("**/api/auth/reset-password", (route) => {
			requests += 1;
			return route.abort();
		});
		await page.goto("/reset-password");
		await expect(page.getByText("This reset link is incomplete or invalid.", { exact: false })).toBeVisible();
		expect(requests).toBe(0);
	});

	test("validates confirmation and completes a successful reset", async ({ page }) => {
		let submission: Record<string, string> | null = null;
		await page.route("**/api/auth/reset-password", async (route) => {
			submission = await route.request().postDataJSON();
			await route.fulfill({ json: { success: true, data: { ok: true } } });
		});

		await page.goto("/reset-password?token=secret&email=owner%40example.com");
		await page.getByLabel("New password", { exact: true }).fill("new-password");
		await page.getByLabel("Confirm new password").fill("different-password");
		await page.getByRole("button", { name: "Reset password" }).click();
		await expect(page.getByText("Passwords do not match", { exact: true })).toBeVisible();
		expect(submission).toBeNull();

		await page.getByLabel("Confirm new password").fill("new-password");
		await page.getByRole("button", { name: "Reset password" }).click();
		await expect.poll(() => submission).toEqual({
			email: "owner@example.com",
			token: "secret",
			newPassword: "new-password",
		});
		await expect(page.getByText("Password reset complete")).toBeVisible();
	});

	test("shows the safe API error for an expired or used token", async ({ page }) => {
		await page.route("**/api/auth/reset-password", (route) =>
			route.fulfill({
				status: 400,
				json: { success: false, error: { message: "Invalid or expired token" } },
			}),
		);
		await page.goto("/reset-password?token=used&email=owner%40example.com");
		await page.getByLabel("New password", { exact: true }).fill("new-password");
		await page.getByLabel("Confirm new password").fill("new-password");
		await page.getByRole("button", { name: "Reset password" }).click();
		await expect(page.getByText("Invalid or expired token", { exact: true })).toBeVisible();
	});
});
