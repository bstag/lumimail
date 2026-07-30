import { eq, and, inArray } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { aliases, domains, groupMembers, mailboxes } from "@/db/schema";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { apiSuccess, apiError } from "@/lib/api/response";
import { deleteEmailRoutingRule } from "@/lib/cloudflare-api";
import { updateAliasGroupSchema } from "@/lib/validators";
import { newId } from "@/lib/ids";

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const [alias] = await db
		.select({
			id: aliases.id,
			organizationId: aliases.organizationId,
			zoneId: domains.zoneId,
			cloudflareRuleId: aliases.cloudflareRuleId,
		})
		.from(aliases)
		.innerJoin(domains, eq(aliases.domainId, domains.id))
		.where(and(eq(aliases.id, id), eq(aliases.organizationId, orgUser.organizationId)))
		.limit(1);

	if (!alias) return apiError("Alias not found", 404);

	if (alias.cloudflareRuleId) {
		try {
			await deleteEmailRoutingRule(env, alias.zoneId, alias.cloudflareRuleId);
		} catch {
			return apiError("Failed to remove Cloudflare routing rule", 502);
		}
	}

	await db.delete(aliases).where(eq(aliases.id, id));
	return apiSuccess({ ok: true });
}

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;

	const parsed = updateAliasGroupSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	const db = getDb(env);
	const [alias] = await db
		.select({
			id: aliases.id,
			organizationId: aliases.organizationId,
			isGroup: aliases.isGroup,
		})
		.from(aliases)
		.where(and(
			eq(aliases.id, id),
			eq(aliases.organizationId, orgUser.organizationId),
		))
		.limit(1);
	if (!alias) return apiError("Alias not found", 404);
	if (!alias.isGroup) return apiError("Alias is not a group", 409);

	const targets = await db
		.select({ id: mailboxes.id })
		.from(mailboxes)
		.where(and(
			eq(mailboxes.organizationId, orgUser.organizationId),
			inArray(mailboxes.id, parsed.data.mailboxIds),
		));
	if (targets.length !== parsed.data.mailboxIds.length) {
		return apiError("Mailbox not found", 404);
	}

	await db.batch([
		db.delete(groupMembers).where(eq(groupMembers.aliasId, alias.id)),
		db.insert(groupMembers).values(parsed.data.mailboxIds.map((mailboxId) => ({
			id: newId("grp"),
			aliasId: alias.id,
			mailboxId,
			userId: null,
			email: null,
		}))),
	]);

	return apiSuccess({ mailboxIds: parsed.data.mailboxIds });
}
