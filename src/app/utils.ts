import { FileText, Inbox, MailCheck, Send, ShieldAlert, Trash2 } from "lucide-react";
import type { HomeAction, MailPreview, SidebarItem } from "./types";

export const sidebarItems: SidebarItem[] = [
	{ labelKey: "inbox", icon: Inbox, active: true, count: "18" },
	{ labelKey: "sent", icon: Send },
	{ labelKey: "drafts", icon: FileText, count: "4" },
	{ labelKey: "spam", icon: ShieldAlert },
	{ labelKey: "trash", icon: Trash2 },
];

// Illustrative product-screenshot content, deliberately untranslated: it plays
// the role of real mail (senders, subjects) rather than UI chrome.
export const heroMessages: MailPreview[] = [
	{
		icon: MailCheck,
		sender: "postmaster@northline.dev",
		subject: "Route matched",
		preview: "Inbound mail was delivered to support after DNS validation.",
		badge: "Inbound",
	},
	{
		icon: MailCheck,
		sender: "ops@halcyon.tools",
		subject: "API send accepted",
		preview: "Message queued through the production API key.",
		badge: "Sent",
	},
	{
		icon: MailCheck,
		sender: "alerts@marketmesh.io",
		subject: "Webhook delivered",
		preview: "Event payload reached your billing workspace endpoint.",
		badge: "Hook",
	},
	{
		icon: MailCheck,
		sender: "admin@lumimail.dev",
		subject: "Mailbox provisioned",
		preview: "New routing mailbox is ready for customer replies.",
		badge: "Admin",
	},
];

export function getHomeActions(isLoggedIn: boolean): HomeAction[] {
	if (isLoggedIn) {
		return [{ href: "/inbox", labelKey: "dashboard", variant: "default" }];
	}

	return [
		{ href: "/login", labelKey: "logIn", variant: "outline" },
		{ href: "/register", labelKey: "createAccount", variant: "default" },
	];
}
