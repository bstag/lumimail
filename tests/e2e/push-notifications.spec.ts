import { expect, test, type Page } from "@playwright/test";
import { folderCounts, mockAuthShell } from "./shell";

const subscription = {
	endpoint: "https://fcm.googleapis.com/fcm/send/e2e-token",
	keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
};

async function mockPushSettings(page: Page) {
	await page.addInitScript((value) => {
		Object.defineProperty(window, "PushManager", { configurable: true, value: class PushManager {} });
		Object.defineProperty(window, "Notification", { configurable: true, value: {
			permission: "default",
			requestPermission: async () => "granted",
		} });
		Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
			register: async () => undefined,
			ready: Promise.resolve({ pushManager: { subscribe: async () => ({ toJSON: () => value }) } }),
		} });
	}, subscription);
	await mockAuthShell(page, {
		user: { id: "usr_1", email: "user@example.com", name: "User", resetEmail: "r@example.net", role: "member" },
		mailboxes: [{
			id: "mbx_support", localPart: "support", hostname: "example.com",
			displayName: "Support", isPrimary: true, role: "viewer",
		}],
		counts: folderCounts(),
	});
	let devices: Array<Record<string, unknown>> = [];
	await page.route("**/api/push/config", (route) => route.fulfill({ json: {
		success: true, data: { available: true, vapidPublicKey: `B${"A".repeat(86)}` },
	} }));
	await page.route("**/api/push/devices", async (route) => {
		if (route.request().method() === "POST") {
			const body = route.request().postDataJSON();
			expect(body).toEqual({ name: "My laptop", subscription });
			devices = [{
				id: "pud_1", name: "My laptop", status: "active", current: true,
				mailboxIds: [], createdAt: new Date(1).toISOString(), lastDeliveredAt: null,
			}];
			return route.fulfill({ status: 201, json: { success: true, data: { device: devices[0] } } });
		}
		return route.fulfill({ json: { success: true, data: { devices } } });
	});
	await page.route("**/api/push/devices/pud_1/preferences", async (route) => {
		const body = route.request().postDataJSON();
		expect(body).toEqual({ mailboxIds: ["mbx_support"] });
		devices[0].mailboxIds = body.mailboxIds;
		return route.fulfill({ json: { success: true, data: body } });
	});
	await page.route("**/api/push/devices/pud_1", async (route) => {
		if (route.request().method() === "PATCH") {
			devices[0].name = route.request().postDataJSON().name;
			return route.fulfill({ json: { success: true, data: { updated: true } } });
		}
		devices[0].status = "revoked";
		return route.fulfill({ json: { success: true, data: { revoked: true } } });
	});
	await page.route("**/api/auth/reconfirm", (route) => route.fulfill({ json: { success: true, data: { confirmed: true } } }));
}

test("explicitly enrolls a device with every mailbox off, then saves preferences", async ({ page }) => {
	await mockPushSettings(page);
	await page.goto("/settings/notifications");
	await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
	await page.getByLabel("Device name").fill("My laptop");
	await page.getByRole("button", { name: "Enable notifications" }).click();
	await expect(page.getByText("My laptop")).toBeVisible();
	await expect(page.getByRole("checkbox", { name: /Support/ })).not.toBeChecked();
	await page.getByRole("checkbox", { name: /Support/ }).check();
	await page.getByRole("button", { name: "Save mailbox notifications" }).click();
	await expect(page.getByRole("status")).toContainText("Preferences saved");
});

test("renames and recently-authenticates before revoking a device at 390px", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockPushSettings(page);
	await page.goto("/settings/notifications");
	await page.getByLabel("Device name").fill("My laptop");
	await page.getByRole("button", { name: "Enable notifications" }).click();
	await page.getByRole("button", { name: "Rename My laptop" }).click();
	await page.getByLabel("New device name").fill("Travel laptop");
	await page.getByRole("button", { name: "Save device name" }).click();
	await expect(page.getByText("Travel laptop")).toBeVisible();
	await page.getByRole("button", { name: "Revoke Travel laptop" }).click();
	await page.getByLabel("Password").fill("correct horse");
	await page.getByRole("button", { name: "Revoke device" }).click();
	await expect(page.getByText("revoked", { exact: true })).toBeVisible();
	await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
