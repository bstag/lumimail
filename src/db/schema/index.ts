import { sql } from "drizzle-orm";
import {
	sqliteTable,
	text,
	integer,
	index,
	uniqueIndex,
	type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import {
	DEFAULT_LABEL_COLOR,
	MAILBOX_ROLES,
	MESSAGE_STATUSES,
	ORG_INVITE_ROLES,
	ROUTING_ACTIONS,
	WEBHOOK_DELIVERY_STATUSES,
} from "@/lib/constants";

export const organizations = sqliteTable("organizations", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const organizationMembers = sqliteTable(
	"organization_members",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [uniqueIndex("org_members_user_org_idx").on(t.userId, t.organizationId)],
);

export const orgInvites = sqliteTable(
	"org_invites",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		role: text("role", { enum: ORG_INVITE_ROLES }).notNull().default("member"),
		token: text("token").notNull().unique(),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		deliveryStatus: text("delivery_status", { enum: ["not_sent", "sending", "sent", "failed"] }).notNull().default("not_sent"),
		lastDeliveryAttemptAt: integer("last_delivery_attempt_at", { mode: "timestamp" }),
		lastDeliveredAt: integer("last_delivered_at", { mode: "timestamp" }),
		acceptedAt: integer("accepted_at", { mode: "timestamp" }),
	},
	(t) => [index("org_invites_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const users = sqliteTable("users", {
	id: text("id").primaryKey(),
	email: text("email").notNull().unique(),
	resetEmail: text("reset_email"),
	passwordHash: text("password_hash").notNull(),
	name: text("name").notNull(),
	organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export const domains = sqliteTable(
	"domains",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
		hostname: text("hostname").notNull(),
		zoneId: text("zone_id").notNull(),
		status: text("status", { enum: ["pending", "active", "error"] })
			.notNull()
			.default("pending"),
		routingStatus: text("routing_status"),
		sendingSubdomainTag: text("sending_subdomain_tag"),
		sendingEnabled: integer("sending_enabled", { mode: "boolean" }).notNull().default(false),
		routingEnabled: integer("routing_enabled", { mode: "boolean" }).notNull().default(false),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("domains_hostname_idx").on(t.hostname),
		index("domains_user_idx").on(t.userId),
		index("domains_org_idx").on(t.organizationId),
	],
);

export const mailboxes = sqliteTable(
	"mailboxes",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
		domainId: text("domain_id")
			.notNull()
			.references(() => domains.id, { onDelete: "cascade" }),
		localPart: text("local_part").notNull(),
		displayName: text("display_name"),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("mailboxes_address_idx").on(t.domainId, t.localPart),
		index("mailboxes_org_idx").on(t.organizationId),
	],
);

export const mailboxMemberships = sqliteTable(
	"mailbox_memberships",
	{
		id: text("id").primaryKey(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: text("role", { enum: MAILBOX_ROLES })
			.notNull()
			.default("viewer"),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("mailbox_memberships_mailbox_user_idx").on(t.mailboxId, t.userId),
		index("mailbox_memberships_user_mailbox_idx").on(t.userId, t.mailboxId),
		index("mailbox_memberships_mailbox_role_idx").on(t.mailboxId, t.role),
	],
);

export const aliases = sqliteTable(
	"aliases",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
		domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
		localPart: text("local_part").notNull(),
		targetMailboxId: text("target_mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
		forwardTo: text("forward_to"),
		isGroup: integer("is_group", { mode: "boolean" }).notNull().default(false),
		cloudflareRuleId: text("cloudflare_rule_id"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [uniqueIndex("aliases_address_idx").on(t.domainId, t.localPart)],
);

/**
 * Organization ownership of an external forwarding destination.
 *
 * Cloudflare destination addresses are account-level and therefore shared by every
 * Lumimail tenant on the same Cloudflare account. Verification status alone must
 * never authorize a forward, or one organization could forward to an address a
 * different organization verified. A forward is permitted only when a row exists
 * here for the requesting organization AND Cloudflare reports the address verified.
 */
export const forwardingDestinations = sqliteTable(
	"forwarding_destinations",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		address: text("address").notNull(),
		verifiedAt: integer("verified_at", { mode: "timestamp" }),
		lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("forwarding_destinations_org_address_idx").on(t.organizationId, t.address),
	],
);

export const groupMembers = sqliteTable(
	"group_members",
	{
		id: text("id").primaryKey(),
		aliasId: text("alias_id").notNull().references(() => aliases.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		email: text("email"),
		mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("group_members_alias_mailbox_idx").on(t.aliasId, t.mailboxId),
		index("group_members_mailbox_idx").on(t.mailboxId),
	],
);

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	tokenHash: text("token_hash").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	used: integer("used", { mode: "boolean" }).notNull().default(false),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (t) => [index("password_reset_tokens_user_idx").on(t.userId)]);

export const contacts = sqliteTable(
	"contacts",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		displayName: text("display_name"),
		source: text("source", { enum: ["manual", "inbound", "outbound"] })
			.notNull()
			.default("inbound"),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("contacts_user_email_idx").on(t.userId, t.email),
		index("contacts_user_idx").on(t.userId),
		index("contacts_org_idx").on(t.organizationId),
	],
);

export const apiKeys = sqliteTable("api_keys", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	prefix: text("prefix").notNull(),
	keyHash: text("key_hash").notNull(),
	scopes: text("scopes").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
	lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
	revokedAt: integer("revoked_at", { mode: "timestamp" }),
}, (t) => [index("api_keys_user_idx").on(t.userId)]);

export const messages = sqliteTable(
	"messages",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
		direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
		providerMessageId: text("provider_message_id"),
		rfcMessageId: text("rfc_message_id"),
		inReplyTo: text("in_reply_to"),
		referencesHeader: text("references_header"),
		replySourceMessageId: text("reply_source_message_id"),
		fromAddr: text("from_addr").notNull(),
		toAddr: text("to_addr").notNull(),
		subject: text("subject"),
		snippet: text("snippet"),
		// Enum listed in MESSAGE_STATUSES but typed wide there; see that constant
		// for why the column's TS data type stays `string` for now.
		status: text("status", { enum: MESSAGE_STATUSES }).notNull().default("received"),
		attachmentStatus: text("attachment_status", {
			enum: ["none", "stored", "omitted"],
		}).notNull().default("none"),
		attachmentError: text("attachment_error"),
		read: integer("read", { mode: "boolean" }).notNull().default(false),
		starred: integer("starred", { mode: "boolean" }).notNull().default(false),
		threadId: text("thread_id"),
		imapUid: integer("imap_uid"),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		index("messages_user_created_idx").on(t.userId, t.createdAt),
		index("messages_mailbox_idx").on(t.mailboxId),
		// Folder listing filters by mailbox and orders by date; without this the
		// page scans and sorts.
		index("messages_mailbox_created_idx").on(t.mailboxId, t.createdAt),
		// Thread view fetches every message in a conversation ordered by date (F58).
		// Without this the query scans the table and sorts into a temporary B-tree.
		index("messages_thread_created_idx").on(t.threadId, t.createdAt),
		index("messages_mailbox_rfc_message_idx").on(t.mailboxId, t.rfcMessageId),
		index("messages_org_idx").on(t.organizationId),
		uniqueIndex("messages_imap_uid_idx").on(t.imapUid),
	],
);

export const imapUidCounter = sqliteTable("imap_uid_counter", {
	id: integer("id").primaryKey(),
	value: integer("value").notNull(),
});

export const rateLimits = sqliteTable(
	"rate_limits",
	{
		keyHash: text("key_hash").primaryKey(),
		count: integer("count").notNull(),
		// Deliberately a plain integer (epoch milliseconds), not timestamp mode:
		// rate-limit.ts compares and assigns reset_at inside raw SQL against
		// Date.now(), so the stored value must be numeric ms with no Drizzle
		// Date mapping in between.
		resetAt: integer("reset_at").notNull(),
	},
	(t) => [index("rate_limits_reset_at_idx").on(t.resetAt)],
);

export const messageBodies = sqliteTable("message_bodies", {
	id: text("id").primaryKey(),
	messageId: text("message_id")
		.notNull()
		.references(() => messages.id, { onDelete: "cascade" })
		.unique(),
	textBody: text("text_body"),
	htmlBody: text("html_body"),
	rawR2Key: text("raw_r2_key"),
});

export const outboundJobs = sqliteTable("outbound_jobs", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
	messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
	status: text("status", { enum: ["queued", "processing", "sent", "failed"] }).notNull().default("queued"),
	payload: text("payload").notNull(),
	error: text("error"),
	attempts: integer("attempts").notNull().default(0),
	deliveryToken: text("delivery_token"),
	lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
	recoveredAt: integer("recovered_at", { mode: "timestamp" }),
	recoveryCount: integer("recovery_count").notNull().default(0),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
}, (t) => [
	index("outbound_jobs_status_updated_idx").on(t.status, t.updatedAt),
]);

