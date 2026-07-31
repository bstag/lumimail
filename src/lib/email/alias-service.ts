import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { getDb } from "@/db";
import type { createAliasSchema } from "@/lib/validators";
import { aliases, domains, groupMembers, mailboxes } from "@/db/schema";
import { newId } from "@/lib/ids";
import {
	deleteEmailRoutingRule,
	ensureOwnedEmailRoutingRuleToWorker,
} from "@/lib/cloudflare-api";

/**
 * Alias provisioning service (T-40), modeled on `src/lib/domains/service.ts`.
 *
 * Creating an alias is a small saga: conflict checks, a Cloudflare routing-rule
 * provision, then a D1 batch write — with a compensating Cloudflare delete when
 * the batch fails after a rule was freshly created. That compensation logic
 * lives here so it can be unit-tested in isolation; the routes only map the
 * typed results onto their exact response bodies and statuses.
 */

export type CreateAliasInput = z.infer<typeof createAliasSchema>;

export type CreateAliasResult =
	| { ok: true; id: string; address: string }
	| {
		ok: false;
		error:
			| "domain_not_found"
			| "address_taken"
			| "mailbox_not_found"
			| "provision_failed"
			| "create_failed";
	};

export async function createAlias(
	env: CloudflareEnv,
	organizationId: string,
	input: CreateAliasInput,
): Promise<CreateAliasResult> {
	const db = getDb(env);
	const [domain] = await db
		.select()
		.from(domains)
		.where(and(
			eq(domains.id, input.domainId),
			eq(domains.organizationId, organizationId),
			eq(domains.status, "active"),
		))
		.limit(1);

	if (!domain || domain.organizationId !== organizationId) {
		return { ok: false, error: "domain_not_found" };
	}

	const [mailboxConflict] = await db
		.select({ id: mailboxes.id })
		.from(mailboxes)
		.where(and(
			eq(mailboxes.domainId, domain.id),
			eq(mailboxes.localPart, input.localPart),
		))
		.limit(1);
	if (mailboxConflict) return { ok: false, error: "address_taken" };

	const [aliasConflict] = await db
		.select({ id: aliases.id })
		.from(aliases)
		.where(and(
			eq(aliases.domainId, domain.id),
			eq(aliases.localPart, input.localPart),
		))
		.limit(1);
	if (aliasConflict) return { ok: false, error: "address_taken" };

	const mailboxIds = input.kind === "group"
		? input.mailboxIds
		: [input.targetMailboxId];
	const targetRows = await db
		.select({ id: mailboxes.id })
		.from(mailboxes)
		.where(and(
			eq(mailboxes.organizationId, organizationId),
			inArray(mailboxes.id, mailboxIds),
		));
	if (targetRows.length !== mailboxIds.length) {
		return { ok: false, error: "mailbox_not_found" };
	}

	const address = `${input.localPart}@${domain.hostname}`;
	let provisioned: Awaited<ReturnType<typeof ensureOwnedEmailRoutingRuleToWorker>>;
	try {
		provisioned = await ensureOwnedEmailRoutingRuleToWorker(env, domain.zoneId, address);
	} catch {
		return { ok: false, error: "provision_failed" };
	}
	if (provisioned.created && !provisioned.rule.id) {
		console.error("Cloudflare created an alias routing rule without returning its ID");
		return { ok: false, error: "provision_failed" };
	}

	const id = newId("alias");
	const aliasInsert = db.insert(aliases).values({
		id,
		organizationId,
		domainId: input.domainId,
		localPart: input.localPart,
		targetMailboxId: input.kind === "mailbox" ? input.targetMailboxId : null,
		forwardTo: null,
		isGroup: input.kind === "group",
		cloudflareRuleId: provisioned.created ? provisioned.rule.id : null,
	});
	const memberInsert = input.kind === "group"
		? db.insert(groupMembers).values(input.mailboxIds.map((mailboxId) => ({
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
		// Compensate only a rule this request created: deleting a reused manual
		// rule would break routing that predates (and outlives) this alias.
		if (provisioned.created && provisioned.rule.id) {
			try {
				await deleteEmailRoutingRule(env, domain.zoneId, provisioned.rule.id);
			} catch {
				console.error("Failed to compensate Cloudflare alias routing rule");
			}
		}
		return { ok: false, error: "create_failed" };
	}

	return { ok: true, id, address };
}

export type DeleteAliasResult =
	| { ok: true }
	| { ok: false; error: "not_found" | "cloudflare_failed" };

/**
 * Delete an alias, removing its owned Cloudflare routing rule first. The D1 row
 * is only deleted after Cloudflare cleanup succeeds, so a provider failure
 * never strands a rule that keeps routing mail for a vanished alias.
 */
export async function deleteAlias(
	env: CloudflareEnv,
	organizationId: string,
	aliasId: string,
): Promise<DeleteAliasResult> {
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
		.where(and(eq(aliases.id, aliasId), eq(aliases.organizationId, organizationId)))
		.limit(1);

	if (!alias) return { ok: false, error: "not_found" };

	if (alias.cloudflareRuleId) {
		try {
			await deleteEmailRoutingRule(env, alias.zoneId, alias.cloudflareRuleId);
		} catch {
			return { ok: false, error: "cloudflare_failed" };
		}
	}

	await db.delete(aliases).where(eq(aliases.id, aliasId));
	return { ok: true };
}
