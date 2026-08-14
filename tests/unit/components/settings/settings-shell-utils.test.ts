import { describe, expect, it } from "vitest";
import {
	getActiveSettingsCategory,
	getSettingsCategories,
} from "@/components/settings/settings-shell-utils";

describe("settings shell categories", () => {
	it("keeps a member on personal, mailbox, and personal integration surfaces", () => {
		expect(getSettingsCategories("member").map((category) => category.id)).toEqual([
			"personal",
			"mailbox",
			"integrations",
		]);
	});

	it("adds organization administration without owner-only platform controls", () => {
		expect(getSettingsCategories("admin").map((category) => category.id)).toEqual([
			"personal",
			"mailbox",
			"integrations",
			"organization",
		]);
	});

	it("shows the complete lifecycle to an owner", () => {
		const categories = getSettingsCategories("owner");
		expect(categories.map((category) => category.id)).toEqual([
			"personal",
			"mailbox",
			"integrations",
			"organization",
			"security",
			"operations",
			"updates",
		]);
		expect(categories.find((category) => category.id === "updates")?.href).toBe(
			"/operations#release",
		);
	});

	it("fails closed to personal categories when the role is absent", () => {
		expect(getSettingsCategories(null).map((category) => category.id)).toEqual([
			"personal",
			"mailbox",
			"integrations",
		]);
		expect(getSettingsCategories(undefined)).toHaveLength(3);
	});

	it("selects categories from exact paths and bounded hashes", () => {
		expect(getActiveSettingsCategory("/settings", "#mailbox")).toBe("mailbox");
		expect(getActiveSettingsCategory("/settings", "#unknown")).toBe("personal");
		expect(getActiveSettingsCategory("/settings/api-keys", "")).toBe("integrations");
		expect(getActiveSettingsCategory("/members", "#security")).toBe("security");
		expect(getActiveSettingsCategory("/operations", "#release")).toBe("updates");
		expect(getActiveSettingsCategory("/operations", "#unknown")).toBe("operations");
		expect(getActiveSettingsCategory("/domains", "")).toBe("organization");
		expect(getActiveSettingsCategory("/something-else", "#security")).toBeNull();
	});
});
