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

test("member settings nav exposes only account destinations", async ({ page }) => {
	await mockSettingsSession(page, "member");
	await page.goto("/settings");

	const nav = page.getByRole("navigation", { name: "Settings" });
	await expect(nav.getByRole("link", { name: "Personal" })).toHaveAttribute("aria-current", "page");
	await expect(nav.getByRole("link")).toHaveCount(4);
	await expect(nav.getByText("Organization")).toHaveCount(0);
	await expect(nav.getByRole("link", { name: "Members" })).toHaveCount(0);
	await expect(page.getByLabel("Recovery email")).toHaveValue("member-recovery@example.net");
});

test("owner settings nav lists the complete lifecycle in one shell", async ({ page }) => {
	await mockSettingsSession(page, "owner");
	await page.goto("/settings");

	const nav = page.getByRole("navigation", { name: "Settings" });
	await expect(nav.getByRole("link")).toHaveCount(14);
	await expect(nav.getByText("Account")).toBeVisible();
	await expect(nav.getByText("Organization")).toBeVisible();
	await expect(nav.getByText("Platform")).toBeVisible();
	await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/admin");
	await expect(nav.getByRole("link", { name: "Members" })).toHaveAttribute("href", "/members");
	await expect(nav.getByRole("link", { name: "Operations" })).toHaveAttribute("href", "/operations");
	await expect(nav.getByRole("link", { name: "Queue health" })).toHaveAttribute("href", "/queue-health");
});

test("organization pages render inside the same settings shell", async ({ page }) => {
	await mockSettingsSession(page, "owner");
	await page.goto("/admin");

	const nav = page.getByRole("navigation", { name: "Settings" });
	await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
	await expect(page.getByRole("heading", { name: "Organization" })).toBeVisible();
	await expect(page.getByRole("link", { name: /Domains/ }).first()).toBeVisible();
});

test("personal API keys retain the settings shell", async ({ page }) => {
	await mockSettingsSession(page, "member");
	await page.route("**/api/api-keys", (route) =>
		route.fulfill({ json: { success: true, data: { apiKeys: [] } } }),
	);
	await page.goto("/settings/api-keys");

	await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Settings" })
		.getByRole("link", { name: "Integrations" })).toHaveAttribute("aria-current", "page");
});

test("settings shell remains usable at 390px behind the drawer", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockSettingsSession(page, "owner");
	await page.goto("/settings");

	await expect(page.getByRole("heading", { name: "Personal", exact: true })).toBeVisible();
	await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);

	await page.getByRole("button", { name: "Open navigation" }).click();
	const nav = page.getByRole("navigation", { name: "Settings" });
	await expect(nav.getByRole("link", { name: "Members" })).toBeVisible();
	await nav.getByRole("link", { name: "Mailbox", exact: true }).click();
	await expect(page).toHaveURL(/\/settings#mailbox$/);
});
