import { z } from "zod";
import {
	DEFAULT_LABEL_COLOR,
	DOMAIN_HOSTNAME_REGEX,
	MAILBOX_ROLES,
	ORG_INVITE_ROLES,
	ROUTING_ACTIONS,
} from "@/lib/constants";

// Registration usernames allow `%` (full RFC-style local-part charset); alias
// local parts forbid it (see aliasLocalPart below). The divergence is preserved
// as-is pending a product decision on one canonical local-part rule.
const registrationUsername = z.string().min(1).max(64).regex(/^[a-zA-Z0-9._%+-]+$/);

export const externalAccountConnectSchema = z.object({
	provider: z.enum(["google", "microsoft"]),
	mailboxId: z.string().trim().min(1).max(100),
	importMode: z.enum(["from_now", "recent_30_days"]),
	retainOriginal: z.boolean(),
}).strict();

export const externalAccountUpdateSchema = z.object({
	status: z.enum(["active", "paused"]).optional(),
	retainOriginal: z.literal(true).optional(),
}).strict().refine((value) => value.status !== undefined || value.retainOriginal === true, {
	message: "At least one external account change is required",
});

export const pushDeviceNameSchema = z.string().trim().min(1).max(64);

const PUSH_ENDPOINT_HOSTS = new Set([
	"fcm.googleapis.com",
	"push.services.mozilla.com",
	"updates.push.services.mozilla.com",
	"web.push.apple.com",
]);

function isRecognizedPushEndpoint(value: string): boolean {
	try {
		const url = new URL(value);
		return value.length <= 2048
			&& url.protocol === "https:"
			&& (url.port === "" || url.port === "443")
			&& url.username === ""
			&& url.password === ""
			&& url.hash === ""
			&& (PUSH_ENDPOINT_HOSTS.has(url.hostname)
				|| /^[a-z0-9-]+\.notify\.windows\.com$/i.test(url.hostname));
	} catch {
		return false;
	}
}

function hasDecodedBase64UrlLength(value: string, expectedBytes: number): boolean {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
	try {
		const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
		return atob(padded).length === expectedBytes;
	} catch {
		return false;
	}
}

const pushP256dhSchema = z.string().max(128).refine(
	(value) => hasDecodedBase64UrlLength(value, 65),
	"p256dh must be a 65-byte URL-safe base64 P-256 public key",
);
export const pushVapidPublicKeySchema = pushP256dhSchema;
const pushAuthSchema = z.string().max(64).refine(
	(value) => hasDecodedBase64UrlLength(value, 16),
	"auth must be a 16-byte URL-safe base64 secret",
);

export const pushSubscriptionSchema = z.object({
	endpoint: z.string().refine(isRecognizedPushEndpoint, "Unrecognized Web Push endpoint"),
	keys: z.object({
		p256dh: pushP256dhSchema,
		auth: pushAuthSchema,
	}).strict(),
}).strict();

export const pushDeviceCreateSchema = z.object({
	name: pushDeviceNameSchema,
	subscription: pushSubscriptionSchema,
}).strict();

export const pushDeviceRenameSchema = z.object({
	name: pushDeviceNameSchema,
}).strict();

export const pushDevicePreferencesSchema = z.object({
	mailboxIds: z.array(z.string().trim().min(1).max(100)).max(50),
}).strict().superRefine((value, ctx) => {
	if (new Set(value.mailboxIds).size !== value.mailboxIds.length) {
		ctx.addIssue({
			code: "custom",
			path: ["mailboxIds"],
			message: "Mailbox IDs must be unique",
		});
	}
});

export const sendEmailSchema = z.object({
	from: z.string().min(3),
	to: z.string().min(3),
	subject: z.string().min(1).max(500),
	replyToMessageId: z.string().trim().min(1).max(100).optional(),
	html: z.string().optional(),
	text: z.string().optional(),
	mailboxId: z.string().optional(),
	externalAccountId: z.string().trim().min(1).max(100).optional(),
});

export const firstRunRegisterSchema = z.object({
	domain: z.string().min(3),
	username: registrationUsername,
	password: z.string().min(8),
	resetEmail: z.string().email(),
});

