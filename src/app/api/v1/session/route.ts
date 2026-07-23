import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, mailboxMemberships, mailboxes } from "@/db/schema";
import { apiError, apiSuccess } from "@/lib/api/response";
import { authenticateApiKey } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { hasMailboxCapability, type MailboxRole } from "@/lib/auth/mailbox-access";

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await authenticateApiKey(env, request.headers.get("authorization"));
	if (!auth) return apiError("Unauthorized", 401);

	const db = getDb(env);
	const rows = auth.organizationId
		? await db
			.select({
				id: mailboxes.id,
				localPart: mailboxes.localPart,
				hostname: domains.hostname,
				displayName: mailboxes.displayName,
				role: mailboxMemberships.role,
			})
			.from(mailboxMemberships)
			.innerJoin(mailboxes, eq(mailboxes.id, mailboxMemberships.mailboxId))
			.innerJoin(domains, eq(domains.id, mailboxes.domainId))
			.where(and(
				eq(mailboxMemberships.userId, auth.userId),
				eq(mailboxes.organizationId, auth.organizationId),
			))
		: [];

	return apiSuccess({
		user: { id: auth.userId, email: auth.email },
		scopes: auth.scopes,
		mailboxes: rows.map((row) => {
			const role = row.role as MailboxRole;
			return {
				id: row.id,
				address: `${row.localPart}@${row.hostname}`,
				displayName: row.displayName,
				role,
				canRead: hasMailboxCapability(role, "read"),
				canSend: hasMailboxCapability(role, "send"),
			};
		}),
	});
}
