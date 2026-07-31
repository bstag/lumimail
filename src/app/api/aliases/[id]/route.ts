import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { aliases, groupMembers, mailboxes } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { apiSuccess, apiError } from "@/lib/api/response";
import { deleteAlias } from "@/lib/email/alias-service";
import { updateAliasGroupSchema } from "@/lib/validators";
import { newId } from "@/lib/ids";

export const DELETE = withOrgAdmin<{ id: string }>(async ({ env, user: orgUser, params }) => {
	const result = await deleteAlias(env, orgUser.organizationId, params.id);
	if (!result.ok) {
		return result.error === "not_found"
			? apiError("Alias not found", 404)
			: apiError("Failed to remove Cloudflare routing rule", 502);
	}
	return apiSuccess({ ok: true });
});

export const PATCH = withOrgAdmin<{ id: string }>(async ({ request, env, user: orgUser, params }) => {
	const { id } = params;
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
});
