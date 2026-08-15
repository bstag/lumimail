import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { routingRules } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { newId } from "@/lib/ids";
import { routingRuleSchema } from "@/lib/validators";
import { normalizeRoutingPattern } from "@/lib/email/routing-pattern";
import { apiError, apiSuccess, firstZodMessage } from "@/lib/api/response";
import {
	authorizeForwardTarget,
	domainHasCatchAllRule,
	getOrgDomain,
	storeTargetMailboxExists,
	syncCatchAllTransition,
} from "@/lib/email/routing-rules-service";

export const GET = withOrgAdmin(async ({ env, user }) => {
	const db = getDb(env);
	const rows = await db.select().from(routingRules).where(eq(routingRules.organizationId, user.organizationId));
	return apiSuccess({ rules: rows });
});

export const POST = withOrgAdmin(async ({ request, env, user }) => {
	const parsed = routingRuleSchema.safeParse(await request.json());
	if (!parsed.success) {
		return apiError(firstZodMessage(parsed.error), 400);
	}

	const db = getDb(env);
	const domain = await getOrgDomain(db, user.organizationId, parsed.data.domainId);
	if (!domain) {
		return apiError("Domain not found", 404);
	}

	const normalized = normalizeRoutingPattern(parsed.data.pattern, domain.hostname);
	if (!normalized.ok) return apiError(normalized.error, 400);

	if (parsed.data.action === "store") {
		const targetOk = await storeTargetMailboxExists(
			db,
			user.organizationId,
			domain.id,
			parsed.data.mailboxId!,
		);
		if (!targetOk) {
			return apiError("Target mailbox must belong to the selected domain", 400);
		}
	}

	if (normalized.pattern === "*") {
		if (await domainHasCatchAllRule(db, domain)) {
			return apiError("This domain already has a catch-all rule", 409);
		}

		const sync = await syncCatchAllTransition(env, db, {
			organizationId: user.organizationId,
			domain,
			wasCatchAll: false,
			isCatchAll: true,
		});
		if (!sync.ok) {
			return sync.error === "conflict"
				? apiError("Cloudflare catch-all is already used by another destination", 409)
				: apiError("Unable to configure Cloudflare catch-all", 502);
		}
	}

	const id = newId("rule");
	const mailboxId = parsed.data.action === "store" ? parsed.data.mailboxId! : null;
	const forwardTo = parsed.data.action === "forward" ? parsed.data.forwardTo! : null;

	// Fail closed: a forward rule whose destination is unowned or unverified would
	// silently discard every matching message, which is the defect F62 removes.
	if (forwardTo) {
		const authorization = await authorizeForwardTarget(db, user.organizationId, forwardTo);
		if (!authorization.allowed) {
			return apiError(authorization.message, 422);
		}
	}

	await db.insert(routingRules).values({
		id,
		userId: user.id,
		organizationId: user.organizationId,
		domainId: parsed.data.domainId,
		pattern: normalized.pattern,
		action: parsed.data.action,
		mailboxId,
		forwardTo,
		priority: parsed.data.priority,
	});

	return apiSuccess({
		id,
		...parsed.data,
		pattern: normalized.pattern,
		mailboxId,
		forwardTo,
	});
});
