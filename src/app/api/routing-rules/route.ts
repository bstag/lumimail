import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { domains, mailboxes, routingRules } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { newId } from "@/lib/ids";
import { routingRuleSchema } from "@/lib/validators";
import { normalizeRoutingPattern } from "@/lib/email/routing-pattern";
import { ensureEmailRoutingCatchAllToWorker } from "@/lib/cloudflare-api";
import { authorizeForwardDestination } from "@/lib/email/forwarding";
import { apiError, apiSuccess } from "@/lib/api/response";
import { firstZodMessage, forwardRefusalMessage } from "./utils";

export async function GET(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	if (!user.organizationId) return apiError("No organization", 400);
	const db = getDb(env);
	const rows = await db.select().from(routingRules).where(eq(routingRules.organizationId, user.organizationId));
	return apiSuccess({ rules: rows });
}

export async function POST(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	if (!user.organizationId) return apiError("No organization", 400);
	const parsed = routingRuleSchema.safeParse(await request.json());
	if (!parsed.success) {
		return apiError(firstZodMessage(parsed.error), 400);
	}

	const db = getDb(env);
	const [domain] = await db
		.select()
		.from(domains)
		.where(and(eq(domains.id, parsed.data.domainId), eq(domains.organizationId, user.organizationId)))
		.limit(1);
	if (!domain) {
		return apiError("Domain not found", 404);
	}

	const normalized = normalizeRoutingPattern(parsed.data.pattern, domain.hostname);
	if (!normalized.ok) return apiError(normalized.error, 400);

	if (parsed.data.action === "store") {
		const [mailbox] = await db
			.select({ id: mailboxes.id })
			.from(mailboxes)
			.where(and(
				eq(mailboxes.id, parsed.data.mailboxId!),
				eq(mailboxes.domainId, domain.id),
				eq(mailboxes.organizationId, user.organizationId),
			))
			.limit(1);
		if (!mailbox) {
			return apiError("Target mailbox must belong to the selected domain", 400);
		}
	}

	if (normalized.pattern === "*") {
		const existingRules = await db
			.select({ id: routingRules.id, pattern: routingRules.pattern })
			.from(routingRules)
			.where(eq(routingRules.domainId, domain.id));
		const hasCatchAll = existingRules.some((existing) => {
			const existingPattern = normalizeRoutingPattern(existing.pattern, domain.hostname);
			return existingPattern.ok && existingPattern.pattern === "*";
		});
		if (hasCatchAll) {
			return apiError("This domain already has a catch-all rule", 409);
		}

		try {
			await ensureEmailRoutingCatchAllToWorker(env, domain.zoneId);
		} catch (error) {
			if (error instanceof Error && error.name === "CloudflareCatchAllConflictError") {
				return apiError("Cloudflare catch-all is already used by another destination", 409);
			}
			return apiError("Unable to configure Cloudflare catch-all", 502);
		}
	}

	const id = newId("rule");
	const mailboxId = parsed.data.action === "store" ? parsed.data.mailboxId! : null;
	const forwardTo = parsed.data.action === "forward" ? parsed.data.forwardTo! : null;

	// Fail closed: a forward rule whose destination is unowned or unverified would
	// silently discard every matching message, which is the defect F62 removes.
	if (forwardTo) {
		const authorization = await authorizeForwardDestination(db, user.organizationId, forwardTo);
		if (!authorization.allowed) {
			return apiError(forwardRefusalMessage(authorization.reason), 422);
		}
	}

	await db.insert(routingRules).values({
		id,
		userId: user.id,
		organizationId: user.organizationId!,
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
}
