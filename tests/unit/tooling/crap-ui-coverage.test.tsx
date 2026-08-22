import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Mail } from "lucide-react";

const queryResult = {
	data: undefined,
	error: null,
	isError: false,
	isLoading: false,
	isPending: false,
	isPlaceholderData: false,
	isSuccess: false,
};
let messageDetailData: unknown;
let threadData: unknown;
let folderMessages: unknown[] = [];
let currentPathname = "/inbox";
let allMailboxScope = false;
let currentSearch = "";
let desktopSplit = false;

function mockedQuery(options: { queryKey?: readonly unknown[] }) {
	const key = JSON.stringify(options.queryKey ?? []);
	if (key.includes('"detail"')) return { ...queryResult, data: messageDetailData };
	if (key.includes('"thread"')) return { ...queryResult, data: threadData };
	if (key.includes('"labels"') || key.includes('"message-sources"')) return { ...queryResult, data: [] };
	if (key === '["mailbox","mailbox-1"]') return { ...queryResult, data: {
		id: "mailbox-1", userId: "user-1", domainId: "domain-1", localPart: "hello",
		displayName: "Support", hostname: "example.com", isPrimary: true, role: "manager",
	} };
	if (key === '["mailbox-members","mailbox-1"]') return { ...queryResult, data: {
		members: [{ id: "membership-1", userId: "user-1", name: "Owner", email: "owner@example.com", role: "manager" }],
		workspaceMembers: [{ userId: "user-2", name: "Member", email: "member@example.com" }],
	} };
	if (key === '["domains",{"includeDns":false}]') return { ...queryResult, data: {
		domains: [{ id: "domain-1", hostname: "example.com" }],
	} };
	if (key === '["domains",{"includeDns":true}]') return { ...queryResult, data: {
		domains: [
			{ id: "domain-1", hostname: "example.com", status: "active", routingEnabled: true, sendingEnabled: true },
			{ id: "domain-2", hostname: "example.net", status: "pending", routingEnabled: false, sendingEnabled: false },
		],
		dns: {
			"domain-1": { routing: { configured: true, missing: [] }, sending: { configured: true, enabled: true, records: ["spf"] } },
			"domain-2": { routing: { configured: false, missing: ["MX"] }, sending: { configured: false, enabled: false, records: [] } },
		},
	} };
	if (key === '["aliases"]') return { ...queryResult, data: [
		{ id: "alias-1", localPart: "team", domainId: "domain-1", domainHostname: "example.com", targetMailboxId: "mailbox-1", forwardTo: null, isGroup: false, createdAt: "2026-01-01T00:00:00.000Z", members: [] },
		{ id: "alias-2", localPart: "group", domainId: "domain-1", domainHostname: "example.com", targetMailboxId: null, forwardTo: null, isGroup: true, createdAt: "2026-01-01T00:00:00.000Z", members: [{ mailboxId: "mailbox-1", localPart: "hello", hostname: "example.com" }] },
	] };
	if (key === '["routing-rules"]') return { ...queryResult, data: { rules: [
		{ id: "rule-1", pattern: "*", action: "store", mailboxId: "mailbox-1", forwardTo: null, priority: 1, domainId: "domain-1" },
		{ id: "rule-2", pattern: "sales", action: "forward", mailboxId: null, forwardTo: "outside@example.net", priority: 2, domainId: "domain-1" },
		{ id: "rule-3", pattern: "blocked", action: "reject", mailboxId: null, forwardTo: null, priority: 3, domainId: "domain-1" },
	] } };
	if (key === '["forwarding-destinations"]') return { ...queryResult, data: [
		{ id: "destination-1", address: "outside@example.net", verified: true },
		{ id: "destination-2", address: "pending@example.net", verified: false },
	] };
	if (key === '["admin","mailboxes"]') return { ...queryResult, data: {
		mailboxes: [
			{ id: "mailbox-1", domainId: "domain-1", localPart: "hello", hostname: "example.com", displayName: "Support", role: "manager", isPrimary: true },
			{ id: "mailbox-2", domainId: "domain-1", localPart: "sales", hostname: "example.com", displayName: null, role: null, isPrimary: false },
		],
		canSelfAssign: true, currentUserId: "user-1",
	} };
	if (key === '["org-members"]') return { ...queryResult, data: {
		members: [
			{ id: "member-1", userId: "user-1", name: "Owner", email: "owner@example.com", role: "owner" },
			{ id: "member-2", userId: "user-2", name: "Member", email: "member@example.com", role: "member" },
		],
		invites: [{ id: "invite-1", email: "invite@example.com", role: "member", expiresAt: "2026-12-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", status: "pending", deliveryStatus: "sent", lastDeliveryAttemptAt: null, lastDeliveredAt: "2026-01-01T00:00:00.000Z", acceptedAt: null }],
	} };
	if (key === '["admin","access-overview"]') return { ...queryResult, data: {
		members: [{ id: "member-2", userId: "user-2", name: "Member", email: "member@example.com", organizationRole: "member", grants: [] }],
		mailboxes: [{ id: "mailbox-1", address: "hello@example.com", displayName: "Support", assignedMemberCount: 1 }],
	} };
	if (key === '["admin","sessions"]') return { ...queryResult, data: {
		observedAt: "2026-01-01T00:00:00.000Z", activeCount: 1,
		sessions: [{ id: "session-1", userId: "user-1", name: "Owner", email: "owner@example.com", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", isCurrent: true }],
	} };
	if (key === '["mailboxes"]') return { ...queryResult, data: { mailboxes: [
		{ id: "mailbox-1", localPart: "hello", hostname: "example.com", displayName: "Support", role: "manager" },
	] } };
	if (key === '["external-accounts"]') return { ...queryResult, data: { accounts: [
		{ id: "external-1", mailboxId: "mailbox-1", mailboxAddress: "hello@example.com", ownerUserId: "user-1", provider: "google", externalAddress: "person@gmail.com", status: "active", importMode: "from_now", retainOriginal: false, lastSyncAt: null, lastErrorCode: "reauth_required" },
		{ id: "external-2", mailboxId: "mailbox-1", ownerUserId: "user-1", provider: "microsoft", externalAddress: "person@outlook.com", status: "paused", importMode: "recent_30_days", retainOriginal: true, lastSyncAt: "2026-01-01T00:00:00.000Z", lastErrorCode: null },
		{ id: "external-3", mailboxId: "mailbox-1", ownerUserId: "user-1", provider: "google", externalAddress: "old@gmail.com", status: "reconnect_required", importMode: "from_now", retainOriginal: true, lastSyncAt: null, lastErrorCode: null },
	] } };
	if (key === '["push-config"]') return { ...queryResult, data: { available: true, vapidPublicKey: "AQ" } };
	if (key === '["push-devices"]') return { ...queryResult, data: { devices: [
		{ id: "device-1", name: "Laptop", status: "active", current: true, mailboxIds: ["mailbox-1"], createdAt: "2026-01-01T00:00:00.000Z", lastDeliveredAt: "2026-01-02T00:00:00.000Z" },
		{ id: "device-2", name: "Old phone", status: "revoked", current: false, mailboxIds: [], createdAt: "2026-01-01T00:00:00.000Z", lastDeliveredAt: null },
	] } };
	if (key === '["mcp-connections"]') return { ...queryResult, data: { connections: [
		{ id: "connection-1", clientName: "Assistant", profile: "actions", status: "active", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-02T00:00:00.000Z", revokedAt: null },
		{ id: "connection-2", clientName: "Reader", profile: "read", status: "revoked", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null, revokedAt: "2026-01-03T00:00:00.000Z" },
	] } };
	if (key === '["api-keys"]') return { ...queryResult, data: [
		{ id: "key-1", name: "Automation", prefix: "lumi_abc", scopes: "read,send", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-02T00:00:00.000Z", revokedAt: null },
		{ id: "key-2", name: "Old", prefix: "lumi_old", scopes: "read", createdAt: undefined, lastUsedAt: null, revokedAt: "2026-01-03T00:00:00.000Z" },
	] };
	if (key === '["admin","operations"]') return { ...queryResult, data: {
		status: "attention", observedAt: "2026-01-01T00:00:00.000Z",
		application: { version: "1.0.0", schema: "1" },
		readiness: { status: "healthy", provider: "cloudflare", requiredCount: 9, readyCount: 9, missingCount: 0, storage: true, queues: true, delivery: true, service: true, assets: true },
		queues: { status: "attention", checkedAt: "2026-01-01T00:00:00.000Z", queueCount: 2, attentionCount: 1, unavailableCount: 0, backlogCount: 3, backlogBytes: 2048, staleJobCount: 1 },
		retention: { status: "healthy", scanned: 10, orphanCount: 0, orphanBytes: 0, oldestOrphanAt: null },
		evidence: { status: "attention", records: [
			{ category: "recovery", outcome: "passed", passedChecks: 2, totalChecks: 2, observedAt: "2026-01-01T00:00:00.000Z", recordedAt: "2026-01-01T00:00:00.000Z" },
			{ category: "release", outcome: "failed", passedChecks: 1, totalChecks: 2, observedAt: "2026-01-01T00:00:00.000Z", recordedAt: "2026-01-01T00:00:00.000Z" },
		] },
	} };
	return queryResult;
}

function translation() {
	const translate = (key: string) => key;
	translate.rich = (key: string) => key;
	return translate;
}

vi.mock("next-intl", () => ({
	useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }),
	useLocale: () => "en",
	useTranslations: translation,
}));
vi.mock("next/link", () => ({
	default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
		React.createElement("a", { ...props, href: String(href) }, children),
}));
vi.mock("next/navigation", () => ({
	useParams: () => ({ id: "mailbox-1" }),
	usePathname: () => currentPathname,
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
	useSearchParams: () => new URLSearchParams(currentSearch),
}));
vi.mock("@tanstack/react-query", () => ({
	useInfiniteQuery: () => ({ ...queryResult, fetchNextPage: vi.fn(), hasNextPage: false }),
	useMutation: () => ({ ...queryResult, mutate: vi.fn(), mutateAsync: vi.fn() }),
	useQuery: mockedQuery,
	useQueryClient: () => ({
		cancelQueries: vi.fn(),
		getQueryData: vi.fn(),
		invalidateQueries: vi.fn(),
		removeQueries: vi.fn(),
		setQueryData: vi.fn(),
	}),
}));
vi.mock("@/components/auth/auth-guard", () => ({
	AuthGuard: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/auth/auth-session-context", () => ({
	useAuthSession: () => ({ status: "authenticated", user: { id: "user-1", email: "a@example.com", role: "owner" } }),
}));
vi.mock("@/components/compose/compose-context", () => ({
	ComposeProvider: ({ children }: { children: React.ReactNode }) => children,
	useCompose: () => ({ openComposer: vi.fn(), openDraftComposer: vi.fn() }),
}));
vi.mock("@/components/mail-search/mail-search-context", () => ({
	MailSearchProvider: ({ children }: { children: React.ReactNode }) => children,
	useMailSearch: () => ({ query: "", setQuery: vi.fn() }),
}));
vi.mock("@/components/mailbox-provider", () => ({
	MailboxProvider: ({ children }: { children: React.ReactNode }) => children,
	useSelectedMailbox: () => ({
		allMailboxes: allMailboxScope,
		isLoading: false,
		mailboxes: [
			{ id: "mailbox-1", localPart: "hello", hostname: "example.com", role: "manager", displayName: "Support", isPrimary: true },
			{ id: "mailbox-2", localPart: "sales", hostname: "example.com", role: "responder", displayName: null },
		],
		scopedMailboxId: "mailbox-1",
		selectedMailbox: { id: "mailbox-1", localPart: "hello", hostname: "example.com", role: "manager" },
		setSelectedMailbox: vi.fn(),
	}),
}));
vi.mock("@/hooks/use-message-counts", () => ({
	useMessageCounts: () => ({ counts: {
		folders: Object.fromEntries(["inbox", "sent", "drafts", "archived", "spam", "trash", "starred"].map((folder) => [folder, { total: 3, unread: 2 }])),
		mailboxes: [{ mailboxId: "mailbox-1", unread: 120, inbox: 3 }],
	} }),
}));
vi.mock("@/hooks/use-media-query", () => ({ MOBILE_QUERY: "(max-width: 1px)", useMediaQuery: (query: string) => query.includes("min-width") && desktopSplit }));
vi.mock("@/hooks/use-messages", () => ({
	useMessages: () => ({
		isLoading: false,
		limit: 25,
		messages: folderMessages,
		offset: 0,
		setMessages: vi.fn(),
		total: 0,
		unreadCount: 0,
	}),
}));

import HomePage from "@/app/page";
import ContactsPage from "@/app/(dashboard)/contacts/page";
import AliasesPage from "@/app/(settings)/(org)/aliases/page";
import ApiKeysPage from "@/app/(settings)/(org)/api-keys/page";
import DomainsPage from "@/app/(settings)/(org)/domains/page";
import MailboxesPage from "@/app/(settings)/(org)/mailboxes/page";
import OperationsPage from "@/app/(settings)/(org)/operations/page";
import QueueHealthPage from "@/app/(settings)/(org)/queue-health/page";
import RoutingPage from "@/app/(settings)/(org)/routing/page";
import WebhooksPage from "@/app/(settings)/(org)/webhooks/page";
import MailboxSettingsPage from "@/app/(settings)/(org)/mailboxes/[id]/page";
import MembersPage from "@/app/(settings)/(org)/members/page";
import DashboardLayout from "@/app/(dashboard)/layout";
import SettingsLayout from "@/app/(settings)/layout";
import { RegisterClient } from "@/app/register/register-client";
import { OnboardingClient } from "@/app/onboarding/onboarding-client";
import { OAuthConsentClient } from "@/app/oauth/authorize/oauth-consent-client";
import { ExternalAccountsClient } from "@/app/(settings)/settings/external-accounts/external-accounts-client";
import { McpConnectionsClient } from "@/app/(settings)/settings/mcp/mcp-connections-client";
import { NotificationSettingsClient } from "@/app/(settings)/settings/notifications/notification-settings-client";
import { InviteMemberDialog } from "@/components/admin/invite-member-dialog";
import { ComposeForm } from "@/components/compose/compose-form";
import { ComposeEditorToolbar } from "@/components/compose/compose-editor-toolbar";
import { NavItem } from "@/components/components-nav";
import { MailboxSelector } from "@/components/mailbox-selector";
import { MessageActions } from "@/components/message-actions/message-actions";
import { MessageDetailView } from "@/components/messages/message-detail-view";
import { MessageFolderPage, MessageListRow } from "@/components/messages/message-folder-page";
import { CurrentMailboxForm } from "@/components/settings/current-mailbox-form";
import { VacationResponderForm } from "@/components/settings/vacation-responder-form";

const pages = [
	HomePage,
	ContactsPage,
	AliasesPage,
	ApiKeysPage,
	DomainsPage,
	MailboxesPage,
	OperationsPage,
	QueueHealthPage,
	RoutingPage,
	WebhooksPage,
	MailboxSettingsPage,
	MembersPage,
];

const configuredPageStates = [
	React.createElement(RegisterClient as React.ComponentType<{ initialHasPrimaryDomain?: boolean | null; initialPrimaryDomain?: string | null; initialStep?: 1 | 2 }>, { initialHasPrimaryDomain: false, initialStep: 1 }),
	React.createElement(RegisterClient as React.ComponentType<{ initialHasPrimaryDomain?: boolean | null; initialPrimaryDomain?: string | null; initialStep?: 1 | 2 }>, { initialHasPrimaryDomain: false, initialStep: 2 }),
	React.createElement(RegisterClient as React.ComponentType<{ initialHasPrimaryDomain?: boolean | null; initialPrimaryDomain?: string | null; initialStep?: 1 | 2 }>, { initialHasPrimaryDomain: true, initialPrimaryDomain: "example.com" }),
	React.createElement(RegisterClient as React.ComponentType<{ initialHasPrimaryDomain?: boolean | null; initialPrimaryDomain?: string | null; initialStep?: 1 | 2; initialInvite?: { email: string; orgName: string; role: string }; initialInviteToken?: string }>, { initialHasPrimaryDomain: true, initialPrimaryDomain: "example.com", initialInviteToken: "token", initialInvite: { email: "invite@example.com", orgName: "Example", role: "member" } }),
	React.createElement(RegisterClient as React.ComponentType<{ initialInviteToken?: string }>, { initialInviteToken: "token" }),
	React.createElement(InviteMemberDialog, { open: true, onOpenChange: vi.fn(), onInviteCreated: vi.fn(), initialInviteLink: "https://example.com/register?token=x", initialDeliveryStatus: "sent" }),
	React.createElement(InviteMemberDialog, { open: true, onOpenChange: vi.fn(), onInviteCreated: vi.fn(), initialInviteLink: "https://example.com/register?token=x", initialDeliveryStatus: "failed" }),
	React.createElement(OAuthConsentClient as React.ComponentType<{ initialSummary?: { clientName: string; requestedScopes: string[]; defaultProfile: "read" }; initialProfile?: "read" | "actions"; initialPassword?: string }>, { initialSummary: { clientName: "Assistant", requestedScopes: ["mail.read", "mail.actions"], defaultProfile: "read" }, initialProfile: "actions", initialPassword: "password" }),
	React.createElement(OAuthConsentClient as React.ComponentType<{ initialSummary?: { clientName: string; requestedScopes: string[]; defaultProfile: "read" }; initialProfile?: "read" | "actions"; initialPassword?: string }>, { initialSummary: { clientName: "Reader", requestedScopes: ["mail.read"], defaultProfile: "read" } }),
	React.createElement(AliasesPage as React.ComponentType<{ initialKind?: "mailbox" | "group"; initialDomainId?: string; initialTargetMailboxId?: string }>, { initialKind: "group", initialDomainId: "domain-1" }),
	React.createElement(AliasesPage as React.ComponentType<{ initialKind?: "mailbox" | "group"; initialDomainId?: string; initialTargetMailboxId?: string }>, { initialKind: "mailbox", initialDomainId: "domain-1", initialTargetMailboxId: "mailbox-1" }),
	React.createElement(RoutingPage as React.ComponentType<{ initialAction?: "store" | "forward" | "reject"; initialDomainId?: string; initialMailboxId?: string; initialForwardTo?: string }>, { initialAction: "store", initialDomainId: "domain-1", initialMailboxId: "mailbox-1" }),
	React.createElement(RoutingPage as React.ComponentType<{ initialAction?: "store" | "forward" | "reject"; initialDomainId?: string; initialMailboxId?: string; initialForwardTo?: string }>, { initialAction: "forward", initialDomainId: "domain-1", initialForwardTo: "outside@example.net" }),
	React.createElement(RoutingPage as React.ComponentType<{ initialAction?: "store" | "forward" | "reject"; initialDomainId?: string; initialMailboxId?: string; initialForwardTo?: string }>, { initialAction: "reject", initialDomainId: "domain-1" }),
];

function fakeEditor(active = false) {
	const chain = new Proxy({}, { get: (_target, key) => key === "run" ? () => true : () => chain });
	return {
		can: () => chain,
		chain: () => chain,
		getAttributes: () => ({}),
		isActive: () => active,
		state: { selection: { from: 0, to: 0 } },
		view: { dom: { addEventListener: vi.fn(), removeEventListener: vi.fn() } },
	} as never;
}

const componentStates = [
	React.createElement(RegisterClient),
	React.createElement(OnboardingClient),
	React.createElement(OAuthConsentClient),
	React.createElement(ExternalAccountsClient),
	React.createElement(McpConnectionsClient),
	React.createElement(NotificationSettingsClient),
	React.createElement(NotificationSettingsClient as React.ComponentType<{ initialSupport?: "supported" | "unsupported" | "install-required" | "denied" }>, { initialSupport: "supported" }),
	React.createElement(NotificationSettingsClient as React.ComponentType<{ initialSupport?: "supported" | "unsupported" | "install-required" | "denied" }>, { initialSupport: "unsupported" }),
	React.createElement(NotificationSettingsClient as React.ComponentType<{ initialSupport?: "supported" | "unsupported" | "install-required" | "denied" }>, { initialSupport: "install-required" }),
	React.createElement(NotificationSettingsClient as React.ComponentType<{ initialSupport?: "supported" | "unsupported" | "install-required" | "denied" }>, { initialSupport: "denied" }),
	React.createElement(InviteMemberDialog, { open: true, onOpenChange: vi.fn(), onInviteCreated: vi.fn() }),
	React.createElement(ComposeForm),
	React.createElement(ComposeEditorToolbar, { editor: null }),
	React.createElement(ComposeEditorToolbar, { editor: fakeEditor(), onInsertImage: vi.fn(), onRemoveInlineImage: vi.fn() }),
	React.createElement(ComposeEditorToolbar, { editor: fakeEditor(true), onInsertImage: vi.fn(), onRemoveInlineImage: vi.fn() }),
	React.createElement(NavItem, { link: { href: "/inbox", label: "inbox", icon: Mail, primary: true } }),
	React.createElement(NavItem, { link: { href: "/compose", label: "compose", icon: Mail, count: 120 }, collapsed: true }),
	React.createElement(NavItem, { link: { href: "/sent", label: "sent", icon: Mail, count: 2 } }),
	React.createElement(NavItem, { link: {} }),
	React.createElement(NavItem, { link: { href: "/empty" } }),
	React.createElement(MailboxSelector),
	React.createElement(MailboxSelector as React.ComponentType<{ defaultOpen?: boolean }>, { defaultOpen: true }),
	React.createElement(MessageActions, {
		messageId: "message-1",
		direction: "inbound",
		status: "delivered",
		read: false,
		fromAddr: "sender@example.com",
		toAddr: "hello@example.com",
		mailboxId: "mailbox-1",
		canSend: true,
	}),
	React.createElement(MessageDetailView, { messageId: "message-1" }),
	React.createElement(MessageFolderPage, {
		config: { folder: "inbox", emptyText: "empty", hrefPrefix: "/inbox" },
	}),
	React.createElement(CurrentMailboxForm),
	React.createElement(VacationResponderForm),
	React.createElement(VacationResponderForm as React.ComponentType<{ initialMailboxes?: Array<{ id: string; localPart: string; hostname: string; role?: string }> }>, { initialMailboxes: [{ id: "mailbox-1", localPart: "hello", hostname: "example.com", role: "manager" }] }),
	React.createElement(DashboardLayout, null, React.createElement("p", null, "Dashboard")),
	React.createElement(SettingsLayout, null, React.createElement("p", null, "Settings")),
];

describe("CRAP UI coverage", () => {
	it.each(pages)("renders %s in its empty state", (Page) => {
		expect(renderToStaticMarkup(React.createElement(Page))).toBeTruthy();
	});

	it.each(componentStates)("renders a client component state", (element) => {
		expect(renderToStaticMarkup(element)).toBeDefined();
	});

	it.each(configuredPageStates)("renders a configured page state", (element) => {
		expect(renderToStaticMarkup(element)).toBeDefined();
	});

	it("renders message rows across inbox, draft, and retry states", () => {
		const message = {
			id: "message-1",
			direction: "inbound",
			status: "delivered",
			read: false,
			starred: true,
			fromAddr: "Sender <sender@example.com>",
			toAddr: "hello@example.com",
			subject: "Subject",
			snippet: "Preview",
			createdAt: "2026-01-01T00:00:00.000Z",
			threadCount: 2,
		};
		const common = { selected: true, onSelectedChange: vi.fn(), onStarToggle: vi.fn() };
		const inbox = React.createElement(MessageListRow, {
			...common, message: message as never,
			config: { folder: "inbox", emptyText: "", hrefPrefix: "/inbox" },
			mailboxLabel: "hello@example.com", externalSourceLabel: "Google",
			compact: true, timestamp: "Now", active: true,
		});
		const draft = React.createElement(MessageListRow, {
			...common, message: { ...message, direction: "outbound", status: "draft", read: true } as never,
			config: { folder: "drafts", emptyText: "", hrefPrefix: "/drafts", showRowBadge: false },
		});
		const retry = React.createElement(MessageListRow, {
			...common, message: { ...message, direction: "outbound", status: "failed", read: true, starred: false } as never,
			config: { folder: "sent", emptyText: "", hrefPrefix: "/sent" }, canSend: true,
		});
		expect(renderToStaticMarkup(React.createElement(React.Fragment, null, inbox, draft, retry))).toContain("Subject");
	});

	it("renders the mailbox menu in all-mailbox settings scope", () => {
		currentPathname = "/settings";
		allMailboxScope = true;
		expect(renderToStaticMarkup(React.createElement(MailboxSelector as React.ComponentType<{ defaultOpen?: boolean }>, { defaultOpen: true }))).toContain("allMailboxes");
		currentPathname = "/inbox";
		allMailboxScope = false;
	});

	it("renders a populated message and its thread", () => {
		const message = {
			id: "message-1", mailboxId: "mailbox-1", threadId: "thread-1",
			direction: "inbound", status: "delivered", read: false,
			fromAddr: "Sender <sender@example.com>", toAddr: "hello@example.com",
			subject: "Thread subject", snippet: "Preview", createdAt: "2026-01-01T00:00:00.000Z",
			textBody: "Hello", htmlBody: null,
		};
		messageDetailData = { message, body: { textBody: "Hello", htmlBody: null } };
		threadData = { messages: [message, { ...message, id: "message-2", read: true }] };
		expect(renderToStaticMarkup(React.createElement(MessageDetailView, { messageId: "message-1", presentation: "panel" })))
			.toContain("Thread subject");
		messageDetailData = undefined;
		threadData = undefined;
	});

	it("renders a standalone sent message and populated folders", () => {
		const message = {
			id: "msg_3", mailboxId: "mailbox-1", threadId: null,
			direction: "outbound", status: "sent", read: true, starred: false,
			fromAddr: "hello@example.com", toAddr: "Recipient <recipient@example.com>",
			subject: null, snippet: "Standalone", createdAt: "2026-01-03T00:00:00.000Z",
		};
		messageDetailData = { message, body: { textBody: "Hello", htmlBody: null } };
		threadData = { messages: [message] };
		expect(renderToStaticMarkup(React.createElement(MessageDetailView, { messageId: "msg_3" }))).toContain("Hello");
		folderMessages = [message];
		desktopSplit = true;
		currentSearch = "message=msg_3";
		for (const folder of ["sent", "drafts", "trash"] as const) {
			expect(renderToStaticMarkup(React.createElement(MessageFolderPage, {
				config: { folder, emptyText: "empty", hrefPrefix: `/${folder}`, title: folder },
			}))).toContain("Standalone");
		}
		folderMessages = [];
		desktopSplit = false;
		currentSearch = "";
		messageDetailData = undefined;
		threadData = undefined;
	});
});
