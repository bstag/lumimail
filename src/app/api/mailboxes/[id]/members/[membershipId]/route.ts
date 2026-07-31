import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxMemberships } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { getMailboxAccess } from "@/lib/auth/mailbox-access";
import { updateMailboxMembershipSchema } from "@/lib/validators";

type MembershipParams = { id: string; membershipId: string };

async function managerCount(db: ReturnType<typeof getDb>, mailboxId: string): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(mailboxMemberships)
		.where(and(eq(mailboxMemberships.mailboxId, mailboxId), eq(mailboxMemberships.role, "manager")));
	return row?.value ?? 0;
}

export const PATCH = withUser<MembershipParams>(async ({ request, env, user, params }) => {
	const { id: mailboxId, membershipId } = params;
	if (!user.organizationId) return apiError("Mailbox membership not found", 404);

	const parsed = updateMailboxMembershipSchema.safeParse(await request.json());
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	const db = getDb(env);
	const access = await getMailboxAccess(db, user.id, user.organizationId, mailboxId);
	if (access?.role !== "manager") return apiError("Mailbox membership not found", 404);

	const [membership] = await db
		.select({ id: mailboxMemberships.id, role: mailboxMemberships.role })
		.from(mailboxMemberships)
		.where(and(eq(mailboxMemberships.id, membershipId), eq(mailboxMemberships.mailboxId, mailboxId)))
		.limit(1);
	if (!membership) return apiError("Mailbox membership not found", 404);

	if (
		membership.role === "manager"
		&& parsed.data.role !== "manager"
		&& await managerCount(db, mailboxId) <= 1
	) {
		return apiError("A mailbox must retain at least one manager", 409);
	}

	await db
		.update(mailboxMemberships)
		.set({ role: parsed.data.role, updatedAt: new Date() })
		.where(eq(mailboxMemberships.id, membershipId));
	return apiSuccess({ id: membershipId, role: parsed.data.role });
});

export const DELETE = withUser<MembershipParams>(async ({ env, user, params }) => {
	const { id: mailboxId, membershipId } = params;
	if (!user.organizationId) return apiError("Mailbox membership not found", 404);

	const db = getDb(env);
	const access = await getMailboxAccess(db, user.id, user.organizationId, mailboxId);
	if (access?.role !== "manager") return apiError("Mailbox membership not found", 404);

	const [membership] = await db
		.select({ id: mailboxMemberships.id, role: mailboxMemberships.role })
		.from(mailboxMemberships)
		.where(and(eq(mailboxMemberships.id, membershipId), eq(mailboxMemberships.mailboxId, mailboxId)))
		.limit(1);
	if (!membership) return apiError("Mailbox membership not found", 404);

	if (membership.role === "manager" && await managerCount(db, mailboxId) <= 1) {
		return apiError("A mailbox must retain at least one manager", 409);
	}

	await db.delete(mailboxMemberships).where(eq(mailboxMemberships.id, membershipId));
	return apiSuccess({ ok: true });
});