export const inviteRegisterSchema = z.object({
	inviteToken: z.string().trim().min(1),
	password: z.string().min(8),
	resetEmail: z.string().trim().toLowerCase().email(),
});

export const organizationInviteSchema = z.object({
	email: z.string().trim().toLowerCase().email(),
	role: z.enum(ORG_INVITE_ROLES),
});

export const setupDomainSchema = z.object({
	hostname: z.string().regex(DOMAIN_HOSTNAME_REGEX),
});

export const addDomainSchema = z.object({
	hostname: z.string().regex(DOMAIN_HOSTNAME_REGEX),
	enableRouting: z.boolean().optional(),
	enableSending: z.boolean().optional(),
});

export const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

export const reconfirmPasswordSchema = z.object({
	password: z.string().min(1),
});

export const operationalEvidenceSchema = z.object({
	format: z.literal("lumimail-operations-evidence-v1"),
	category: z.enum(["recovery", "release", "smoke", "mail_flow"]),
	outcome: z.enum(["passed", "failed"]),
	passedChecks: z.number().int().min(0).max(1000),
	totalChecks: z.number().int().min(1).max(1000),
	observedAt: z.string().datetime(),
}).strict().superRefine((value, ctx) => {
	if (value.passedChecks > value.totalChecks) {
		ctx.addIssue({ code: "custom", path: ["passedChecks"], message: "Passed checks cannot exceed total checks" });
	}
	if (value.outcome === "passed" && value.passedChecks !== value.totalChecks) {
		ctx.addIssue({ code: "custom", path: ["outcome"], message: "Passed evidence requires every check to pass" });
	}
	if (value.outcome === "failed" && value.passedChecks >= value.totalChecks) {
		ctx.addIssue({ code: "custom", path: ["outcome"], message: "Failed evidence requires at least one failed check" });
	}
});

const rfcMessageIdSchema = z.string().trim().min(3).max(998).regex(/^<[^<>\r\n]+>$/);

export const mailFlowEvidenceProofSchema = z.object({
	format: z.literal("lumimail-mail-flow-proof-v1"),
	deliveredMessageId: rfcMessageIdSchema,
	deliveredInReplyTo: rfcMessageIdSchema,
	deliveredReferences: z.string().trim().min(3).max(2048),
	observedAt: z.string().datetime(),
}).strict();

export const forgotPasswordSchema = z.object({
	email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
	token: z.string().trim().min(1),
	email: z.string().trim().toLowerCase().email(),
	newPassword: z.string().min(8),
});

export const mailboxSchema = z.object({
	domainId: z.string().min(1),
	localPart: z.string().min(1).max(64),
	displayName: z.string().optional(),
});

export const updateMailboxSchema = z.object({
	displayName: z.string().max(100).nullable().optional(),
});

export const mailboxMembershipSchema = z.object({
	userId: z.string().min(1),
	role: z.enum(MAILBOX_ROLES),
});

export const updateMailboxMembershipSchema = z.object({
	role: z.enum(MAILBOX_ROLES),
});

export const bulkMailboxGrantSchema = z.object({
	targetUserId: z.string().min(1).max(100),
	mailboxIds: z.array(z.string().min(1).max(100)).min(1).max(25),
	role: z.enum(MAILBOX_ROLES),
}).strict().superRefine((value, ctx) => {
	if (new Set(value.mailboxIds).size !== value.mailboxIds.length) {
		ctx.addIssue({
			code: "custom",
			path: ["mailboxIds"],
			message: "Mailbox IDs must be unique",
		});
	}
});

export const updateProfileSchema = z.object({
	name: z.string().trim().min(1).max(100),
	resetEmail: z.preprocess(
		(value) => (typeof value === "string" ? value.trim() : value),
		z.string().email().or(z.literal("")).transform((value) => value || null),
	),
});

const routingRuleFields = z.object({
	domainId: z.string().min(1),
	pattern: z.string().min(1),
	action: z.enum(ROUTING_ACTIONS),
	mailboxId: z.string().nullable().optional(),
	forwardTo: z.string().email().nullable().optional(),
	priority: z.number().int().default(0),
});