export const queueHealthSnapshots = sqliteTable("queue_health_snapshots", {
	queueKey: text("queue_key", {
		enum: ["inbound", "outbound", "outbound_dlq"],
	}).primaryKey(),
	status: text("status", {
		enum: ["healthy", "delayed", "attention", "unavailable"],
	}).notNull(),
	backlogCount: integer("backlog_count").notNull().default(0),
	backlogBytes: integer("backlog_bytes").notNull().default(0),
	oldestMessageAt: integer("oldest_message_at", { mode: "timestamp" }),
	staleJobCount: integer("stale_job_count").notNull().default(0),
	detail: text("detail"),
	checkedAt: integer("checked_at", { mode: "timestamp" }).notNull(),
});

export const routingRules = sqliteTable("routing_rules", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
	domainId: text("domain_id")
		.notNull()
		.references(() => domains.id, { onDelete: "cascade" }),
	pattern: text("pattern").notNull(),
	mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
	action: text("action", { enum: ROUTING_ACTIONS }).notNull().default("store"),
	forwardTo: text("forward_to"),
	priority: integer("priority").notNull().default(0),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
}, (t) => [
	// Inbound routing filters by domain on every message, twice since F62.
	index("routing_rules_domain_idx").on(t.domainId),
	index("routing_rules_org_idx").on(t.organizationId),
]);

