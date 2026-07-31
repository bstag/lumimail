import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, mailboxMemberships, mailboxes } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";

export const GET = withOrgAdmin(async ({ env, user: orgUser }) => {
	const db = getDb(env);
	const organizationId = orgUser.organizationId;
	const rows = await db
		.select({
			id: mailboxes.id,
			userId: mailboxes.userId,
			domainId: mailboxes.domainId,
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			createdAt: mailboxes.createdAt,
			hostname: domains.hostname,
			role: mailboxMemberships.role,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(domains.id, mailboxes.domainId))
		.leftJoin(
			mailboxMemberships,
			and(
				eq(mailboxMemberships.mailboxId, mailboxes.id),
				eq(mailboxMemberships.userId, orgUser.id),
			),
		)
		.where(eq(mailboxes.organizationId, organizationId));

	return apiSuccess({
		mailboxes: rows.map((row) => ({
			...row,
			isPrimary: `${row.localPart}@${row.hostname}` === orgUser.email,
		})),
		canSelfAssign: orgUser.role === "owner",
		currentUserId: orgUser.id,
	});
});
