import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, mailboxMemberships, mailboxes } from "@/db/schema";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { getEnv } from "@/lib/cloudflare";

export async function GET(request: Request) {
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const organizationId = orgUser.organizationId as string;
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

	return Response.json({
		mailboxes: rows.map((row) => ({
			...row,
			isPrimary: `${row.localPart}@${row.hostname}` === orgUser.email,
		})),
		canSelfAssign: orgUser.role === "owner",
		currentUserId: orgUser.id,
	});
}
