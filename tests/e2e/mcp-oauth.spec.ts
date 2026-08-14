import { expect, test, type Page } from "@playwright/test";
import { folderCounts, mockAuthShell } from "./shell";

async function mockMember(page: Page) {
	await mockAuthShell(page, {
		user: { id: "member_1", email: "member@example.com", name: "Member", resetEmail: null, role: "member" },
		mailboxes: [{
			id: "mbx_1", localPart: "member", hostname: "example.com", displayName: "Member",
			isPrimary: true, role: "manager",
		}],
		counts: folderCounts(),
	});
}

test("OAuth consent defaults to read only and approves only after password reconfirmation", async ({ page }) => {
	let approval: Record<string, unknown> | null = null;
	await page.route("**/api/mcp/authorization?*", (route) => route.fulfill({
		json: { success: true, data: { clientName: "Example Agent", requestedScopes: ["mail.read", "mail.actions"], defaultProfile: "read" } },
	}));
	await page.route("**/api/auth/reconfirm", (route) => route.fulfill({ json: { success: true, data: { recent: true } } }));
	await page.route("**/api/mcp/authorization", async (route) => {
		approval = route.request().postDataJSON() as Record<string, unknown>;
		await route.fulfill({ json: { success: true, data: { redirectTo: "/oauth/complete" } } });
	});

	await page.goto("/oauth/authorize?client_id=client_1&scope=mail.read%20mail.actions");
	await expect(page.getByText("Example Agent", { exact: true })).toBeVisible();
	await expect(page.getByRole("radio", { name: /Read only/ })).toBeChecked();
	await page.getByText("Mail actions", { exact: true }).click();
	await expect(page.getByRole("radio", { name: /Mail actions/ })).toBeChecked();
	await page.getByLabel("Confirm your password to approve").fill("correct horse battery staple");
	await page.getByRole("button", { name: "Approve connection" }).click();
	await expect.poll(() => approval).toMatchObject({ decision: "approve", profile: "actions" });
});

test("read-only client cannot select mail actions and denial needs no password", async ({ page }) => {
	let denial: Record<string, unknown> | null = null;
	await page.route("**/api/mcp/authorization?*", (route) => route.fulfill({
		json: { success: true, data: { clientName: "Read Agent", requestedScopes: ["mail.read"], defaultProfile: "read" } },
	}));
	await page.route("**/api/mcp/authorization", async (route) => {
		denial = route.request().postDataJSON() as Record<string, unknown>;
		await route.fulfill({ json: { success: true, data: { redirectTo: "/oauth/denied" } } });
	});
	await page.goto("/oauth/authorize?client_id=client_1&scope=mail.read");
	await expect(page.getByRole("radio", { name: /Mail actions/ })).toBeDisabled();
	await page.getByRole("button", { name: "Deny" }).click();
	await expect.poll(() => denial).toMatchObject({ decision: "deny" });
});

test("connected client can be revoked from the unified settings shell", async ({ page }) => {
	await mockMember(page);
	let revoked = false;
	await page.route("**/api/mcp/connections", (route) => route.fulfill({
		json: { success: true, data: { connections: revoked ? [] : [{
			id: "mcp_1", clientName: "Example Agent", profile: "actions", status: "active",
			createdAt: "2026-08-14T12:00:00.000Z", lastUsedAt: null, revokedAt: null,
		}] } },
	}));
	await page.route("**/api/auth/reconfirm", (route) => route.fulfill({ json: { success: true, data: { recent: true } } }));
	await page.route("**/api/mcp/connections/mcp_1", async (route) => {
		revoked = true;
		await route.fulfill({ json: { success: true, data: { revoked: true } } });
	});

	await page.goto("/settings/mcp");
	await expect(page.getByRole("heading", { name: "AI connections" })).toBeVisible();
	await expect(page.getByText("Example Agent", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Revoke" }).click();
	await page.getByLabel("Password").fill("correct horse battery staple");
	await page.getByRole("button", { name: "Revoke connection" }).click();
	await expect(page.getByText("No AI clients are connected.")).toBeVisible();
});