export const webhooks = sqliteTable("webhooks", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
	url: text("url").notNull(),
	secret: text("secret").notNull(),
	events: text("events").notNull(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
	id: text("id").primaryKey(),
	webhookId: text("webhook_id")
		.notNull()
		.references(() => webhooks.id, { onDelete: "cascade" }),
	eventType: text("event_type").notNull(),
	payload: text("payload").notNull(),
	status: text("status", { enum: WEBHOOK_DELIVERY_STATUSES }).notNull().default("pending"),
	attempts: integer("attempts").notNull().default(0),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
}, (t) => [index("webhook_deliveries_webhook_idx").on(t.webhookId)]);

export const sessions = sqliteTable(
	"sessions",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
		/**
		 * SHA-256 of the session token, used only to find the row (F66). Safe as a
		 * lookup key because a session token is high-entropy random material rather
		 * than a user-chosen password; authentication still depends on `tokenHash`.
		 */
		tokenLookup: text("token_lookup").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		authenticatedAt: integer("authenticated_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("sessions_token_lookup_idx").on(t.tokenLookup),
		index("sessions_user_idx").on(t.userId),
	],
);

export const mcpConnections = sqliteTable(
	"mcp_connections",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
		approvingSessionId: text("approving_session_id").notNull(),
		clientId: text("client_id").notNull(),
		clientName: text("client_name").notNull(),
		profile: text("profile", { enum: ["read", "actions"] }).notNull(),
		scopes: text("scopes").notNull(),
		status: text("status", { enum: ["pending", "active", "revoked"] }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
		revokedAt: integer("revoked_at", { mode: "timestamp" }),
	},
	(t) => [
		index("mcp_connections_user_status_idx").on(t.userId, t.status),
		index("mcp_connections_session_idx").on(t.approvingSessionId),
	],
);