function validateRoutingRuleTarget(
	data: z.infer<typeof routingRuleFields>,
	ctx: z.RefinementCtx,
) {
	if (data.action === "store" && !data.mailboxId) {
		ctx.addIssue({ code: "custom", path: ["mailboxId"], message: "Store rules require a target mailbox" });
	}
	if (data.action === "forward" && !data.forwardTo) {
		ctx.addIssue({ code: "custom", path: ["forwardTo"], message: "Forward rules require a destination" });
	}
}

export const routingRuleSchema = routingRuleFields.superRefine(validateRoutingRuleTarget);
export const routingRuleUpdateSchema = z.object({
	pattern: z.string().min(1).optional(),
	action: z.enum(ROUTING_ACTIONS).optional(),
	mailboxId: z.string().nullable().optional(),
	forwardTo: z.string().email().nullable().optional(),
	priority: z.number().int().optional(),
});

export const webhookSchema = z.object({
	url: z.string().url(),
	events: z.array(z.string()).min(1),
});

// Alias local parts forbid `%`, which registration usernames allow (see
// registrationUsername above). The divergence is preserved as-is pending a
// product decision on one canonical local-part rule.
const aliasLocalPart = z.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[a-zA-Z0-9._+-]+$/)
	.transform((value) => value.toLowerCase());

const mailboxAliasSchema = z.object({
	kind: z.literal("mailbox"),
	domainId: z.string().min(1),
	localPart: aliasLocalPart,
	targetMailboxId: z.string().min(1),
}).strict();

const groupAliasSchema = z.object({
	kind: z.literal("group"),
	domainId: z.string().min(1),
	localPart: aliasLocalPart,
	mailboxIds: z.array(z.string().min(1)).min(2).max(50),
}).strict().superRefine((value, ctx) => {
	if (new Set(value.mailboxIds).size !== value.mailboxIds.length) {
		ctx.addIssue({
			code: "custom",
			path: ["mailboxIds"],
			message: "Group mailbox IDs must be unique",
		});
	}
});

export const createAliasSchema = z.discriminatedUnion("kind", [
	mailboxAliasSchema,
	groupAliasSchema,
]);

export const updateAliasGroupSchema = z.object({
	mailboxIds: z.array(z.string().min(1)).min(2).max(50),
}).strict().superRefine((value, ctx) => {
	if (new Set(value.mailboxIds).size !== value.mailboxIds.length) {
		ctx.addIssue({
			code: "custom",
			path: ["mailboxIds"],
			message: "Group mailbox IDs must be unique",
		});
	}
});

// Depth and cycle rules for `parentId` need database reads, so they live in
// `src/app/api/labels/utils.ts` rather than here. Zod only checks the shape.
export const createLabelSchema = z.object({
	name: z.string().trim().min(1).max(50),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default(DEFAULT_LABEL_COLOR),
	parentId: z.string().nullable().optional(),
});

export const updateLabelSchema = z.object({
	name: z.string().trim().min(1).max(50).optional(),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
	parentId: z.string().nullable().optional(),
});

export const createContactSchema = z.object({
	email: z.string().email(),
	displayName: z.string().min(1).max(200).optional(),
});

export const createFilterSchema = z.object({
	name: z.string().trim().min(1).max(100),
	fromContains: z.string().optional(),
	toContains: z.string().optional(),
	subjectContains: z.string().optional(),
	hasWords: z.string().optional(),
	actionStar: z.boolean().default(false),
	actionMarkRead: z.boolean().default(false),
	actionArchive: z.boolean().default(false),
	actionLabelId: z.string().optional(),
	actionMoveToTrash: z.boolean().default(false),
});

const categoryTagSchema = z.string().trim().min(1).max(80);
const questionBase = {
	key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
	name: z.string().trim().min(1).max(100),
	instructions: z.string().trim().min(1).max(2000),
	enabled: z.boolean(),
	threshold: z.number().min(0.5).max(1),
};
const categoryOptionSchema = z
	.object({
		value: z.string().trim().min(1).max(80),
		description: z.string().trim().min(1).max(500),
		tag: categoryTagSchema.nullable(),
	})
	.strict();
