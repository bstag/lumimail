import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations, organizationMembers, orgInvites, users } from "@/db/schema";
import { hashInvitationToken } from "@/lib/auth/invitation";
import { selectOutboundProvider } from "@/lib/email/providers";
import { newId } from "@/lib/ids";
import { RateLimitUnavailableError, rateLimitCheck } from "@/lib/rate-limit";

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const INVITE_COOLDOWN_MS = 60_000;
const INVITE_SUBJECT_SUFFIX = " on Lumimail";

type InviteRole = "admin" | "member";
type DeliveryStatus = "not_sent" | "sending" | "sent" | "failed";

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function headerText(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

function invitationLink(env: CloudflareEnv, token: string): string {
	let base: URL;
	try {
		base = new URL(env.PUBLIC_APP_URL ?? "");
	} catch {
		throw new Error("PUBLIC_APP_URL must be a valid HTTPS URL");
	}
	if (base.protocol !== "https:") throw new Error("PUBLIC_APP_URL must be a valid HTTPS URL");
	const link = new URL("/register", base);
	link.searchParams.set("token", token);
	return link.toString();
}

async function sendInvitation(
	env: CloudflareEnv,
	input: { email: string; organizationName: string; role: InviteRole; token: string },
): Promise<void> {
	const from = env.PASSWORD_RESET_FROM?.trim();
	if (!from) throw new Error("PASSWORD_RESET_FROM is required");
	const link = invitationLink(env, input.token);
	const safeLink = escapeHtml(link);
	const safeOrg = escapeHtml(input.organizationName);
	const safeRole = escapeHtml(input.role);
	await selectOutboundProvider(env).send({
		from,
		to: input.email,
		subject: `You're invited to ${headerText(input.organizationName)}${INVITE_SUBJECT_SUFFIX}`,
		text: `You've been invited to join ${input.organizationName} as ${input.role}.\n\nAccept invitation: ${link}\n\nThis link expires in seven days.`,
		html: `<p>You've been invited to join <strong>${safeOrg}</strong> as ${safeRole}.</p><p><a href="${safeLink}">Accept invitation</a></p><p>This link expires in seven days.</p>`,
	});
}

async function finishDelivery(
	env: CloudflareEnv,
	inviteId: string,
	input: { email: string; organizationName: string; role: InviteRole; token: string },
	now: Date,
): Promise<DeliveryStatus> {
	const db = getDb(env);
	try {
		await sendInvitation(env, input);
	} catch {
		try {
			await db.update(orgInvites).set({ deliveryStatus: "failed" }).where(eq(orgInvites.id, inviteId));
			return "failed";
		} catch {
			console.error(JSON.stringify({ message: "invitation delivery status update failed", inviteId }));
			return "sending";
		}
	}
	try {
		await db.update(orgInvites).set({ deliveryStatus: "sent", lastDeliveredAt: now }).where(eq(orgInvites.id, inviteId));
		return "sent";
	} catch {
		console.error(JSON.stringify({ message: "invitation delivery status update failed", inviteId }));
		return "sending";
	}
}

export async function listOrganizationInvitations(env: CloudflareEnv, organizationId: string, now = new Date()) {
	const rows = await getDb(env)
		.select({
			id: orgInvites.id,
			email: orgInvites.email,
			role: orgInvites.role,
			expiresAt: orgInvites.expiresAt,
			createdAt: orgInvites.createdAt,
			deliveryStatus: orgInvites.deliveryStatus,
			lastDeliveryAttemptAt: orgInvites.lastDeliveryAttemptAt,
			lastDeliveredAt: orgInvites.lastDeliveredAt,
			acceptedAt: orgInvites.acceptedAt,
		})
		.from(orgInvites)
		.where(eq(orgInvites.organizationId, organizationId))
		.orderBy(desc(orgInvites.createdAt), desc(orgInvites.id))
		.limit(50);
	return rows.map((row) => ({
		...row,
		status: row.acceptedAt ? "accepted" as const : row.expiresAt <= now ? "expired" as const : "pending" as const,
	}));
}

export type CreateInvitationResult =
	| { status: "already-member" | "email-registered" | "rate-limited" | "unavailable" }
	| { status: "created"; inviteId: string; token: string; deliveryStatus: DeliveryStatus };

export async function createOrganizationInvitation(
	env: CloudflareEnv,
	input: { organizationId: string; email: string; role: InviteRole; now?: Date },
): Promise<CreateInvitationResult> {
	const now = input.now ?? new Date();
	const db = getDb(env);
	const [member] = await db.select({ id: organizationMembers.id })
		.from(organizationMembers).innerJoin(users, eq(organizationMembers.userId, users.id))
		.where(and(eq(organizationMembers.organizationId, input.organizationId), eq(users.email, input.email))).limit(1);
	if (member) return { status: "already-member" };
	const [registered] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
	if (registered) return { status: "email-registered" };
	const [organization] = await db.select({ name: organizations.name }).from(organizations)
		.where(eq(organizations.id, input.organizationId)).limit(1);
	if (!organization) return { status: "unavailable" };
	const [existing] = await db.select({ id: orgInvites.id }).from(orgInvites).where(and(
		eq(orgInvites.organizationId, input.organizationId),
		eq(orgInvites.email, input.email),
		isNull(orgInvites.acceptedAt),
	)).orderBy(desc(orgInvites.createdAt)).limit(1);
	try {
		const rate = await rateLimitCheck(env, `org-invite::${input.organizationId}::${input.email}`, 1, INVITE_COOLDOWN_MS, now.getTime());
		if (!rate.allowed) return { status: "rate-limited" };
	} catch (error) {
		if (error instanceof RateLimitUnavailableError) return { status: "unavailable" };
		throw error;
	}
	const token = newId("tok");
	const tokenHash = await hashInvitationToken(token);
	const expiresAt = new Date(now.getTime() + INVITE_LIFETIME_MS);
	const inviteId = existing?.id ?? newId("inv");
	if (existing) {
		const [rotated] = await db.update(orgInvites).set({
			role: input.role, token: tokenHash, expiresAt, deliveryStatus: "sending",
			lastDeliveryAttemptAt: now, lastDeliveredAt: null,
		}).where(and(
			eq(orgInvites.id, existing.id),
			eq(orgInvites.organizationId, input.organizationId),
			isNull(orgInvites.acceptedAt),
		)).returning({ id: orgInvites.id });
		if (!rotated) return { status: "unavailable" };
	} else {
		await db.insert(orgInvites).values({
			id: inviteId, organizationId: input.organizationId, email: input.email, role: input.role,
			token: tokenHash, expiresAt, createdAt: now, deliveryStatus: "sending",
			lastDeliveryAttemptAt: now,
		});
	}
	const deliveryStatus = await finishDelivery(env, inviteId, {
		email: input.email, organizationName: organization.name, role: input.role, token,
	}, now);
	return { status: "created", inviteId, token, deliveryStatus };
}

export type ResendInvitationResult =
	| { status: "not-found" | "accepted" | "rate-limited" | "unavailable" }
	| { status: "resent"; inviteId: string; token: string; deliveryStatus: DeliveryStatus };

export async function resendOrganizationInvitation(
	env: CloudflareEnv,
	input: { organizationId: string; inviteId: string; now?: Date },
): Promise<ResendInvitationResult> {
	const now = input.now ?? new Date();
	const db = getDb(env);
	const [invite] = await db.select({
		id: orgInvites.id, email: orgInvites.email, role: orgInvites.role,
		acceptedAt: orgInvites.acceptedAt, lastDeliveryAttemptAt: orgInvites.lastDeliveryAttemptAt,
		organizationName: organizations.name,
	}).from(orgInvites).innerJoin(organizations, eq(orgInvites.organizationId, organizations.id)).where(and(
		eq(orgInvites.id, input.inviteId), eq(orgInvites.organizationId, input.organizationId),
	)).limit(1);
	if (!invite) return { status: "not-found" };
	if (invite.acceptedAt) return { status: "accepted" };
	try {
		const rate = await rateLimitCheck(env, `org-invite::${input.organizationId}::${invite.email}`, 1, INVITE_COOLDOWN_MS, now.getTime());
		if (!rate.allowed) return { status: "rate-limited" };
	} catch (error) {
		if (error instanceof RateLimitUnavailableError) return { status: "unavailable" };
		throw error;
	}
	const token = newId("tok");
	const tokenHash = await hashInvitationToken(token);
	const [rotated] = await db.update(orgInvites).set({
		token: tokenHash,
		expiresAt: new Date(now.getTime() + INVITE_LIFETIME_MS),
		deliveryStatus: "sending",
		lastDeliveryAttemptAt: now,
		lastDeliveredAt: null,
	}).where(and(eq(orgInvites.id, invite.id), eq(orgInvites.organizationId, input.organizationId), isNull(orgInvites.acceptedAt)))
		.returning({ id: orgInvites.id });
	if (!rotated) return { status: "accepted" };
	const deliveryStatus = await finishDelivery(env, invite.id, {
		email: invite.email, organizationName: invite.organizationName, role: invite.role, token,
	}, now);
	return { status: "resent", inviteId: invite.id, token, deliveryStatus };
}