export const outboundIdempotency = sqliteTable(
	"outbound_idempotency",
	{
		id: text("id").primaryKey(),
		principalType: text("principal_type", { enum: ["mcp"] }).notNull(),
		principalId: text("principal_id").notNull().references(() => mcpConnections.id, { onDelete: "cascade" }),
		idempotencyKey: text("idempotency_key").notNull(),
		requestHash: text("request_hash").notNull(),
		messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
		jobId: text("job_id").notNull().references(() => outboundJobs.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [uniqueIndex("outbound_idempotency_principal_key_idx").on(
		t.principalType, t.principalId, t.idempotencyKey,
	)],
);

export const oauthRefreshTokenUses = sqliteTable(
	"oauth_refresh_token_uses",
	{
		tokenHash: text("token_hash").primaryKey(),
		claimId: text("claim_id").notNull(),
		usedAt: integer("used_at", { mode: "timestamp" }).notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [index("oauth_refresh_token_uses_expiry_idx").on(t.expiresAt)],
);

export const externalAccounts = sqliteTable(
	"external_accounts",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		// Audit metadata, not lifecycle ownership: expiring/revoking the browser
		// session must not cascade-delete an external mailbox connection or its maps.
		approvingSessionId: text("approving_session_id").notNull(),
		provider: text("provider", { enum: ["google", "microsoft"] }).notNull(),
		externalAddress: text("external_address").notNull(),
		tokenCiphertext: text("token_ciphertext").notNull(),
		tokenIv: text("token_iv").notNull(),
		tokenKeyId: text("token_key_id").notNull(),
		status: text("status", { enum: [
			"connecting", "initial_sync", "active", "paused", "reconnect_required",
			"resync_required", "error", "disconnected",
		] }).notNull(),
		importMode: text("import_mode", { enum: ["from_now", "recent_30_days"] }).notNull(),
		retainOriginal: integer("retain_original", { mode: "boolean" }).notNull().default(false),
		lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
		lastErrorCode: text("last_error_code"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		revokedAt: integer("revoked_at", { mode: "timestamp" }),
	},
	(t) => [
		uniqueIndex("external_accounts_mailbox_provider_address_idx").on(t.mailboxId, t.provider, t.externalAddress),
		index("external_accounts_owner_org_status_idx").on(t.ownerUserId, t.organizationId, t.status),
		index("external_accounts_due_sync_idx").on(t.status, t.lastSyncAt),
	],
);

export const externalOauthStates = sqliteTable(
	"external_oauth_states",
	{
		id: text("id").primaryKey(),
		stateHash: text("state_hash").notNull(),
		organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		approvingSessionId: text("approving_session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
		provider: text("provider", { enum: ["google", "microsoft"] }).notNull(),
		importMode: text("import_mode", { enum: ["from_now", "recent_30_days"] }).notNull(),
		retainOriginal: integer("retain_original", { mode: "boolean" }).notNull().default(false),
		verifierCiphertext: text("verifier_ciphertext").notNull(),
		verifierIv: text("verifier_iv").notNull(),
		verifierKeyId: text("verifier_key_id").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		usedAt: integer("used_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("external_oauth_states_hash_idx").on(t.stateHash),
		index("external_oauth_states_expiry_idx").on(t.expiresAt, t.usedAt),
	],
);

export const externalSyncCursors = sqliteTable(
	"external_sync_cursors",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull().references(() => externalAccounts.id, { onDelete: "cascade" }),
		remoteFolderKey: text("remote_folder_key").notNull(),
		cursorType: text("cursor_type", { enum: ["gmail_history", "microsoft_delta"] }).notNull(),
		cursorCiphertext: text("cursor_ciphertext").notNull(),
		cursorIv: text("cursor_iv").notNull(),
		cursorKeyId: text("cursor_key_id").notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [uniqueIndex("external_sync_cursors_account_folder_idx").on(t.accountId, t.remoteFolderKey)],
);

export const externalMessages = sqliteTable(
	"external_messages",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull().references(() => externalAccounts.id, { onDelete: "cascade" }),
		remoteMessageId: text("remote_message_id").notNull(),
		remoteThreadId: text("remote_thread_id"),
		remoteFolderKey: text("remote_folder_key").notNull(),
		lumimailMessageId: text("lumimail_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
		remoteRevision: text("remote_revision"),
		firstSeenAt: integer("first_seen_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		removedAt: integer("removed_at", { mode: "timestamp" }),
	},
	(t) => [
		uniqueIndex("external_messages_account_remote_idx").on(t.accountId, t.remoteMessageId),
		uniqueIndex("external_messages_account_lumimail_idx").on(t.accountId, t.lumimailMessageId),
		index("external_messages_lumimail_idx").on(t.lumimailMessageId),
	],
);

export const externalSyncJobs = sqliteTable(
	"external_sync_jobs",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull().references(() => externalAccounts.id, { onDelete: "cascade" }),
		kind: text("kind", { enum: ["initial", "incremental", "resync", "reconcile"] }).notNull(),
		status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull(),
		attempts: integer("attempts").notNull().default(0),
		nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }).notNull(),
		leaseUntil: integer("lease_until", { mode: "timestamp" }),
		errorCode: text("error_code"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		completedAt: integer("completed_at", { mode: "timestamp" }),
	},
	(t) => [
		index("external_sync_jobs_due_idx").on(t.status, t.nextAttemptAt),
		index("external_sync_jobs_account_status_idx").on(t.accountId, t.status),
	],
);

export const externalOriginals = sqliteTable(
	"external_originals",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull().references(() => externalAccounts.id, { onDelete: "cascade" }),
		remoteMessageId: text("remote_message_id").notNull(),
		lumimailMessageId: text("lumimail_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
		r2Key: text("r2_key").notNull(),
		sha256: text("sha256").notNull(),
		size: integer("size").notNull(),
		retainedAt: integer("retained_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("external_originals_account_remote_idx").on(t.accountId, t.remoteMessageId),
		uniqueIndex("external_originals_message_idx").on(t.lumimailMessageId),
	],
);

export const pushDevices = sqliteTable(
	"push_devices",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
		approvingSessionId: text("approving_session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		endpoint: text("endpoint").notNull(),
		endpointHash: text("endpoint_hash").notNull(),
		p256dh: text("p256dh").notNull(),
		auth: text("auth").notNull(),
		status: text("status", { enum: ["active", "revoked", "expired"] }).notNull().default("active"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		lastDeliveredAt: integer("last_delivered_at", { mode: "timestamp" }),
		revokedAt: integer("revoked_at", { mode: "timestamp" }),
		expiredAt: integer("expired_at", { mode: "timestamp" }),
	},
	(t) => [
		uniqueIndex("push_devices_endpoint_hash_idx").on(t.endpointHash).where(sql`${t.status} = 'active'`),
		uniqueIndex("push_devices_active_session_idx").on(t.approvingSessionId).where(sql`${t.status} = 'active'`),
		index("push_devices_user_org_status_idx").on(t.userId, t.organizationId, t.status),
		index("push_devices_cleanup_idx").on(t.status, t.revokedAt, t.expiredAt),
	],
);

export const pushDeviceMailboxes = sqliteTable(
	"push_device_mailboxes",
	{
		deviceId: text("device_id").notNull().references(() => pushDevices.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("push_device_mailboxes_pair_idx").on(t.deviceId, t.mailboxId),
		index("push_device_mailboxes_mailbox_idx").on(t.mailboxId, t.deviceId),
	],
);

export const pushNotificationEvents = sqliteTable(
	"push_notification_events",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
		mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
		messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
		status: text("status", { enum: ["pending", "expanding", "complete", "failed"] }).notNull().default("pending"),
		expansionCursor: text("expansion_cursor"),
		attempts: integer("attempts").notNull().default(0),
		nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }).notNull(),
		leaseUntil: integer("lease_until", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		completedAt: integer("completed_at", { mode: "timestamp" }),
	},
	(t) => [
		uniqueIndex("push_notification_events_message_idx").on(t.messageId),
		index("push_notification_events_due_idx").on(t.status, t.nextAttemptAt),
	],
);

export const pushDeliveries = sqliteTable(
	"push_deliveries",
	{
		id: text("id").primaryKey(),
		eventId: text("event_id").notNull().references(() => pushNotificationEvents.id, { onDelete: "cascade" }),
		deviceId: text("device_id").notNull().references(() => pushDevices.id, { onDelete: "cascade" }),
		status: text("status", { enum: ["pending", "delivering", "delivered", "skipped", "failed"] }).notNull().default("pending"),
		attempts: integer("attempts").notNull().default(0),
		nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }).notNull(),
		leaseUntil: integer("lease_until", { mode: "timestamp" }),
		providerOutcome: text("provider_outcome"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
		deliveredAt: integer("delivered_at", { mode: "timestamp" }),
		terminalAt: integer("terminal_at", { mode: "timestamp" }),
	},
	(t) => [
		uniqueIndex("push_deliveries_event_device_idx").on(t.eventId, t.deviceId),
		index("push_deliveries_due_idx").on(t.status, t.nextAttemptAt),
		index("push_deliveries_cleanup_idx").on(t.status, t.terminalAt),
	],
);

export const securityAuditEvents = sqliteTable(
	"security_audit_events",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
		actorUserId: text("actor_user_id").notNull(),
		action: text("action", { enum: [
			"session.revoke", "session.revoke_others", "mailbox.grant_bulk",
			"mcp.authorize", "mcp.revoke", "mcp.mutate",
			"push.register", "push.rename", "push.preferences", "push.revoke",
		] }).notNull(),
		resourceType: text("resource_type", { enum: [
			"session", "mailbox_membership", "mcp_connection", "push_device",
		] }).notNull(),
		resourceId: text("resource_id"),
		affectedCount: integer("affected_count").notNull(),
		requestId: text("request_id").notNull(),
		outcome: text("outcome", { enum: ["succeeded"] }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		index("security_audit_events_org_created_idx").on(t.organizationId, t.createdAt),
		uniqueIndex("security_audit_events_request_idx").on(t.requestId),
	],
);

export const operationalEvidence = sqliteTable(
	"operational_evidence",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
		actorUserId: text("actor_user_id").notNull(),
		category: text("category", { enum: ["recovery", "release", "smoke", "mail_flow"] }).notNull(),
		outcome: text("outcome", { enum: ["passed", "failed"] }).notNull(),
		passedChecks: integer("passed_checks").notNull(),
		totalChecks: integer("total_checks").notNull(),
		observedAt: integer("observed_at", { mode: "timestamp" }).notNull(),
		recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("operational_evidence_org_category_observed_idx").on(t.organizationId, t.category, t.observedAt),
		index("operational_evidence_org_recorded_idx").on(t.organizationId, t.recordedAt),
	],
);

export const labels = sqliteTable(
	"labels",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color").notNull().default(DEFAULT_LABEL_COLOR),
		/**
		 * One level of nesting (F75). `set null` promotes children to top level
		 * when their parent is deleted, so a delete never strands rows. Depth and
		 * cycle rules are enforced in the route handler — SQLite cannot express
		 * "the parent must itself have no parent" as a constraint.
		 */
		parentId: text("parent_id").references((): AnySQLiteColumn => labels.id, {
			onDelete: "set null",
		}),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex("labels_user_name_idx").on(t.userId, t.name),
		index("labels_user_parent_idx").on(t.userId, t.parentId),
	],
);

export const messageLabels = sqliteTable(
	"message_labels",
	{
		messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
		labelId: text("label_id").notNull().references(() => labels.id, { onDelete: "cascade" }),
	},
	(t) => [uniqueIndex("message_labels_pk").on(t.messageId, t.labelId)],
);

export const attachments = sqliteTable("attachments", {
	id: text("id").primaryKey(),
	messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
	filename: text("filename").notNull(),
	contentType: text("content_type").notNull(),
	size: integer("size").notNull(),
	r2Key: text("r2_key").notNull(),
	disposition: text("disposition", { enum: ["attachment", "inline"] }).notNull().default("attachment"),
	contentId: text("content_id"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (t) => [index("attachments_message_idx").on(t.messageId)]);

export const messageFilters = sqliteTable("message_filters", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	fromContains: text("from_contains"),
	toContains: text("to_contains"),
	subjectContains: text("subject_contains"),
	hasWords: text("has_words"),
	actionStar: integer("action_star", { mode: "boolean" }).notNull().default(false),
	actionMarkRead: integer("action_mark_read", { mode: "boolean" }).notNull().default(false),
	actionArchive: integer("action_archive", { mode: "boolean" }).notNull().default(false),
	actionLabelId: text("action_label_id").references(() => labels.id, { onDelete: "set null" }),
	actionMoveToTrash: integer("action_move_to_trash", { mode: "boolean" }).notNull().default(false),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (t) => [index("message_filters_user_idx").on(t.userId)]);

/**
 * One row per correspondent a mailbox's responder has answered, so a repeat sender
 * is told once per window rather than once per message (F64). Keyed by mailbox so
 * two mailboxes do not share one correspondent's window (F65).
 */
export const vacationReplyLog = sqliteTable(
	"vacation_reply_log",
	{
		id: text("id").primaryKey(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailboxes.id, { onDelete: "cascade" }),
		senderAddress: text("sender_address").notNull(),
		lastRepliedAt: integer("last_replied_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [
		uniqueIndex("vacation_reply_log_mailbox_sender_idx").on(t.mailboxId, t.senderAddress),
	],
);

/**
 * One responder per mailbox, not per user (F65).
 *
 * Inbound delivery answers on behalf of the mailbox that received the message, so
 * keying by user meant a user with several mailboxes could not leave one staffed,
 * and on a shared mailbox only the owner's responder had any effect — a member's
 * setting was a silent no-op. `userId` records who last configured it.
 */
export const vacationResponders = sqliteTable("vacation_responders", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	mailboxId: text("mailbox_id")
		.notNull()
		.references(() => mailboxes.id, { onDelete: "cascade" })
		.unique(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
	subject: text("subject").notNull().default("Out of office"),
	body: text("body").notNull().default("I am currently out of office and will reply when I return."),
	startDate: integer("start_date", { mode: "timestamp" }),
	endDate: integer("end_date", { mode: "timestamp" }),
	/**
	 * Audience restrictions (F64). Both false means reply to everyone. When either
	 * is set, a sender must match at least one enabled audience — they combine as
	 * OR, so "contacts plus colleagues" is expressible.
	 */
	replyToContacts: integer("reply_to_contacts", { mode: "boolean" }).notNull().default(false),
	replyToOrganization: integer("reply_to_organization", { mode: "boolean" }).notNull().default(false),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type Mailbox = typeof mailboxes.$inferSelect;
export type MailboxMembership = typeof mailboxMemberships.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type OrgInvite = typeof orgInvites.$inferSelect;
export type Alias = typeof aliases.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type McpConnection = typeof mcpConnections.$inferSelect;
export type PushDevice = typeof pushDevices.$inferSelect;
export type ExternalAccount = typeof externalAccounts.$inferSelect;

export const schema = {
	organizations,
	organizationMembers,
	orgInvites,
	users,
	domains,
	mailboxes,
	mailboxMemberships,
	aliases,
	groupMembers,
	forwardingDestinations,
	passwordResetTokens,
	rateLimits,
	contacts,
	apiKeys,
	messages,
	imapUidCounter,
	messageBodies,
	outboundJobs,
	queueHealthSnapshots,
	routingRules,
	webhooks,
	webhookDeliveries,
	sessions,
	securityAuditEvents,
	operationalEvidence,
	mcpConnections,
	outboundIdempotency,
	oauthRefreshTokenUses,
	externalAccounts,
	externalOauthStates,
	externalSyncCursors,
	externalMessages,
	externalSyncJobs,
	externalOriginals,
	pushDevices,
	pushDeviceMailboxes,
	pushNotificationEvents,
	pushDeliveries,
	labels,
	messageLabels,
	attachments,
	messageFilters,
	vacationResponders,
	vacationReplyLog,
};
