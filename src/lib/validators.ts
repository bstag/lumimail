import { z } from "zod";

export const sendEmailSchema = z.object({
	from: z.string().min(3),
	to: z.string().min(3),
	subject: z.string().min(1).max(500),
	html: z.string().optional(),
	text: z.string().optional(),
	mailboxId: z.string().optional(),
});

export const registerSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8),
	name: z.string().min(1),
});

export const firstRunRegisterSchema = z.object({
	domain: z.string().min(3),
	username: z.string().min(1).max(64).regex(/^[a-zA-Z0-9._%+-]+$/),
	password: z.string().min(8),
	resetEmail: z.string().email(),
});

export const primaryDomainRegisterSchema = z.object({
	username: z.string().min(1).max(64).regex(/^[a-zA-Z0-9._%+-]+$/),
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
	role: z.enum(["admin", "member"]),
});

export const setupDomainSchema = z.object({
	hostname: z.string().regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/),
});

export const addDomainSchema = z.object({
	hostname: z.string().regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/),
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

export const domainSchema = z.object({
	hostname: z.string().min(3),
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
	role: z.enum(["viewer", "responder", "manager"]),
});

export const updateMailboxMembershipSchema = z.object({
	role: z.enum(["viewer", "responder", "manager"]),
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
	action: z.enum(["store", "forward", "reject"]),
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
	action: z.enum(["store", "forward", "reject"]).optional(),
	mailboxId: z.string().nullable().optional(),
	forwardTo: z.string().email().nullable().optional(),
	priority: z.number().int().optional(),
});

export const webhookSchema = z.object({
	url: z.string().url(),
	events: z.array(z.string()).min(1),
});

export const createAliasSchema = z.object({
	domainId: z.string().min(1),
	localPart: z.string().min(1).max(64).regex(/^[a-zA-Z0-9._+-]+$/),
	targetMailboxId: z.string().optional(),
	forwardTo: z.string().email().optional(),
	isGroup: z.boolean().default(false),
});

export const createLabelSchema = z.object({
	name: z.string().trim().min(1).max(50),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
});

export const updateLabelSchema = z.object({
	name: z.string().trim().min(1).max(50).optional(),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
