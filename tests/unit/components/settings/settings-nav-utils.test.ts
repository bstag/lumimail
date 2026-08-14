import { describe, expect, it } from "vitest";
import {
	getActiveSettingsNavItem,
	getSettingsNavSections,
	isSettingsPath,
} from "@/components/settings/settings-nav-utils";

describe("settings nav sections", () => {
	it("keeps a member on the account section only", () => {
		const sections = getSettingsNavSections("member");
		expect(sections.map((section) => section.id)).toEqual(["account"]);
		expect(sections[0].items.map((item) => item.id)).toEqual([
			"personal",
			"mailbox",
			"integrations",
		]);
	});

	it("adds organization administration for an admin without platform controls", () => {
		const sections = getSettingsNavSections("admin");
		expect(sections.map((section) => section.id)).toEqual(["account", "organization"]);
		expect(sections[1].items.map((item) => item.id)).toEqual([
			"overview",
			"members",
			"mailboxes",
			"domains",
			"aliases",
			"routing",
			"webhooks",
			"org-api-keys",
		]);
	});

	it("shows the complete lifecycle to an owner", () => {
		const sections = getSettingsNavSections("owner");
		expect(sections.map((section) => section.id)).toEqual([
			"account",
			"organization",
			"platform",
		]);
		expect(sections[2].items.map((item) => item.id)).toEqual(["operations", "queue-health"]);
		expect(sections[2].items.map((item) => item.href)).toEqual([
			"/operations",
			"/queue-health",
		]);
	});

	it("links every item to its existing guarded route", () => {
		const hrefs = getSettingsNavSections("owner").flatMap((section) =>
			section.items.map((item) => item.href),
		);
		expect(hrefs).toEqual([
			"/settings#personal",
			"/settings#mailbox",
			"/settings/api-keys",
			"/admin",
			"/members",
			"/mailboxes",
			"/domains",
			"/aliases",
			"/routing",
			"/webhooks",
			"/api-keys",
			"/operations",
			"/queue-health",
		]);
	});

	it("fails closed to the account section when the role is absent", () => {
		expect(getSettingsNavSections(null).map((section) => section.id)).toEqual(["account"]);
		expect(getSettingsNavSections(undefined).map((section) => section.id)).toEqual(["account"]);
	});
});

describe("active settings nav item", () => {
	it("selects account items from path and bounded hash", () => {
		expect(getActiveSettingsNavItem("/settings", "#mailbox")).toBe("mailbox");
		expect(getActiveSettingsNavItem("/settings", "#personal")).toBe("personal");
		expect(getActiveSettingsNavItem("/settings", "#unknown")).toBe("personal");
		expect(getActiveSettingsNavItem("/settings", "")).toBe("personal");
		expect(getActiveSettingsNavItem("/settings/api-keys", "")).toBe("integrations");
		expect(getActiveSettingsNavItem("/settings/mcp", "")).toBe("integrations");
	});

	it("selects organization items including nested detail routes", () => {
		expect(getActiveSettingsNavItem("/admin", "")).toBe("overview");
		expect(getActiveSettingsNavItem("/members", "#security")).toBe("members");
		expect(getActiveSettingsNavItem("/mailboxes", "")).toBe("mailboxes");
		expect(getActiveSettingsNavItem("/mailboxes/mb_abc123", "")).toBe("mailboxes");
		expect(getActiveSettingsNavItem("/domains", "")).toBe("domains");
		expect(getActiveSettingsNavItem("/aliases", "")).toBe("aliases");
		expect(getActiveSettingsNavItem("/routing", "")).toBe("routing");
		expect(getActiveSettingsNavItem("/webhooks", "")).toBe("webhooks");
		expect(getActiveSettingsNavItem("/api-keys", "")).toBe("org-api-keys");
	});

	it("selects platform items regardless of anchor", () => {
		expect(getActiveSettingsNavItem("/operations", "")).toBe("operations");
		expect(getActiveSettingsNavItem("/operations", "#release")).toBe("operations");
		expect(getActiveSettingsNavItem("/queue-health", "")).toBe("queue-health");
	});

	it("returns null outside the settings area", () => {
		expect(getActiveSettingsNavItem("/inbox", "")).toBeNull();
		expect(getActiveSettingsNavItem("/", "")).toBeNull();
		expect(getActiveSettingsNavItem("/settingsx", "")).toBeNull();
	});
});

describe("settings path detection", () => {
	it("covers personal and administrative routes for the profile menu", () => {
		for (const path of [
			"/settings",
			"/settings/api-keys",
			"/settings/mcp",
			"/admin",
			"/members",
			"/mailboxes",
			"/mailboxes/mb_abc123",
			"/domains",
			"/aliases",
			"/routing",
			"/webhooks",
			"/api-keys",
			"/operations",
			"/queue-health",
		]) {
			expect(isSettingsPath(path), path).toBe(true);
		}
	});

	it("rejects mail and unknown routes", () => {
		for (const path of ["/inbox", "/", "/settingsx", "/label/lb_1", "/contacts"]) {
			expect(isSettingsPath(path), path).toBe(false);
		}
	});
});
