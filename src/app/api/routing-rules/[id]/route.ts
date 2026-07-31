import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { routingRules } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { routingRuleSchema, routingRuleUpdateSchema } from "@/lib/validators";
import { normalizeRoutingPattern } from "@/lib/email/routing-pattern";
import { apiError, apiSuccess, firstZodMessage, parseJsonBody } from "@/lib/api/response";
import {
  authorizeForwardTarget,
  domainHasCatchAllRule,
  getOrgDomain,
  storeTargetMailboxExists,
  syncCatchAllTransition,
} from "@/lib/email/routing-rules-service";

export const GET = withUser<{ id: string }>(async ({ env, user, params }) => {
  const { id } = params;
  if (!user.organizationId) return apiError("No organization", 400);

  const db = getDb(env);
  const [rule] = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.id, id), eq(routingRules.organizationId, user.organizationId)))
    .limit(1);

  if (!rule) return apiError("Not found", 404);
  return apiSuccess({ rule });
});

export const PATCH = withUser<{ id: string }>(async ({ request, env, user, params }) => {
  const { id } = params;
  if (!user.organizationId) return apiError("No organization", 400);

  const db = getDb(env);
  const [rule] = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.id, id), eq(routingRules.organizationId, user.organizationId)))
    .limit(1);

  if (!rule) return apiError("Not found", 404);

  const { data: update, errorResponse } = await parseJsonBody(request, routingRuleUpdateSchema);
  if (errorResponse) return errorResponse;
  if (Object.keys(update).length === 0) {
    return apiError("No valid fields to update", 400);
  }

  const domain = await getOrgDomain(db, user.organizationId, rule.domainId);
  if (!domain) return apiError("Domain not found", 404);

  const merged = routingRuleSchema.safeParse({
    domainId: rule.domainId,
    pattern: update.pattern ?? rule.pattern,
    action: update.action ?? rule.action,
    mailboxId: Object.hasOwn(update, "mailboxId") ? update.mailboxId : rule.mailboxId,
    forwardTo: Object.hasOwn(update, "forwardTo") ? update.forwardTo : rule.forwardTo,
    priority: update.priority ?? rule.priority,
  });
  if (!merged.success) return apiError(firstZodMessage(merged.error), 400);

  const normalized = normalizeRoutingPattern(merged.data.pattern, domain.hostname);
  if (!normalized.ok) return apiError(normalized.error, 400);

  if (merged.data.action === "store") {
    const targetOk = await storeTargetMailboxExists(
      db,
      user.organizationId,
      domain.id,
      merged.data.mailboxId!,
    );
    if (!targetOk) {
      return apiError("Target mailbox must belong to the selected domain", 400);
    }
  }

  const oldPattern = normalizeRoutingPattern(rule.pattern, domain.hostname);
  const wasCatchAll = oldPattern.ok && oldPattern.pattern === "*";
  const isCatchAll = normalized.pattern === "*";

  if (isCatchAll && await domainHasCatchAllRule(db, domain, rule.id)) {
    return apiError("This domain already has a catch-all rule", 409);
  }

  const sync = await syncCatchAllTransition(env, db, {
    organizationId: user.organizationId,
    domain,
    ruleId: rule.id,
    wasCatchAll,
    isCatchAll,
  });
  if (!sync.ok) {
    return sync.error === "conflict"
      ? apiError("Cloudflare catch-all is already used by another destination", 409)
      : apiError("Unable to update Cloudflare catch-all", 502);
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
    const authorization = await authorizeForwardTarget(db, user.organizationId, values.forwardTo);
    if (!authorization.allowed) {
      return apiError(authorization.message, 422);
    }
  }

  await db.update(routingRules).set(values).where(eq(routingRules.id, id));

  const [updated] = await db.select().from(routingRules).where(eq(routingRules.id, id)).limit(1);
  return apiSuccess({ rule: updated });
});

export const DELETE = withUser<{ id: string }>(async ({ env, user, params }) => {
  const { id } = params;
  if (!user.organizationId) return apiError("No organization", 400);

  const db = getDb(env);
  const [rule] = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.id, id), eq(routingRules.organizationId, user.organizationId)))
    .limit(1);

  if (!rule) return apiError("Not found", 404);

  const domain = await getOrgDomain(db, user.organizationId, rule.domainId);
  if (!domain) return apiError("Domain not found", 404);

  const normalized = normalizeRoutingPattern(rule.pattern, domain.hostname);
  if (normalized.ok && normalized.pattern === "*") {
    const sync = await syncCatchAllTransition(env, db, {
      organizationId: user.organizationId,
      domain,
      ruleId: rule.id,
      wasCatchAll: true,
      isCatchAll: false,
    });
    if (!sync.ok) {
      return apiError("Unable to disable Cloudflare catch-all", 502);
    }
  }

  await db.delete(routingRules).where(eq(routingRules.id, id));
  return apiSuccess({ ok: true });
});