const categoryQuestionSchema = z.discriminatedUnion("type", [
	z
		.object({
			...questionBase,
			type: z.literal("choice"),
			options: z.array(categoryOptionSchema).min(2).max(20),
		})
		.strict(),
	z
		.object({
			...questionBase,
			type: z.literal("noul"),
			tag: categoryTagSchema.nullable(),
		})
		.strict(),
	z
		.object({
			...questionBase,
			type: z.literal("score"),
			levels: z.array(z.string().trim().min(1).max(500)).min(2).max(10),
		})
		.strict(),
]);
export const categoryRuleSchema = z
	.object({
		id: z.string().min(1).max(80),
		name: z.string().trim().min(1).max(100),
		enabled: z.boolean(),
		senderMode: z.enum(["exact", "domain"]),
		sender: z.string().trim().max(254),
		subject: z.string().trim().max(200),
		words: z.string().trim().max(200),
		tag: categoryTagSchema,
	})
	.strict()
	.refine(
		(r) => Boolean(r.sender || r.subject || r.words),
		"A rule needs a condition",
	)
	.refine(
		(r) =>
			!r.sender ||
			(r.senderMode === "exact"
				? /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(r.sender)
				: /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(r.sender)),
		"Use an email address or exact domain",
	);
export const categorizationConfigSchema = z
	.object({
		model: z.string().regex(/^jev-(?:\d+\.\d+\.\d+|latest)$/),
		questions: z.array(categoryQuestionSchema).max(8),
		rules: z.array(categoryRuleSchema).max(20),
	})
	.strict()
	.superRefine((config, ctx) => {
		const unique = (values: string[]) => new Set(values).size === values.length;
		if (
			!unique(config.questions.map((q) => q.key)) ||
			!unique(config.rules.map((r) => r.id))
		)
			ctx.addIssue({
				code: "custom",
				message: "Question keys and rule IDs must be unique",
			});
		config.questions.forEach((q, i) => {
			if (q.type === "choice" && !unique(q.options.map((o) => o.value)))
				ctx.addIssue({
					code: "custom",
					path: ["questions", i],
					message: "Answer values must be unique",
				});
		});
	});
export const activateCategorizationSchema = z
	.object({
		config: categorizationConfigSchema,
		expectedVersion: z.string().nullable(),
		automatic: z.boolean(),
		consent: z.boolean(),
	})
	.strict();
export const previewCategorizationSchema = z
	.object({
		config: categorizationConfigSchema,
		mailboxId: z.string().min(1).nullable(),
		consent: z.literal(true),
	})
	.strict();
export const categorizationJobSchema = z
	.object({ mailboxId: z.string().min(1).nullable() })
	.strict();
export const categorizationCorrectionSchema = z
	.object({
		messageId: z.string().min(1),
		tags: z.array(categoryTagSchema).max(30).nullable(),
	})
	.strict();
export const categorizationRunSchema = z
	.object({ retry: z.boolean() })
	.strict();
export const categorizationCancelSchema = z
	.object({ cancel: z.literal(true) })
	.strict();
export const mailInsightsQuerySchema = z.object({
	days: z.enum(["7", "30", "90"]).default("30").transform(Number),
	offset: z
		.string()
		.regex(/^\d{1,6}$/)
		.default("0")
		.transform(Number),
	mailboxId: z
		.string()
		.min(1)
		.optional()
		.transform((v) => v ?? null),
	sender: z
		.string()
		.trim()
		.min(1)
		.max(254)
		.optional()
		.transform((v) => v ?? null),
});

export const vacationResponderSchema = z.object({
	mailboxId: z.string().min(1),
	enabled: z.boolean(),
	subject: z.string().min(1).max(200).optional(),
	body: z.string().min(1).max(5000).optional(),
	startDate: z.string().datetime().optional().nullable(),
	endDate: z.string().datetime().optional().nullable(),
	// Audience restrictions combine as OR; both false replies to everyone (F64).
	replyToContacts: z.boolean().optional(),
	replyToOrganization: z.boolean().optional(),
});
