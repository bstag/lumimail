import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxMemberships, organizationMembers, users } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { getMailboxAccess } from "@/lib/auth/mailbox-access";
import { newId } from "@/lib/ids";
import { mailboxMembershipSchema } from "@/lib/validators";

export const GET = withUser<{ id: string }>(async ({ env, user, params }) => {
	const { id: mailboxId } = params;
	if (!user.organizationId) return apiError("Mailbox not found", 404);

	const db = getDb(env);
	const access = await getMailboxAccess(db, user.id, user.organizationId, mailboxId);
	if (access?.role !== "manager") return apiError("Mailbox not found", 404);

	const members = await db
		.select({
			id: mailboxMemberships.id,
			userId: mailboxMemberships.userId,
			name: users.name,
			email: users.email,
			role: mailboxMemberships.role,
			createdAt: mailboxMemberships.createdAt,
			updatedAt: mailboxMemberships.updatedAt,
		})
		.from(mailboxMemberships)
		.innerJoin(users, eq(users.id, mailboxMemberships.userId))
		.where(eq(mailboxMemberships.mailboxId, mailboxId));
	const workspaceMembers = await db
		.select({ userId: users.id, name: users.name, email: users.email })
		.from(organizationMembers)
		.innerJoin(users, eq(users.id, organizationMembers.userId))
		.where(eq(organizationMembers.organizationId, user.organizationId));

	return apiSuccess({ members, workspaceMembers });
});

export const POST = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	const { id: mailboxId } = params;
	if (!user.organizationId) return apiError("Mailbox not found", 404);

	const parsed = mailboxMembershipSchema.safeParse(await request.json());
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	const db = getDb(env);
	const access = await getMailboxAccess(db, user.id, user.organizationId, mailboxId);
	if (access?.role !== "manager") {
		if (parsed.data.userId !== user.id || parsed.data.role !== "manager") {
			return apiError("Mailbox not found", 404);
		}
		const [owner] = await db
			.select({ role: organizationMembers.role })
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.organizationId, user.organizationId),
					eq(organizationMembers.userId, user.id),
					eq(organizationMembers.role, "owner"),
				),
			)
			.limit(1);
		if (!owner) return apiError("Mailbox not found", 404);
	}

	const [organizationMember] = await db
		.select({ userId: organizationMembers.userId })
		.from(organizationMembers)
		.where(
			and(
				eq(organizationMembers.organizationId, user.organizationId),
				eq(organizationMembers.userId, parsed.data.userId),
			),
		)
		.limit(1);
	if (!organizationMember) return apiError("Mailbox not found", 404);

	const [existing] = await db
		.select({ id: mailboxMemberships.id })
		.from(mailboxMemberships)
		.where(
			and(
				eq(mailboxMemberships.mailboxId, mailboxId),
				eq(mailboxMemberships.userId, parsed.data.userId),
			),
		)
		.limit(1);
	if (existing) return apiError("Mailbox membership already exists", 409);

	const membershipId = newId("mbm");
	await db.insert(mailboxMemberships).values({
		id: membershipId,
		mailboxId,
		userId: parsed.data.userId,
		role: parsed.data.role,
	});

	return apiSuccess({ id: membershipId });
});
