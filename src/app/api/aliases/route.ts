import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aliases, domains, groupMembers, mailboxes } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAliasSchema } from "@/lib/validators";
import { createAlias, type CreateAliasResult } from "@/lib/email/alias-service";

export const GET = withOrgAdmin(async ({ env, user: orgUser }) => {
	const db = getDb(env);
	const rows = await db
		.select({
			id: aliases.id,
			localPart: aliases.localPart,
			forwardTo: aliases.forwardTo,
			isGroup: aliases.isGroup,
			targetMailboxId: aliases.targetMailboxId,
			domainId: aliases.domainId,
			domainHostname: domains.hostname,
			createdAt: aliases.createdAt,
		})
		.from(aliases)
		.innerJoin(domains, eq(aliases.domainId, domains.id))
		.where(eq(aliases.organizationId, orgUser.organizationId));

	const memberRows = rows.length
		? await db
			.select({
				aliasId: groupMembers.aliasId,
				mailboxId: mailboxes.id,
				localPart: mailboxes.localPart,
				hostname: domains.hostname,
			})
			.from(groupMembers)
			.innerJoin(aliases, eq(groupMembers.aliasId, aliases.id))
			.innerJoin(mailboxes, eq(groupMembers.mailboxId, mailboxes.id))
			.innerJoin(domains, eq(mailboxes.domainId, domains.id))
			.where(eq(aliases.organizationId, orgUser.organizationId))
		: [];
	const membersByAlias = Map.groupBy(memberRows, (member) => member.aliasId);

	return apiSuccess({
		aliases: rows.map((alias) => ({
			...alias,
			members: (membersByAlias.get(alias.id) ?? []).map((member) => ({
				mailboxId: member.mailboxId,
				localPart: member.localPart,
				hostname: member.hostname,
			})),
		})),
	});
});

const createFailureResponses: Record<
	Extract<CreateAliasResult, { ok: false }>["error"],
	{ message: string; status: number }
> = {
	domain_not_found: { message: "Domain not found", status: 404 },
	address_taken: { message: "Address already exists", status: 409 },
	mailbox_not_found: { message: "Mailbox not found", status: 404 },
	provision_failed: { message: "Failed to provision Cloudflare routing rule", status: 502 },
	create_failed: { message: "Failed to create alias", status: 500 },
};

export const POST = withOrgAdmin(async ({ request, env, user: orgUser }) => {
	const parsed = createAliasSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	const result = await createAlias(env, orgUser.organizationId, parsed.data);
	if (!result.ok) {
		const { message, status } = createFailureResponses[result.error];
		return apiError(message, status);
	}

	return apiSuccess({ id: result.id, address: result.address });
});
