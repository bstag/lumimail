export type OrganizationRole = "owner" | "admin" | "member";

export function isOrganizationAdminRole(
	role: string | null | undefined,
): role is "owner" | "admin" {
	return role === "owner" || role === "admin";
}
