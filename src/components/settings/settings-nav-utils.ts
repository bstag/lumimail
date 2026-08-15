import type { OrganizationRole } from "@/lib/auth/roles";

export type SettingsNavItemId =
	| "personal"
	| "mailbox"
	| "notifications"
	| "external-accounts"
	| "integrations"
	| "overview"
	| "members"
	| "mailboxes"
	| "domains"
	| "aliases"
	| "routing"
	| "webhooks"
	| "org-api-keys"
	| "operations"
	| "queue-health";

export type SettingsNavItem = Readonly<{
	id: SettingsNavItemId;
	label: string;
	href: string;
}>;

export type SettingsNavSectionId = "account" | "organization" | "platform";

export type SettingsNavSection = Readonly<{
	id: SettingsNavSectionId;
	label: string;
	items: readonly SettingsNavItem[];
}>;

const accountSection: SettingsNavSection = {
	id: "account",
	label: "Account",
	items: [
		{ id: "personal", label: "Personal", href: "/settings#personal" },
		{ id: "mailbox", label: "Mailbox", href: "/settings#mailbox" },
		{ id: "notifications", label: "Notifications", href: "/settings/notifications" },
		{ id: "external-accounts", label: "External accounts", href: "/settings/external-accounts" },
		{ id: "integrations", label: "Integrations", href: "/settings/api-keys" },
	],
};

const organizationSection: SettingsNavSection = {
	id: "organization",
	label: "Organization",
	items: [
		{ id: "overview", label: "Overview", href: "/admin" },
		{ id: "members", label: "Members", href: "/members" },
		{ id: "mailboxes", label: "Mailboxes", href: "/mailboxes" },
		{ id: "domains", label: "Domains", href: "/domains" },
		{ id: "aliases", label: "Aliases", href: "/aliases" },
		{ id: "routing", label: "Routing", href: "/routing" },
		{ id: "webhooks", label: "Webhooks", href: "/webhooks" },
		{ id: "org-api-keys", label: "API keys", href: "/api-keys" },
	],
};

const platformSection: SettingsNavSection = {
	id: "platform",
	label: "Platform",
	items: [
		{ id: "operations", label: "Operations", href: "/operations" },
		{ id: "queue-health", label: "Queue health", href: "/queue-health" },
	],
};

/**
 * The navigation model for the unified settings shell, filtered by what the
 * role may administer. Filtering here is presentation only — every href points
 * at a route whose own guard remains authoritative.
 */
export function getSettingsNavSections(
	role: OrganizationRole | null | undefined,
): readonly SettingsNavSection[] {
	if (role === "owner") return [accountSection, organizationSection, platformSection];
	if (role === "admin") return [accountSection, organizationSection];
	return [accountSection];
}

/**
 * Which nav item the current location belongs to, or null outside the settings
 * area. `/settings` splits on the hash because Personal and Mailbox share the
 * page; administrative anchors (`#security`, `#release`) stay within their page's
 * item rather than becoming entries of their own.
 */
export function getActiveSettingsNavItem(
	pathname: string,
	hash: string,
): SettingsNavItemId | null {
	if (pathname === "/settings") return hash === "#mailbox" ? "mailbox" : "personal";
	if (pathname === "/settings/api-keys" || pathname === "/settings/mcp") return "integrations";
	if (pathname === "/settings/notifications") return "notifications";
	if (pathname === "/settings/external-accounts") return "external-accounts";
	if (pathname === "/admin") return "overview";
	if (pathname === "/members") return "members";
	if (pathname === "/mailboxes" || pathname.startsWith("/mailboxes/")) return "mailboxes";
	if (pathname === "/domains") return "domains";
	if (pathname === "/aliases") return "aliases";
	if (pathname === "/routing") return "routing";
	if (pathname === "/webhooks") return "webhooks";
	if (pathname === "/api-keys") return "org-api-keys";
	if (pathname === "/operations") return "operations";
	if (pathname === "/queue-health") return "queue-health";
	return null;
}

/** Whether the location is anywhere in the settings area (personal or administrative). */
export function isSettingsPath(pathname: string): boolean {
	if (pathname === "/settings" || pathname.startsWith("/settings/")) return true;
	return getActiveSettingsNavItem(pathname, "") !== null;
}
