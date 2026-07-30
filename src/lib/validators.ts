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

export const sendEmailSchema = z.object({
	from: z.string().min(3),
	to: z.string().min(3),
	subject: z.string().min(1).max(500),
	replyToMessageId: z.string().trim().min(1).max(100).optional(),
	html: z.string().optional(),
	text: z.string().optional(),
	mailboxId: z.string().optional(),
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

export const createLabelSchema = z.object({
	name: z.string().trim().min(1).max(50),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default(DEFAULT_LABEL_COLOR),
});

export const updateLabelSchema = z.object({
	name: z.string().trim().min(1).max(50).optional(),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
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
