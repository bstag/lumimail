import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { aliases, domains, groupMembers, mailboxes } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { apiSuccess, apiError } from "@/lib/api/response";
import { newId } from "@/lib/ids";
import { createAliasSchema } from "@/lib/validators";
import {
	deleteEmailRoutingRule,
	ensureOwnedEmailRoutingRuleToWorker,
} from "@/lib/cloudflare-api";

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

export const POST = withOrgAdmin(async ({ request, env, user: orgUser }) => {
	const parsed = createAliasSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	const db = getDb(env);
	const [domain] = await db
		.select()
		.from(domains)
		.where(and(
			eq(domains.id, parsed.data.domainId),
			eq(domains.organizationId, orgUser.organizationId),
			eq(domains.status, "active"),
		))
		.limit(1);

	if (!domain || domain.organizationId !== orgUser.organizationId) {
		return apiError("Domain not found", 404);
	}

	const [mailboxConflict] = await db
		.select({ id: mailboxes.id })
		.from(mailboxes)
		.where(and(
			eq(mailboxes.domainId, domain.id),
			eq(mailboxes.localPart, parsed.data.localPart),
		))
		.limit(1);
	if (mailboxConflict) return apiError("Address already exists", 409);

	const [aliasConflict] = await db
		.select({ id: aliases.id })
		.from(aliases)
		.where(and(
			eq(aliases.domainId, domain.id),
			eq(aliases.localPart, parsed.data.localPart),
		))
		.limit(1);
	if (aliasConflict) return apiError("Address already exists", 409);

	const mailboxIds = parsed.data.kind === "group"
		? parsed.data.mailboxIds
		: [parsed.data.targetMailboxId];
	const targetRows = await db
		.select({ id: mailboxes.id })
		.from(mailboxes)
		.where(and(
			eq(mailboxes.organizationId, orgUser.organizationId),
			inArray(mailboxes.id, mailboxIds),
		));
	if (targetRows.length !== mailboxIds.length) {
		return apiError("Mailbox not found", 404);
	}

	const address = `${parsed.data.localPart}@${domain.hostname}`;
	let provisioned: Awaited<ReturnType<typeof ensureOwnedEmailRoutingRuleToWorker>>;
	try {
		provisioned = await ensureOwnedEmailRoutingRuleToWorker(env, domain.zoneId, address);
	} catch {
		return apiError("Failed to provision Cloudflare routing rule", 502);
	}
	if (provisioned.created && !provisioned.rule.id) {
		console.error("Cloudflare created an alias routing rule without returning its ID");
		return apiError("Failed to provision Cloudflare routing rule", 502);
	}

	const id = newId("alias");
	const aliasInsert = db.insert(aliases).values({
		id,
		organizationId: orgUser.organizationId,
		domainId: parsed.data.domainId,
		localPart: parsed.data.localPart,
		targetMailboxId: parsed.data.kind === "mailbox" ? parsed.data.targetMailboxId : null,
		forwardTo: null,
		isGroup: parsed.data.kind === "group",
		cloudflareRuleId: provisioned.created ? provisioned.rule.id : null,
	});
	const memberInsert = parsed.data.kind === "group"
		? db.insert(groupMembers).values(parsed.data.mailboxIds.map((mailboxId) => ({
			id: newId("grp"),
			aliasId: id,
			mailboxId,
			userId: null,
			email: null,
		})))
		: null;

	try {
		await db.batch([aliasInsert, ...(memberInsert ? [memberInsert] : [])]);
	} catch {
		if (provisioned.created && provisioned.rule.id) {
			try {
				await deleteEmailRoutingRule(env, domain.zoneId, provisioned.rule.id);
			} catch {
				console.error("Failed to compensate Cloudflare alias routing rule");
			}
		}
		return apiError("Failed to create alias", 500);
	}

	return apiSuccess({ id, address });
});
