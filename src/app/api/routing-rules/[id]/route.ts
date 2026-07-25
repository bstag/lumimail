import { and, eq, ne } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { domains, mailboxes, routingRules } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { routingRuleSchema, routingRuleUpdateSchema } from "@/lib/validators";
import { normalizeRoutingPattern } from "@/lib/email/routing-pattern";
import {
  disableEmailRoutingCatchAllToWorker,
  ensureEmailRoutingCatchAllToWorker,
} from "@/lib/cloudflare-api";
import { authorizeForwardDestination } from "@/lib/email/forwarding";
import { apiError, apiSuccess } from "@/lib/api/response";
import { firstZodMessage, forwardRefusalMessage } from "../utils";

type Params = { params: Promise<{ id: string }> };

async function hasOtherCatchAllInZone(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  zoneId: string,
  excludedRuleId: string,
): Promise<boolean> {
  const rows = await db
    .select({ pattern: routingRules.pattern, hostname: domains.hostname })
    .from(routingRules)
    .innerJoin(domains, eq(domains.id, routingRules.domainId))
    .where(and(
      eq(domains.organizationId, organizationId),
      eq(domains.zoneId, zoneId),
      ne(routingRules.id, excludedRuleId),
    ));
  return rows.some((row) => {
    const normalized = normalizeRoutingPattern(row.pattern, row.hostname);
    return normalized.ok && normalized.pattern === "*";
  });
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const env = getEnv();
  const { user, errorResponse } = await guardUser(env, request);
  if (errorResponse) return errorResponse;
  if (!user.organizationId) return apiError("No organization", 400);

  const db = getDb(env);
  const [rule] = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.id, id), eq(routingRules.organizationId, user.organizationId)))
    .limit(1);

  if (!rule) return apiError("Not found", 404);
  return apiSuccess({ rule });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const env = getEnv();
  const { user, errorResponse } = await guardUser(env, request);
  if (errorResponse) return errorResponse;
  if (!user.organizationId) return apiError("No organization", 400);

  const body = await request.json();
  const db = getDb(env);
  const [rule] = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.id, id), eq(routingRules.organizationId, user.organizationId)))
    .limit(1);

  if (!rule) return apiError("Not found", 404);

  const update = routingRuleUpdateSchema.safeParse(body);
  if (!update.success) return apiError(firstZodMessage(update.error), 400);
  if (Object.keys(update.data).length === 0) {
    return apiError("No valid fields to update", 400);
  }

  const [domain] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, rule.domainId), eq(domains.organizationId, user.organizationId)))
    .limit(1);
  if (!domain) return apiError("Domain not found", 404);

  const merged = routingRuleSchema.safeParse({
    domainId: rule.domainId,
    pattern: update.data.pattern ?? rule.pattern,
    action: update.data.action ?? rule.action,
    mailboxId: Object.hasOwn(update.data, "mailboxId") ? update.data.mailboxId : rule.mailboxId,
    forwardTo: Object.hasOwn(update.data, "forwardTo") ? update.data.forwardTo : rule.forwardTo,
    priority: update.data.priority ?? rule.priority,
  });
  if (!merged.success) return apiError(firstZodMessage(merged.error), 400);

  const normalized = normalizeRoutingPattern(merged.data.pattern, domain.hostname);
  if (!normalized.ok) return apiError(normalized.error, 400);

  if (merged.data.action === "store") {
    const [mailbox] = await db
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(and(
        eq(mailboxes.id, merged.data.mailboxId!),
        eq(mailboxes.domainId, domain.id),
        eq(mailboxes.organizationId, user.organizationId),
      ))
      .limit(1);
    if (!mailbox) {
      return apiError("Target mailbox must belong to the selected domain", 400);
    }
  }

  const oldPattern = normalizeRoutingPattern(rule.pattern, domain.hostname);
  const wasCatchAll = oldPattern.ok && oldPattern.pattern === "*";
  const isCatchAll = normalized.pattern === "*";

  if (isCatchAll) {
    const candidates = await db
		.select({ id: routingRules.id, pattern: routingRules.pattern })
		.from(routingRules)
		.where(and(
			eq(routingRules.domainId, domain.id),
			ne(routingRules.id, rule.id),
		));
	const hasDuplicate = candidates.some((candidate) => {
		const candidatePattern = normalizeRoutingPattern(candidate.pattern, domain.hostname);
		return candidatePattern.ok && candidatePattern.pattern === "*";
	});
    if (hasDuplicate) {
		return apiError("This domain already has a catch-all rule", 409);
	}
  }

  try {
    if (isCatchAll) await ensureEmailRoutingCatchAllToWorker(env, domain.zoneId);
    else if (wasCatchAll && !await hasOtherCatchAllInZone(db, user.organizationId, domain.zoneId, rule.id)) {
      await disableEmailRoutingCatchAllToWorker(env, domain.zoneId);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "CloudflareCatchAllConflictError") {
      return apiError("Cloudflare catch-all is already used by another destination", 409);
    }
    return apiError("Unable to update Cloudflare catch-all", 502);
  }

  const values = {
    action: merged.data.action,
    priority: merged.data.priority,
    pattern: normalized.pattern,
    forwardTo: merged.data.action === "forward" ? merged.data.forwardTo! : null,
    mailboxId: merged.data.action === "store" ? merged.data.mailboxId! : null,
  };

  // Same fail-closed rule as creation: an edit must not be able to point a rule at
  // an unowned or unverified destination.
  if (values.forwardTo) {
    const authorization = await authorizeForwardDestination(db, user.organizationId, values.forwardTo);
    if (!authorization.allowed) {
      return apiError(forwardRefusalMessage(authorization.reason), 422);
    }
  }

  await db.update(routingRules).set(values).where(eq(routingRules.id, id));

  const [updated] = await db.select().from(routingRules).where(eq(routingRules.id, id)).limit(1);
  return apiSuccess({ rule: updated });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const env = getEnv();
  const { user, errorResponse } = await guardUser(env, request);
  if (errorResponse) return errorResponse;
  if (!user.organizationId) return apiError("No organization", 400);

  const db = getDb(env);
  const [rule] = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.id, id), eq(routingRules.organizationId, user.organizationId)))
    .limit(1);

  if (!rule) return apiError("Not found", 404);

  const [domain] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, rule.domainId), eq(domains.organizationId, user.organizationId)))
    .limit(1);
  if (!domain) return apiError("Domain not found", 404);

  const normalized = normalizeRoutingPattern(rule.pattern, domain.hostname);
  if (normalized.ok && normalized.pattern === "*") {
    try {
	  if (!await hasOtherCatchAllInZone(db, user.organizationId, domain.zoneId, rule.id)) {
		await disableEmailRoutingCatchAllToWorker(env, domain.zoneId);
	  }
    } catch {
      return apiError("Unable to disable Cloudflare catch-all", 502);
    }
  }

  await db.delete(routingRules).where(eq(routingRules.id, id));
  return apiSuccess({ ok: true });
}
