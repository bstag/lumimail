import { expect, test, type Page } from "@playwright/test";
import { folderCounts, mockAuthShell } from "./shell";

async function mockSettingsSession(page: Page, role: "owner" | "member") {
	await mockAuthShell(page, {
		user: {
			id: `${role}_1`,
			email: `${role}@example.com`,
			name: role === "owner" ? "Owner" : "Member",
			resetEmail: `${role}-recovery@example.net`,
			role,
		},
		mailboxes: [{
			id: "mbx_support",
			localPart: "support",
			hostname: "example.com",
			displayName: "Support",
			isPrimary: true,
			role: role === "owner" ? "manager" : "responder",
		}],
		counts: folderCounts(),
	});
	await page.route("**/api/vacation", (route) =>
		route.fulfill({ json: { success: true, data: { responder: null } } }),
	);
}

test("member settings shell exposes only personal lifecycle destinations", async ({ page }) => {
	await mockSettingsSession(page, "member");
	await page.goto("/settings");

	const categories = page.getByRole("navigation", { name: "Settings categories" });
	await expect(categories.getByRole("link", { name: /^Personal/ })).toHaveAttribute("aria-current", "page");
	await expect(categories.getByRole("link")).toHaveCount(3);
	await expect(categories.getByRole("link", { name: /^Organization/ })).toHaveCount(0);
	await expect(categories.getByRole("link", { name: /^Security/ })).toHaveCount(0);
	await expect(page.getByLabel("Recovery email")).toHaveValue("member-recovery@example.net");
});

test("owner settings shell links the complete administrative lifecycle", async ({ page }) => {
	await mockSettingsSession(page, "owner");
	await page.goto("/settings");

	const categories = page.getByRole("navigation", { name: "Settings categories" });
	await expect(categories.getByRole("link")).toHaveCount(7);
	await expect(categories.getByRole("link", { name: /^Organization/ })).toHaveAttribute("href", "/admin");
	await expect(categories.getByRole("link", { name: /^Security/ })).toHaveAttribute("href", "/members#security");
	await expect(categories.getByRole("link", { name: /^Operations/ })).toHaveAttribute("href", "/operations");
	await expect(categories.getByRole("link", { name: /^Updates/ })).toHaveAttribute("href", "/operations#release");
});

test("personal API keys retain the settings shell", async ({ page }) => {
	await mockSettingsSession(page, "member");
	await page.route("**/api/api-keys", (route) =>
		route.fulfill({ json: { success: true, data: { apiKeys: [] } } }),
	);
	await page.goto("/settings/api-keys");

	await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Settings categories" })
		.getByRole("link", { name: /^Integrations/ })).toHaveAttribute("aria-current", "page");
});

test("settings category rail remains horizontally usable at 390px", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockSettingsSession(page, "owner");
	await page.goto("/settings");

	const categories = page.getByRole("navigation", { name: "Settings categories" });
	await expect(categories).toBeVisible();
	await expect(categories.getByRole("link", { name: /^Personal/ })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Personal", exact: true })).toBeVisible();
	await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
