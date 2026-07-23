import { describe, expect, it } from "vitest";
import { isOrganizationAdminRole } from "@/lib/auth/roles";

describe("isOrganizationAdminRole", () => {
	it.each(["owner", "admin"])("accepts %s", (role) => {
		expect(isOrganizationAdminRole(role)).toBe(true);
	});

	it.each(["member", "", undefined, null, "manager"])("rejects %s", (role) => {
		expect(isOrganizationAdminRole(role)).toBe(false);
	});
});
