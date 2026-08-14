import type { OrganizationRole } from "@/lib/auth/roles";

export type SettingsCategoryId =
	| "personal"
	| "mailbox"
	| "integrations"
	| "organization"
	| "security"
	| "operations"
	| "updates";

export type SettingsCategory = Readonly<{
	id: SettingsCategoryId;
	label: string;
	description: string;
	href: string;
}>;

const personalCategories: readonly SettingsCategory[] = [
	{ id: "personal", label: "Personal", description: "Profile, recovery, and password", href: "/settings#personal" },
	{ id: "mailbox", label: "Mailbox", description: "Identity and automatic replies", href: "/settings#mailbox" },
	{ id: "integrations", label: "Integrations", description: "Personal API and mail-client access", href: "/settings/api-keys" },
];

const organizationCategory: SettingsCategory = {
	id: "organization",
	label: "Organization",
	description: "People, mailboxes, domains, and routing",
	href: "/admin",
};

const ownerCategories: readonly SettingsCategory[] = [
	{ id: "security", label: "Security", description: "Access, sessions, invitations, and history", href: "/members#security" },
	{ id: "operations", label: "Operations", description: "Runtime, queues, storage, and recovery", href: "/operations" },
	{ id: "updates", label: "Updates", description: "Signed release readiness and evidence", href: "/operations#release" },
];

export function getSettingsCategories(role: OrganizationRole | null | undefined): readonly SettingsCategory[] {
	if (role === "owner") return [...personalCategories, organizationCategory, ...ownerCategories];
	if (role === "admin") return [...personalCategories, organizationCategory];
	return [...personalCategories];
}

export function getActiveSettingsCategory(
	pathname: string,
	hash: string,
): SettingsCategoryId | null {
	if (pathname === "/settings/api-keys") return "integrations";
	if (pathname === "/settings") return hash === "#mailbox" ? "mailbox" : "personal";
	if (pathname === "/members") return "security";
	if (pathname === "/operations") return hash === "#release" ? "updates" : "operations";
	if (["/admin", "/mailboxes", "/domains", "/aliases", "/routing", "/webhooks", "/api-keys"].includes(pathname)) {
		return "organization";
	}
	return null;
}
